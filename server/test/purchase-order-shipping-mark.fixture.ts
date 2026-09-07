import { createHash, randomUUID } from 'node:crypto'

import type { Client } from 'pg'

/**
 * 数据库约束测试使用的合规唛头关联。调用方已开启隔离 pg 事务，整组记录仅由
 * ROLLBACK 清理；不禁用触发器、不删除永久账本，也不模拟生产 Generator 的实现。
 */
export async function createPurchaseShippingMarkFixture(client: Client, input: {
  idempotencyKeyHash: Buffer
  requestFingerprintHash: Buffer
}): Promise<{ shippingMarkIssuanceId: null, shippingMarkText: null, createPart(orderId: string): Promise<void> }> {
  const ruleId = randomUUID()
  const versionId = randomUUID()
  const shippingMarkIssuanceId = randomUUID()
  const shippingMarkText = '000001'
  const partKey = randomUUID()
  const partMarkKeyHash = createHash('sha256').update(`${input.idempotencyKeyHash.toString('hex')}:${partKey}`).digest()
  await client.query(`
    INSERT INTO numbering_rules (id, rule_code, name, purpose)
    VALUES ($1, $2, 'Purchase constraint fixture', 'SHIPPING_MARK')
  `, [ruleId, `E2E_MARK_${ruleId.replaceAll('-', '').toUpperCase()}`])
  await client.query(`
    INSERT INTO numbering_rule_versions (
      id, rule_id, revision, reset_policy, config_fingerprint
    ) VALUES ($1, $2, 1, 'NEVER', $3)
  `, [versionId, ruleId, createHash('sha256').update(ruleId).digest('hex')])
  await client.query(`
    INSERT INTO numbering_rule_segments (
      version_id, position, type, sequence_width, sequence_start_value, sequence_step
    ) VALUES ($1, 0, 'SEQUENCE', 6, 1, 1)
  `, [versionId])
  await client.query(`
    UPDATE numbering_rule_versions SET status = 'ACTIVE', published_at = NOW()
    WHERE id = $1
  `, [versionId])
  await client.query(`UPDATE numbering_rules SET status = 'ENABLED' WHERE id = $1`, [ruleId])
  await client.query(`
    INSERT INTO numbering_period_states (rule_id, period_key, next_sequence_value, used_count)
    VALUES ($1, 'ALL', 2, 1)
  `, [ruleId])
  await client.query(`
    INSERT INTO numbering_issuances (
      id, rule_id, rule_version_id, period_key, generated_number, sequence_value,
      consumer_code, idempotency_key_hash, request_fingerprint_hash
    ) VALUES ($1, $2, $3, 'ALL', $4, 1, 'PURCHASE_ORDER.PART_SHIPPING_MARK', $5, $6)
  `, [shippingMarkIssuanceId, ruleId, versionId, shippingMarkText, partMarkKeyHash, input.requestFingerprintHash])
  return { shippingMarkIssuanceId: null, shippingMarkText: null,
    async createPart(orderId: string) {
      const id = randomUUID()
      await client.query(`INSERT INTO purchase_order_parts (
        id, purchase_order_id, key, part_number, shipping_mark_text, shipping_mark_issuance_id, shipping_mark_key_hash
      ) VALUES ($1, $2, $3, 1, $4, $5, $6)`, [id, orderId, partKey, shippingMarkText, shippingMarkIssuanceId, partMarkKeyHash])
      await client.query(`INSERT INTO purchase_order_part_items (purchase_order_id, purchase_order_part_id, purchase_order_line_id, quantity)
        SELECT purchase_order_id, $2, id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1`, [orderId, id])
    },
  }
}
