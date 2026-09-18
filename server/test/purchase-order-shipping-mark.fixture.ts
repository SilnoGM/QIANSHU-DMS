import { createHash, randomUUID } from 'node:crypto'

import type { Client } from 'pg'
import { calculateNumberingConfigFingerprint } from '../src/modules/numbering/numbering-config-fingerprint'
import { shipmentNumberFingerprint } from '../src/modules/purchase-orders/shipments/purchase-shipment-numbering.service'

/**
 * 数据库约束测试使用 v5 待审核、未派码的合规货件。调用方已开启隔离 pg 事务，整组记录仅由
 * ROLLBACK 清理；不禁用触发器、不删除永久账本，也不模拟生产 Generator 的实现。
 */
export function createPurchaseShippingMarkFixture(client: Client, input: {
  idempotencyKeyHash: Buffer
  requestFingerprintHash: Buffer
}): { shippingMarkIssuanceId: null, shippingMarkText: null, createPart(orderId: string): Promise<void> } {
  if (input.idempotencyKeyHash.length !== 32 || input.requestFingerprintHash.length !== 32) throw new Error('Invalid fixture request identity')
  const partKey = randomUUID()
  return { shippingMarkIssuanceId: null, shippingMarkText: null,
    async createPart(orderId: string) {
      const id = randomUUID()
      const numbering = await insertShipmentIssuance(client, { id, purchaseOrderId: orderId, key: partKey })
      await client.query(`INSERT INTO purchase_order_parts (
        id, purchase_order_id, key, part_number, shipping_mark_text, shipping_mark_issuance_id, shipping_mark_key_hash, shipment_no, numbering_issuance_id
      ) VALUES ($1, $2, $3, 1, NULL, NULL, NULL, $4, $5)`, [id, orderId, partKey, numbering.shipmentNo, numbering.issuanceId])
      await client.query(`INSERT INTO purchase_order_part_items (purchase_order_id, purchase_order_part_id, purchase_order_line_id, quantity)
        SELECT purchase_order_id, $2, id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1`, [orderId, id])
    },
  }
}

/** SQL 约束夹具也准备完整合法编号账本；与业务夹具一样，不禁用新建编号或不可变触发器。 */
async function insertShipmentIssuance(client: Client, part: { id: string, purchaseOrderId: string, key: string }) {
  const existing = await client.query<{ ruleId: string, versionId: string }>(`SELECT rule.id AS "ruleId", version.id AS "versionId"
    FROM numbering_rules rule JOIN numbering_rule_versions version ON version.rule_id = rule.id AND version.status = 'ACTIVE'
    WHERE rule.rule_code = 'SHIPMENT_NO'`)
  let rule = existing.rows[0]
  if (!rule) {
    const created = await client.query<{ id: string }>(`INSERT INTO numbering_rules (rule_code, name, purpose) VALUES ('SHIPMENT_NO', 'Shipment SQL fixture', 'BUSINESS') RETURNING id`)
    const fingerprint = calculateNumberingConfigFingerprint({ resetPolicy: 'NEVER', segments: [
      { type: 'FIXED', value: 'PKG' }, { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
    ] })
    const version = await client.query<{ id: string }>(`INSERT INTO numbering_rule_versions (rule_id, revision, reset_policy, config_fingerprint)
      VALUES ($1, 1, 'NEVER', $2) RETURNING id`, [created.rows[0].id, fingerprint])
    rule = { ruleId: created.rows[0].id, versionId: version.rows[0].id }
    await client.query(`INSERT INTO numbering_rule_segments (version_id, position, type, fixed_value, sequence_width, sequence_start_value, sequence_step)
      VALUES ($1, 0, 'FIXED', 'PKG', NULL, NULL, NULL), ($1, 1, 'SEQUENCE', NULL, 8, 1, 1)`, [rule.versionId])
    await client.query(`UPDATE numbering_rule_versions SET status = 'ACTIVE', published_at = CURRENT_TIMESTAMP WHERE id = $1`, [rule.versionId])
    await client.query(`UPDATE numbering_rules SET status = 'ENABLED', version = 3 WHERE id = $1`, [rule.ruleId])
  }
  const state = await client.query<{ value: string }>(`INSERT INTO numbering_period_states (rule_id, period_key, next_sequence_value, used_count)
    VALUES ($1, 'ALL', 2, 1) ON CONFLICT (rule_id, period_key) DO UPDATE
    SET next_sequence_value = numbering_period_states.next_sequence_value + 1, used_count = numbering_period_states.used_count + 1
    RETURNING (next_sequence_value - 1)::text AS value`, [rule.ruleId])
  const shipmentNo = `PKG${state.rows[0].value.padStart(8, '0')}`
  const issuance = await client.query<{ id: string }>(`INSERT INTO numbering_issuances
    (rule_id, rule_version_id, period_key, generated_number, sequence_value, consumer_code, idempotency_key_hash, request_fingerprint_hash)
    VALUES ($1, $2, 'ALL', $3, $4, 'SHIPMENT_NO.CREATE', $5, $6) RETURNING id`,
  [rule.ruleId, rule.versionId, shipmentNo, state.rows[0].value, createHash('sha256').update(part.id).digest(), Buffer.from(shipmentNumberFingerprint(part), 'hex')])
  return { shipmentNo, issuanceId: issuance.rows[0].id }
}
