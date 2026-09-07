import { createHash, randomUUID } from 'node:crypto'

import { Client } from 'pg'
import { createPurchaseShippingMarkFixture } from './purchase-order-shipping-mark.fixture'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for PurchaseOrder E2E tests')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username !== 'qianshu_ci' || url.pathname !== '/qianshu_ci') {
    throw new Error('Purchase schema tests require the isolated CI database')
  }
  return value
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

async function expectConstraintRejection(
  action: () => Promise<unknown>,
  expectedConstraint: string,
): Promise<void> {
  try {
    await action()
    throw new Error('Expected PostgreSQL constraint rejection')
  }
  catch (error) {
    const safe = error as { code?: unknown, constraint?: unknown }
    expect(safe.code).toBe('23514')
    expect(safe.constraint).toBe(expectedConstraint)
  }
}

describe('purchase order schema with isolated PostgreSQL', () => {
  const client = new Client({ connectionString: requireDatabaseUrl() })
  const actorId = randomUUID()
  const productId = randomUUID()
  const salesOrderId = randomUUID()
  const salesOrderLineId = randomUUID()

  beforeAll(async () => {
    await client.connect()
    // 整组夹具始终留在当前连接的事务中，避免并行 E2E 读取到临时用户、产品和销售订单。
    await client.query('BEGIN')
    await client.query(
      `
        INSERT INTO "users" (
          "id",
          "username",
          "username_normalized",
          "display_name",
          "password_hash",
          "password_changed_at",
          "updated_at"
        )
        VALUES ($1, $2, $2, 'Purchase E2E Actor', 'not-a-real-password-hash', NOW(), NOW())
      `,
      [actorId, `purchase-e2e-${actorId}`],
    )
    await client.query(
      `
        INSERT INTO "products" (
          "id",
          "name",
          "product_no",
          "status",
          "supplier_value",
          "purchase_cost_amount",
          "purchase_cost_currency"
        )
        VALUES ($1, 'Purchase E2E Product', $2, 'ACTIVE', 'SUPPLIER_E2E', 10, 'CNY')
      `,
      [productId, `PUR-E2E-${productId}`],
    )

    const region = await client.query<{
      city_id: string
      country_id: string
      province_id: string
    }>(
      `
        SELECT
          country."id" AS country_id,
          province."id" AS province_id,
          city."id" AS city_id
        FROM "regions" AS city
        JOIN "regions" AS province ON province."id" = city."parent_id"
        JOIN "regions" AS country ON country."id" = province."parent_id"
        WHERE
          city."level" = 'CITY'
          AND province."level" = 'PROVINCE_STATE'
          AND country."level" = 'COUNTRY_REGION'
        ORDER BY city."id"
        LIMIT 1
      `,
    )
    const path = region.rows[0]
    if (!path) throw new Error('Canonical region seed is unavailable')

    await client.query(
      `
        INSERT INTO "sales_orders" (
          "id",
          "order_no",
          "create_idempotency_key_hash",
          "create_request_fingerprint_hash",
          "order_date",
          "issuer_user_id",
          "currency_code",
          "customer_name",
          "customer_phone",
          "customer_country_region_id",
          "customer_province_state_id",
          "customer_city_id",
          "customer_country_region_code_snapshot",
          "customer_province_state_code_snapshot",
          "customer_city_code_snapshot",
          "customer_country_region_name_snapshot",
          "customer_province_state_name_snapshot",
          "customer_city_name_snapshot",
          "customer_address_detail",
          "customer_full_address_snapshot",
          "line_subtotal_amount",
          "agreed_total_amount",
          "deposit_due_amount",
          "balance_due_amount",
          "order_status",
          "payment_status"
        )
        VALUES (
          $1, $2, $3, $4, CURRENT_DATE, $5, 'TWD',
          'Purchase E2E Customer', '0000000000',
          $6, $7, $8,
          'COUNTRY', 'PROVINCE', 'CITY',
          'Country', 'Province', 'City',
          'Detail', 'CountryProvinceCityDetail',
          100, 100, 0, 100, 'CONFIRMED', 'UNPAID'
        )
      `,
      [
        salesOrderId,
        `SO-PUR-E2E-${salesOrderId}`,
        hash(`sales-key-${salesOrderId}`),
        hash(`sales-request-${salesOrderId}`),
        actorId,
        path.country_id,
        path.province_id,
        path.city_id,
      ],
    )
    await client.query(
      `
        INSERT INTO "sales_order_lines" (
          "id",
          "sales_order_id",
          "line_number",
          "line_type",
          "product_id",
          "product_no_snapshot",
          "product_name_snapshot",
          "standard_unit_price_amount",
          "actual_unit_price_amount",
          "quantity",
          "line_total_amount"
        )
        VALUES ($1, $2, 1, 'CATALOG', $3, $4, 'Purchase E2E Product', 100, 100, 1, 100)
      `,
      [salesOrderLineId, salesOrderId, productId, `PUR-E2E-${productId}`],
    )
  })

  afterAll(async () => {
    await client.query('ROLLBACK')
    await client.end()
  })

  it('seeds all purchase permissions and keeps stock creation system-only', async () => {
    const result = await client.query<{
      code: string
      system_only: boolean
    }>(
      `
        SELECT "code", "system_only"
        FROM "permissions"
        WHERE "code" LIKE 'purchase-orders:%'
        ORDER BY "code"
      `,
    )

    expect(result.rows).toEqual([
      { code: 'purchase-orders:create', system_only: false },
      { code: 'purchase-orders:create-stock', system_only: true },
      { code: 'purchase-orders:document', system_only: false },
      { code: 'purchase-orders:payment', system_only: false },
      { code: 'purchase-orders:read', system_only: false },
      { code: 'purchase-orders:update', system_only: false },
    ])
  })

  it('rejects unequal CUSTOM purchase prices at the database boundary', async () => {
    const orderId = randomUUID()
    await client.query('SAVEPOINT custom_price_rejection')
    try {
      const mark = await createPurchaseShippingMarkFixture(client, {
        idempotencyKeyHash: hash(`purchase-key-${orderId}`),
        requestFingerprintHash: hash(`purchase-request-${orderId}`),
      })
      await client.query(
        `
          INSERT INTO "purchase_orders" (
            "id", "order_no", "create_idempotency_key_hash",
            "create_request_fingerprint_hash", "purchase_type", "product_mode",
            "supplier_value", "order_date", "line_subtotal_amount",
            "purchase_total_amount", "deposit_due_amount",
            "balance_due_amount", "payment_status", "created_by_user_id",
            "shipping_mark_issuance_id", "shipping_mark_text"
          )
          VALUES ($1, $2, $3, $4, 'STOCK', 'MIXED', 'SUPPLIER_E2E', CURRENT_DATE, 9, 9, 0, 9, 'UNPAID', $5, $6, $7)
        `,
        [
          orderId,
          `PO-CUSTOM-${orderId}`,
          hash(`purchase-key-${orderId}`),
          hash(`purchase-request-${orderId}`),
          actorId,
          mark.shippingMarkIssuanceId,
          mark.shippingMarkText,
        ],
      )
      await expectConstraintRejection(
        () => client.query(
          `
            INSERT INTO "purchase_order_lines" (
              "purchase_order_id", "line_number", "line_type",
              "product_name_snapshot", "reference_purchase_unit_price_amount",
              "actual_purchase_unit_price_amount", "quantity", "line_total_amount"
            )
            VALUES ($1, 1, 'CUSTOM', 'Temporary Product', 10, 9, 1, 9)
          `,
          [orderId],
        ),
        'purchase_order_lines_custom_prices_equal_check',
      )
    }
    finally {
      await client.query('ROLLBACK TO SAVEPOINT custom_price_rejection')
      await client.query('RELEASE SAVEPOINT custom_price_rejection')
    }
  })

  it('rejects active purchase quantity above the linked sales line quantity', async () => {
    const orderId = randomUUID()
    await client.query('SAVEPOINT source_quantity_rejection')
    try {
      const mark = await createPurchaseShippingMarkFixture(client, {
        idempotencyKeyHash: hash(`purchase-key-${orderId}`),
        requestFingerprintHash: hash(`purchase-request-${orderId}`),
      })
      await client.query(
        `
          INSERT INTO "purchase_orders" (
            "id", "order_no", "create_idempotency_key_hash",
            "create_request_fingerprint_hash", "purchase_type", "product_mode", "sales_order_id",
            "supplier_value", "order_date", "line_subtotal_amount",
            "purchase_total_amount", "deposit_due_amount",
            "balance_due_amount", "payment_status", "created_by_user_id",
            "shipping_mark_issuance_id", "shipping_mark_text"
          )
          VALUES ($1, $2, $3, $4, 'SALES_LINKED', 'CATALOG', $5, 'SUPPLIER_E2E', CURRENT_DATE, 20, 20, 0, 20, 'UNPAID', $6, $7, $8)
        `,
        [
          orderId,
          `PO-OVER-${orderId}`,
          hash(`purchase-key-${orderId}`),
          hash(`purchase-request-${orderId}`),
          salesOrderId,
          actorId,
          mark.shippingMarkIssuanceId,
          mark.shippingMarkText,
        ],
      )
      await client.query(
        `
          INSERT INTO "purchase_order_lines" (
            "purchase_order_id", "line_number", "line_type", "product_id",
            "source_sales_order_line_id", "product_no_snapshot",
            "product_name_snapshot", "reference_purchase_unit_price_amount",
            "actual_purchase_unit_price_amount", "quantity", "line_total_amount"
          )
          VALUES ($1, 1, 'CATALOG', $2, $3, $4, 'Purchase E2E Product', 10, 10, 2, 20)
        `,
        [orderId, productId, salesOrderLineId, `PUR-E2E-${productId}`],
      )
      await expectConstraintRejection(
        () => client.query('SET CONSTRAINTS ALL IMMEDIATE'),
        'purchase_order_source_quantity_check',
      )
    }
    finally {
      await client.query('ROLLBACK TO SAVEPOINT source_quantity_rejection')
      await client.query('RELEASE SAVEPOINT source_quantity_rejection')
    }
  })
})
