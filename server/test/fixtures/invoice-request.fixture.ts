import { randomBytes, randomUUID } from 'node:crypto'
import type { Client } from 'pg'
import { calculateNumberingConfigFingerprint } from '../../src/modules/numbering/numbering-config-fingerprint'

/**
 * 隔离测试用的开票申请夹具。
 *
 * 生产迁移绝不替管理员配置或启用编号规则，所以这里的规则与派发台账都由测试自己建——
 * 申请单的编号身份触发器要求 invoice_no 必须来自 INVOICE_REQUEST 规则的派发台账。
 * 全部语句都是静态 SQL 串加 $N 占位符，业务值一律走参数数组。
 */

export async function insertUser(client: Client, label: string): Promise<string> {
  const userId = randomUUID()
  const username = ['invoice_e2e', label, randomUUID().replaceAll('-', '')].join('_')
  await client.query(
    'INSERT INTO "users" ("id", "username", "username_normalized", "display_name", "password_hash", "password_changed_at", "updated_at") VALUES ($1, $2, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [userId, username, 'Invoice Request E2E ' + label, 'not-used'],
  )
  return userId
}

export async function ensureInvoiceRequestRule(
  client: Client,
  ruleCode = 'INVOICE_REQUEST',
): Promise<{ ruleId: string; ruleVersionId: string }> {
  const existing = await client.query<{ ruleId: string; ruleVersionId: string }>(
    'SELECT rule.id AS "ruleId", version.id AS "ruleVersionId" FROM numbering_rules rule JOIN numbering_rule_versions version ON version.rule_id = rule.id AND version.status = $1 WHERE rule.rule_code = $2',
    ['ACTIVE', ruleCode],
  )
  if (existing.rows[0]) return existing.rows[0]

  const rule = await client.query<{ id: string }>(
    'INSERT INTO numbering_rules (rule_code, name, purpose) VALUES ($1, $2, $3) RETURNING id',
    [ruleCode, '开票申请编号测试规则', 'BUSINESS'],
  )
  const ruleId = rule.rows[0].id
  const fingerprint = calculateNumberingConfigFingerprint({
    resetPolicy: 'NEVER',
    segments: [
      { type: 'FIXED', value: 'INV' },
      { type: 'SEPARATOR', value: '/' },
      { type: 'SEQUENCE', width: 4, startValue: '1', step: '1' },
    ],
  })
  const version = await client.query<{ id: string }>(
    'INSERT INTO numbering_rule_versions (rule_id, revision, reset_policy, config_fingerprint) VALUES ($1, $2, $3, $4) RETURNING id',
    [ruleId, 1, 'NEVER', fingerprint],
  )
  const ruleVersionId = version.rows[0].id
  await client.query(
    'INSERT INTO numbering_rule_segments (version_id, position, type, fixed_value, separator_value, sequence_width, sequence_start_value, sequence_step) VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL), ($1, $5, $6, NULL, $7, NULL, NULL, NULL), ($1, $8, $9, NULL, NULL, $10, $11, $12)',
    [ruleVersionId, 0, 'FIXED', 'INV', 1, 'SEPARATOR', '/', 2, 'SEQUENCE', 4, '1', '1'],
  )
  await client.query(
    'UPDATE numbering_rule_versions SET status = $2, published_at = CURRENT_TIMESTAMP WHERE id = $1',
    [ruleVersionId, 'ACTIVE'],
  )
  await client.query(
    'UPDATE numbering_rules SET status = $2, version = $3 WHERE id = $1',
    [ruleId, 'ENABLED', 3],
  )
  return { ruleId, ruleVersionId }
}

export async function insertInvoiceRequestIssuance(
  client: Client,
  requestFingerprintHash: Buffer,
  options: { consumerCode?: string; ruleCode?: string } = {},
): Promise<{ invoiceNo: string; numberingIssuanceId: string }> {
  const rule = await ensureInvoiceRequestRule(client, options.ruleCode)
  const state = await client.query<{ value: string }>(
    'INSERT INTO numbering_period_states (rule_id, period_key, next_sequence_value, used_count) VALUES ($1, $2, $3, $4) ON CONFLICT (rule_id, period_key) DO UPDATE SET next_sequence_value = numbering_period_states.next_sequence_value + 1, used_count = numbering_period_states.used_count + 1 RETURNING (next_sequence_value - 1)::text AS value',
    [rule.ruleId, 'ALL', 2, 1],
  )
  const sequenceValue = state.rows[0].value
  const invoiceNo = ['INV/20261014-', sequenceValue.padStart(4, '0')].join('')
  const issuance = await client.query<{ id: string }>(
    'INSERT INTO numbering_issuances (rule_id, rule_version_id, period_key, generated_number, sequence_value, consumer_code, idempotency_key_hash, request_fingerprint_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [
      rule.ruleId,
      rule.ruleVersionId,
      'ALL',
      invoiceNo,
      sequenceValue,
      options.consumerCode ?? 'INVOICE_REQUEST.CREATE',
      randomBytes(32),
      requestFingerprintHash,
    ],
  )
  return { invoiceNo, numberingIssuanceId: issuance.rows[0].id }
}

