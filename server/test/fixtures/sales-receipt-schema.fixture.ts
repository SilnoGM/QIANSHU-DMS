import { randomBytes, randomUUID } from 'node:crypto'
import type { Client } from 'pg'

export async function insertFixture(client: Client) {
  const userId = randomUUID()
  const countryId = randomUUID()
  const provinceId = randomUUID()
  const cityId = randomUUID()
  const salesOrderId = randomUUID()
      await client.query(`
        INSERT INTO "users" (
          "id", "username", "username_normalized", "display_name",
          "password_hash", "password_changed_at", "updated_at"
        )
        VALUES (
          $1, $2, $2, '销售订单测试用户', 'hash',
          clock_timestamp(), clock_timestamp()
        )
      `, [userId, `sales-order-${randomUUID()}`])
      await client.query(`
        INSERT INTO "regions" (
          "id", "code", "name", "normalized_name",
          "administrative_type", "level", "parent_id"
        )
        VALUES
          ($1, $4, $7, $7, 'COUNTRY', 'COUNTRY_REGION', NULL),
          ($2, $5, $8, $8, 'PROVINCE', 'PROVINCE_STATE', $1),
          ($3, $6, $9, $9, 'CITY', 'CITY', $2)
      `, [
        countryId,
        provinceId,
        cityId,
        `C-${randomUUID().toUpperCase()}`,
        `P-${randomUUID().toUpperCase()}`,
        `CITY-${randomUUID().toUpperCase()}`,
        `测试国家-${randomUUID()}`,
        `测试省州-${randomUUID()}`,
        `测试城市-${randomUUID()}`,
      ])

      await client.query(`
        INSERT INTO "sales_orders" (
          "id", "order_no", "create_idempotency_key_hash",
          "create_request_fingerprint_hash", "order_date", "issuer_user_id",
          "currency_code", "customer_name", "customer_phone",
          "customer_country_region_id", "customer_province_state_id",
          "customer_city_id", "customer_country_region_code_snapshot",
          "customer_province_state_code_snapshot", "customer_city_code_snapshot",
          "customer_country_region_name_snapshot",
          "customer_province_state_name_snapshot", "customer_city_name_snapshot",
          "customer_address_detail", "customer_full_address_snapshot",
          "line_subtotal_amount", "agreed_total_amount",
          "deposit_due_amount", "balance_due_amount"
        )
        VALUES (
          $1, $2, $3, $4, CURRENT_DATE, $5,
          'TWD', '测试客户', '0912345678',
          $6, $7, $8, 'TW', 'TW-TPE', 'TW-KHH',
          '中国台湾', '台湾', '高雄市',
          '苓雅区中正一路100号3楼',
          '中国台湾台湾高雄市苓雅区中正一路100号3楼',
          1000, 1000, 300, 700
        )
      `, [
        salesOrderId,
        `SO-${randomUUID()}`,
        randomBytes(32),
        randomBytes(32),
        userId,
        countryId,
        provinceId,
        cityId,
      ])
      await client.query(`
        INSERT INTO "sales_order_lines" (
          "sales_order_id", "line_number", "line_type",
          "product_name_snapshot", "quantity", "actual_unit_price_amount",
          "line_total_amount"
        )
        VALUES ($1, 1, 'CUSTOM', '临时产品', 2, 500, 1000)
      `, [salesOrderId])


  const assetId = randomUUID()
  await client.query(`INSERT INTO media_assets (id, media_type, status, object_key, original_filename,
    mime_type, size_bytes, checksum_sha256, width, height, created_by_user_id)
    VALUES ($1, 'IMAGE', 'READY', $2, 'fixture.png', 'image/png', 128, $3, 10, 10, $4)`,
  [assetId, `receipt-fixture/${assetId}.png`, 'a'.repeat(64), userId])
  return { userId, salesOrderId, assetId }
}

export async function insertRequest(client: Client, fixture: Awaited<ReturnType<typeof insertFixture>>, amount = '100') {
  const result = await client.query<{ id: string }>(`INSERT INTO sales_receipt_requests
    (sales_order_id, account_owner_user_id, payment_type, amount, currency_code, received_at,
    payment_method, payment_method_name_snapshot, voucher_media_asset_id, voucher_title,
    submitted_by_user_id, idempotency_key_hash, request_fingerprint_hash)
    VALUES ($1,$2,'DEPOSIT',$3,'TWD',CURRENT_TIMESTAMP,'bank_transfer','银行转账',$4,'测试凭证',$2,$5,$6) RETURNING id`,
  [fixture.salesOrderId, fixture.userId, amount, fixture.assetId, randomBytes(32), randomBytes(32)])
  return result.rows[0].id
}
