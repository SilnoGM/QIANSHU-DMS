import { randomUUID } from 'node:crypto'

import type { Client } from 'pg'

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
      await client.query(`INSERT INTO purchase_order_parts (
        id, purchase_order_id, key, part_number, shipping_mark_text, shipping_mark_issuance_id, shipping_mark_key_hash
      ) VALUES ($1, $2, $3, 1, NULL, NULL, NULL)`, [id, orderId, partKey])
      await client.query(`INSERT INTO purchase_order_part_items (purchase_order_id, purchase_order_part_id, purchase_order_line_id, quantity)
        SELECT purchase_order_id, $2, id, quantity FROM purchase_order_lines WHERE purchase_order_id = $1`, [orderId, id])
    },
  }
}
