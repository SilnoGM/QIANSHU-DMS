import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261102160000_advertising_recharge/migration.sql'),
  'utf8',
)

const PERMISSION_CODES = [
  'network-nodes:read',
  'advertising-recharges:read-self',
  'advertising-recharges:create',
  'advertising-recharges:read',
  'advertising-recharges:pay',
] as const

const AUDIT_EVENT_TYPES = [
  'ADVERTISING_RECHARGE_SUBMITTED',
  'ADVERTISING_RECHARGE_PAID',
  'ADVERTISING_RECHARGE_REJECTED',
  'ADVERTISING_RECHARGE_WITHDRAWN',
  'ADVERTISING_RECHARGE_VOIDED',
] as const

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'u'))
  if (match === null) throw new Error(`model ${name} missing`)
  return match[0]
}

function enumBlock(name: string): string {
  const match = schema.match(new RegExp(`enum ${name} \\{[\\s\\S]*?\\n\\}`, 'u'))
  if (match === null) throw new Error(`enum ${name} missing`)
  return match[0]
}

describe('advertising recharge database contract', () => {
  it('declares both enums and the new fund source kind in Prisma', () => {
    expect(enumBlock('AdvertisingAccountType')).toContain('PERSONAL')
    expect(enumBlock('AdvertisingAccountType')).toContain('NON_PERSONAL')
    expect(enumBlock('AdvertisingAccountType')).toContain('@@map("advertising_account_type")')
    const status = enumBlock('AdvertisingRechargeStatus')
    for (const value of ['PENDING', 'PAID', 'REJECTED', 'WITHDRAWN', 'VOIDED']) {
      expect(status).toContain(value)
    }
    expect(status).toContain('@@map("advertising_recharge_status")')
    expect(enumBlock('FundPostingSourceKind')).toContain('ADVERTISING_RECHARGE')
  })

  it('keeps every immutable fact and evidence reference on the model', () => {
    const model = modelBlock('AdvertisingRechargeRequest')
    for (const field of [
      'rechargeNo',
      'numberingIssuanceId',
      'applicantUserId',
      'accountType',
      'adAccountName',
      'adAccountNo',
      'rechargeAmount',
      'rechargeCurrency',
      'paymentQrMediaAssetId',
      'paymentAmountCny',
      'paymentProofMediaAssetId',
      'paidByUserId',
      'fundPostingBatchId',
      'rejectReason',
      'withdrawnAt',
      'voidedByUserId',
      'voidReason',
      'fundReversalBatchId',
      'requestKeyHash',
      'version',
    ]) {
      expect(model).toContain(field)
    }
    expect(model).toContain('@@map("advertising_recharge_requests")')
    expect(model).toContain('@@unique([applicantUserId, requestKeyHash]')
  })

  it('creates the table with status, currency, amount and QR shape constraints', () => {
    expect(migration).toContain('CREATE TYPE "advertising_account_type" AS ENUM')
    expect(migration).toContain('CREATE TYPE "advertising_recharge_status" AS ENUM')
    expect(migration).toContain('CREATE TABLE "advertising_recharge_requests"')
    expect(migration).toContain('"recharge_currency" IN (\'CNY\', \'USD\')')
    expect(migration).toContain('"recharge_amount" > 0 AND "recharge_amount" = round("recharge_amount", 2)')
    expect(migration).toContain('("account_type" = \'PERSONAL\' AND "payment_qr_media_asset_id" IS NOT NULL)')
    expect(migration).toContain('("account_type" = \'NON_PERSONAL\' AND "payment_qr_media_asset_id" IS NULL)')
    expect(migration).toContain('advertising_recharge_requests_status_shape_check')
    expect(migration).toContain('"status" = \'VOIDED\'')
    // 申请单本身是资金事实，缺失唯一性会让一张截图或一个批次被多单复用。
    for (const index of [
      'advertising_recharge_requests_number_key',
      'advertising_recharge_requests_issuance_key',
      'advertising_recharge_requests_qr_key',
      'advertising_recharge_requests_proof_key',
      'advertising_recharge_requests_posting_batch_key',
      'advertising_recharge_requests_reversal_batch_key',
    ]) {
      expect(migration).toContain(index)
    }
    expect(migration).not.toMatch(/INSERT INTO "advertising_recharge_requests"/u)
  })

  it('closes number identity, immutability and one-way transitions in the database', () => {
    expect(migration).toContain('CREATE FUNCTION "enforce_advertising_recharge_number_identity"()')
    expect(migration).toContain('issuance."consumer_code" = \'ADVERTISING_RECHARGE.CREATE\'')
    expect(migration).toContain('rule."rule_code" = \'ADVERTISING_RECHARGE_NO\'')
    expect(migration).toContain('CREATE TRIGGER "advertising_recharge_requests_identity_trigger"')
    expect(migration).toContain('CREATE FUNCTION "enforce_advertising_recharge_transition"()')
    expect(migration).toContain('(OLD."status" = \'PENDING\' AND NEW."status" IN (\'PAID\', \'REJECTED\', \'WITHDRAWN\'))')
    expect(migration).toContain('(OLD."status" = \'PAID\' AND NEW."status" = \'VOIDED\')')
    expect(migration).toContain('NEW."version" <> OLD."version" + 1')
    expect(migration).toContain('advertising_recharge_requests_void_identity_check')
  })

  it('seeds the numbering rule, fund source binding, audit events and permissions atomically', () => {
    expect(migration).toContain('\'ADVERTISING_RECHARGE_NO\'')
    expect(migration).toContain('\'ba9c0acd7c474dcfec0d402873cca5ea8edb85c22421ff556f8101f5590a0dde\'')
    expect(migration).toContain(", 'FIXED', 'AD', NULL, NULL, NULL, NULL, NULL)")
    expect(migration).toContain('source."code" = \'ADVERTISING_RECHARGE\'')
    expect(migration).toContain('posting_type."code" = \'ADVERTISING_FEE\'')
    expect(migration).toContain('fund_posting_batches_advertising_recharge_shape_check')
    expect(migration).toContain('fund_posting_batch_sources_link_shape_check')
    expect(migration).toContain('\'ADVERTISING_RECHARGE.PAY\'')
    expect(migration).toContain('\'ADVERTISING_RECHARGE.VOID\'')
    for (const eventType of AUDIT_EVENT_TYPES) {
      expect(migration).toContain(`ADD VALUE IF NOT EXISTS '${eventType}'`)
      expect(enumBlock('AuditEventType')).toContain(eventType)
    }
    for (const code of PERMISSION_CODES) {
      expect(migration).toContain(`'${code}'`)
    }
    expect(migration).toContain('role."code" = \'operations_staff\'')
    expect(migration).toContain('role."code" = \'finance_staff\'')
    expect(migration).toContain('ALTER TYPE "fund_posting_source_kind" ADD VALUE IF NOT EXISTS \'ADVERTISING_RECHARGE\'')
  })

  it('extends media purposes and the READY reference protection for both images', () => {
    expect(migration).toContain('\'ADVERTISING_RECHARGE_QR\'')
    expect(migration).toContain('\'ADVERTISING_RECHARGE_PAYMENT_PROOF\'')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "enforce_ready_media_asset_reference"()')
    expect(migration).toContain('FROM advertising_recharge_requests reference WHERE reference.payment_qr_media_asset_id = reference_asset_id OR reference.payment_proof_media_asset_id = reference_asset_id')
    expect(migration).toContain('upload_purpose = \'ADVERTISING_RECHARGE_QR\'')
    expect(migration).toContain('upload_purpose = \'ADVERTISING_RECHARGE_PAYMENT_PROOF\'')
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER "advertising_recharge_requests_media_ready_trigger"')
  })
})
