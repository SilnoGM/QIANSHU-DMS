import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { createPurchaseShippingMarkFixture } from './purchase-order-shipping-mark.fixture'
import { createPurchaseShippingMarkDatabase } from './purchase-shipping-mark-e2e-database'

describe('purchase records constraints on isolated PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createPurchaseShippingMarkDatabase>> | undefined
  let client: Client
  const actorId = randomUUID()
  const orderId = randomUUID()
  const secondOrderId = randomUUID()
  const voucherOrderId = randomUUID()
  const summaryOrderId = randomUUID()
  const legacyVoucherPaymentId = randomUUID()

  async function createOrder(id: string) {
    const hash = createHash('sha256').update(id).digest()
    const mark = createPurchaseShippingMarkFixture(client, {
      idempotencyKeyHash: hash, requestFingerprintHash: hash,
    })
    await client.query(`INSERT INTO purchase_orders (
      id, order_no, create_idempotency_key_hash, create_request_fingerprint_hash,
      purchase_type, product_mode, custom_supplier_name, order_date,
      line_subtotal_amount, purchase_total_amount, deposit_due_amount, balance_due_amount, created_by_user_id,
      shipping_mark_issuance_id, shipping_mark_text
    ) VALUES ($1, $2, $3, $3, 'STOCK', 'CUSTOM', 'Records E2E', CURRENT_DATE, 100, 100, 30, 70, $4, $5, $6)`,
    [id, `PO-RECORDS-${id}`, hash, actorId, mark.shippingMarkIssuanceId, mark.shippingMarkText])
    await client.query(`INSERT INTO purchase_order_lines (
      purchase_order_id, line_number, line_type, product_name_snapshot,
      reference_purchase_unit_price_amount, actual_purchase_unit_price_amount, quantity, line_total_amount
    ) VALUES ($1, 1, 'CUSTOM', 'Records Product', 100, 100, 1, 100)`, [id])
    await mark.createPart(id)
  }

  async function addDocument(type: string, paymentId: string | null = null, documentOrderId = orderId) {
    // 媒体 READY 与归档引用必须作为一个事务事实验证，不能在中间 INSERT 时提前检查。
    await client.query('SET CONSTRAINTS ALL DEFERRED')
    const mediaId = randomUUID()
    await client.query(`INSERT INTO media_assets (
      id, media_type, status, object_key, original_filename, mime_type, size_bytes,
      checksum_sha256, created_by_user_id, updated_at
    ) VALUES ($1, 'DOCUMENT', 'READY', $2, 'test.pdf', 'application/pdf', 1, $3, $4, NOW())`,
    [mediaId, `assets/records-e2e/${mediaId}.pdf`, 'a'.repeat(64), actorId])
    return client.query(`INSERT INTO purchase_order_documents (
      purchase_order_id, media_asset_id, payment_id, document_type, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [documentOrderId, mediaId, paymentId, type, actorId])
  }

  async function rejectConstraint(action: () => Promise<unknown>, constraint: string, code = '23514') {
    await client.query('SAVEPOINT expected_rejection')
    try {
      await expect((async () => {
        await action()
        await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      })()).rejects.toMatchObject({ code, constraint })
    }
    finally {
      await client.query('ROLLBACK TO SAVEPOINT expected_rejection')
      await client.query('RELEASE SAVEPOINT expected_rejection')
    }
  }

  beforeAll(async () => {
    database = await createPurchaseShippingMarkDatabase(false, false, false, false, true)
    client = new Client({ connectionString: database.databaseUrl })
    await client.connect()
    await client.query('BEGIN')
    await client.query(`INSERT INTO users (
      id, username, username_normalized, display_name, password_hash, password_changed_at, updated_at
    ) VALUES ($1, $2, $2, 'Records E2E', 'not-a-real-password-hash', NOW(), NOW())`,
    [actorId, `records-e2e-${actorId}`])
    await createOrder(orderId)
    await createOrder(secondOrderId)
    await createOrder(voucherOrderId)
    await createOrder(summaryOrderId)
    // 真实历史付款在新增应付/资金约束之前落库；升级后不得新建无资金关联的付款事实。
    await client.query(`INSERT INTO purchase_order_payments (
      id, purchase_order_id, payment_type, amount, paid_at, payment_method, created_by_user_id
    ) VALUES ($1, $2, 'OTHER', 30, NOW(), 'BANK', $3)`, [legacyVoucherPaymentId, voucherOrderId, actorId])
    await client.query(`UPDATE purchase_orders SET payment_status = 'PARTIALLY_PAID' WHERE id = $1`, [voucherOrderId])
    await client.query(`INSERT INTO purchase_order_payments (
      purchase_order_id, payment_type, amount, paid_at, payment_method, created_by_user_id
    ) VALUES ($1, 'DEPOSIT', 30, NOW(), 'BANK', $2), ($1, 'OTHER', 40, NOW(), 'BANK', $2), ($1, 'BALANCE', 30, NOW(), 'BANK', $2)`, [summaryOrderId, actorId])
    await client.query(`UPDATE purchase_orders SET payment_status = 'PAID' WHERE id = $1`, [summaryOrderId])
    await client.query('COMMIT')
    await database.applyPayablesMigration()
    await client.query('BEGIN')
  })
  beforeEach(async () => { await client.query('SAVEPOINT records_case') })
  afterEach(async () => { await client.query('ROLLBACK TO SAVEPOINT records_case') })
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK')
      await client.end()
    }
    await database?.dispose()
  })

  it('allows one purchase document and multiple receipts without changing fulfillment', async () => {
    await addDocument('ORDER_ISSUANCE_VOUCHER')
    await addDocument('DELIVERY_RECEIPT')
    await addDocument('DELIVERY_RECEIPT')
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const order = await client.query('SELECT fulfillment_status, payment_status FROM purchase_orders WHERE id = $1', [orderId])
    expect(order.rows).toEqual([{ fulfillment_status: 'ORDERED', payment_status: 'UNPAID' }])
    await rejectConstraint(() => addDocument('ORDER_ISSUANCE_VOUCHER'), 'purchase_order_documents_active_issuance_key', '23505')
    await rejectConstraint(() => addDocument('PAYMENT_VOUCHER'), 'purchase_order_documents_payment_shape_check')
  })

  it('guards voucher ownership, payment shape and one active voucher per payment', async () => {
    const paymentId = legacyVoucherPaymentId
    await addDocument('PAYMENT_VOUCHER', paymentId, voucherOrderId)
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await rejectConstraint(() => addDocument('PAYMENT_VOUCHER', paymentId, voucherOrderId), 'purchase_order_documents_active_payment_voucher_key', '23505')
    await rejectConstraint(() => addDocument('DELIVERY_RECEIPT', paymentId, voucherOrderId), 'purchase_order_documents_payment_shape_check')
    await rejectConstraint(() => client.query(`UPDATE purchase_order_documents SET purchase_order_id = $1 WHERE payment_id = $2`,
      [secondOrderId, paymentId]), 'purchase_order_documents_payment_order_check')
  })

  it('sums DEPOSIT, OTHER and BALANCE and excludes voided payments', async () => {
    await client.query(`UPDATE purchase_order_payments SET voided_at = NOW(), voided_by_user_id = $2, void_reason = 'Duplicate'
      WHERE purchase_order_id = $1 AND payment_type = 'OTHER'`, [summaryOrderId, actorId])
    await client.query(`UPDATE purchase_orders SET payment_status = 'PARTIALLY_PAID' WHERE id = $1`, [summaryOrderId])
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    const sum = await client.query('SELECT SUM(amount)::text AS paid FROM purchase_order_payments WHERE purchase_order_id = $1 AND voided_at IS NULL', [summaryOrderId])
    expect(sum.rows).toEqual([{ paid: '60.00' }])
  })

  it('requires balanced, changed amount snapshots and immutable nonblank reasons', async () => {
    const insert = (reason: string, balance: number) => client.query(`INSERT INTO purchase_order_amount_revisions (
      purchase_order_id, old_line_subtotal_amount, old_purchase_total_amount, old_deposit_due_amount, old_balance_due_amount,
      new_line_subtotal_amount, new_purchase_total_amount, new_deposit_due_amount, new_balance_due_amount, reason, changed_by_user_id
    ) VALUES ($1, 100, 100, 30, 70, 100, 100, 20, $2, $3, $4)`, [orderId, balance, reason, actorId])
    await rejectConstraint(() => insert(' \n\t ', 80), 'purchase_order_amount_revisions_reason_check')
    await rejectConstraint(() => insert('Changed terms', 90), 'purchase_order_amount_revisions_amounts_check')
    await insert('Changed terms', 80)
    await rejectConstraint(() => client.query('UPDATE purchase_order_amount_revisions SET reason = $1 WHERE purchase_order_id = $2',
      ['Rewrite history', orderId]), 'purchase_order_amount_revision_immutable_check')
    await rejectConstraint(() => client.query('DELETE FROM purchase_order_amount_revisions WHERE purchase_order_id = $1', [orderId]),
      'purchase_order_amount_revision_immutable_check')
  })
})