export interface InvoiceRequestSeed {
  readonly actorUserId: string
  readonly buyerTaxId?: string
  readonly invoiceNo?: string
  readonly numberingIssuanceId?: string
  readonly salesAmount?: number
  readonly taxAmount?: number
  readonly totalAmount?: number
  readonly withDefaultLine?: boolean
}

export async function insertInvoiceRequest(
  client: Client,
  seed: InvoiceRequestSeed,
): Promise<{ requestId: string; invoiceNo: string }> {
  const issuance = seed.numberingIssuanceId && seed.invoiceNo
    ? { invoiceNo: seed.invoiceNo, numberingIssuanceId: seed.numberingIssuanceId }
    : await insertInvoiceRequestIssuance(client, randomBytes(32))
  const salesAmount = seed.salesAmount ?? 270_000
  const taxAmount = seed.taxAmount ?? 13_500
  const requestId = randomUUID()
  await client.query(
    'INSERT INTO "invoice_requests" ("id", "invoice_no", "numbering_issuance_id", "buyer_name", "buyer_tax_id", "sales_amount", "tax_amount", "total_amount", "invoice_remark", "internal_remark", "recipient_name", "recipient_phone", "recipient_address", "last_submitted_at", "request_key_hash", "created_by_id") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, $14, $15)',
    [
      requestId,
      issuance.invoiceNo,
      issuance.numberingIssuanceId,
      '正苗工程股份有限公司',
      seed.buyerTaxId ?? '89697375',
      salesAmount,
      taxAmount,
      seed.totalAmount ?? salesAmount + taxAmount,
      '150鄂破',
      '内部备注',
      '林采榛',
      '0912345678',
      '新北市林口區公園路203號',
      randomBytes(32),
      seed.actorUserId,
    ],
  )
  if (seed.withDefaultLine !== false) {
    await insertInvoiceRequestLine(client, {
      lineNo: 1,
      requestId,
      unitPrice: salesAmount,
    })
  }
  return { requestId, invoiceNo: issuance.invoiceNo }
}

export async function insertInvoiceRequestLine(
  client: Client,
  input: {
    readonly amount?: number
    readonly lineNo: number
    readonly productName?: string
    readonly quantity?: number
    readonly requestId: string
    readonly unitPrice?: number
  },
): Promise<string> {
  const lineId = randomUUID()
  const quantity = input.quantity ?? 1
  const unitPrice = input.unitPrice ?? 90_000
  await client.query(
    'INSERT INTO "invoice_request_lines" ("id", "request_id", "line_no", "product_name", "quantity", "unit_price", "amount") VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      lineId,
      input.requestId,
      input.lineNo,
      input.productName ?? '焚燒爐 ' + String(input.lineNo),
      quantity,
      unitPrice,
      input.amount ?? quantity * unitPrice,
    ],
  )
  return lineId
}

/** 插入一张可用的发票照片：先 UPLOADING，再按需激活为 READY 并打上用途标记。 */
export async function insertInvoiceDocumentAsset(
  client: Client,
  actorUserId: string,
  options: { purpose?: string; ready?: boolean } = {},
): Promise<string> {
  const assetId = randomUUID()
  await client.query(
    'INSERT INTO "media_assets" ("id", "media_type", "original_filename", "upload_expires_at", "created_by_user_id", "upload_purpose") VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL \'24 hours\', $4, $5)',
    [assetId, 'IMAGE', 'invoice.jpg', actorUserId, options.purpose ?? 'INVOICE_REQUEST_DOCUMENT'],
  )
  if (options.ready !== false) {
    await client.query(
      'UPDATE "media_assets" SET "status" = $2, "object_key" = $3, "mime_type" = $4, "size_bytes" = $5, "checksum_sha256" = $6, "width" = $7, "height" = $8, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1',
      [
        assetId,
        'READY',
        ['assets/dev/invoice/2026/10/', assetId, '.jpg'].join(''),
        'image/jpeg',
        3,
        'a'.repeat(64),
        64,
        64,
      ],
    )
  }
  return assetId
}

export async function insertStatusHistory(
  client: Client,
  input: {
    readonly action: string
    readonly actorUserId: string
    readonly fromStatus: string | null
    readonly reason?: string | null
    readonly requestId: string
    readonly toStatus: string
  },
): Promise<string> {
  const id = randomUUID()
  await client.query(
    'INSERT INTO "invoice_request_status_history" ("id", "request_id", "action", "from_status", "to_status", "reason", "actor_user_id") VALUES ($1, $2, $3::"invoice_request_action", $4::"invoice_request_status", $5::"invoice_request_status", $6, $7)',
    [id, input.requestId, input.action, input.fromStatus, input.toStatus, input.reason ?? null, input.actorUserId],
  )
  return id
}
