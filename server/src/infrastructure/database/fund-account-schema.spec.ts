import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  FUND_ACCOUNT_PERMISSION_CODES,
  MANAGEMENT_PERMISSION_CODES,
} from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory = '20260818090000_fund_account_domain_foundation'
const migrationPath = resolve(
  serverRoot,
  `prisma/migrations/${migrationDirectory}/migration.sql`,
)
const precisionMigrationDirectory =
  '20260819090000_fund_account_two_decimal_precision'
const precisionMigrationPath = resolve(
  serverRoot,
  `prisma/migrations/${precisionMigrationDirectory}/migration.sql`,
)

const FUND_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000148', 'fund-accounts:create'],
  [
    '00000000-0000-4000-8000-000000000149',
    'fund-accounts:update-share-rate',
  ],
  ['00000000-0000-4000-8000-000000000150', 'fund-accounts:manual-adjust'],
  ['00000000-0000-4000-8000-000000000151', 'fund-transactions:reverse'],
  ['00000000-0000-4000-8000-000000000152', 'fund-posting-types:manage'],
  [
    '00000000-0000-4000-8000-000000000153',
    'fund-business-sources:manage',
  ],
] as const

const FUND_AUDIT_EVENT_TYPES = [
  'FUND_ACCOUNT_CREATED',
  'FUND_ACCOUNT_SHARE_RATE_UPDATED',
  'FUND_POSTING_TYPE_CREATED',
  'FUND_POSTING_TYPE_UPDATED',
  'FUND_POSTING_TYPE_ENABLED',
  'FUND_POSTING_TYPE_DISABLED',
  'FUND_POSTING_RULE_PUBLISHED',
  'FUND_BUSINESS_SOURCE_CREATED',
  'FUND_BUSINESS_SOURCE_UPDATED',
  'FUND_BUSINESS_SOURCE_ENABLED',
  'FUND_BUSINESS_SOURCE_DISABLED',
  'FUND_MANUAL_ADJUSTMENT_POSTED',
  'FUND_BUSINESS_POSTED',
  'FUND_POSTING_REVERSED',
] as const

const INITIAL_POSTING_TYPE_CODES = [
  'ORDER_SETTLEMENT',
  'USER_WITHDRAWAL',
  'PURCHASE_PAYMENT',
  'RENT_UTILITIES',
  'BUSINESS_ACCOUNT_FEE',
  'ADVERTISING_FEE',
  'NETWORK_IP_VPN_FEE',
  'INVOICE_FEE',
  'ADMIN_MANUAL_ADJUSTMENT',
] as const

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function readPrecisionMigration(): string {
  return readFileSync(precisionMigrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) throw new Error(`Missing Prisma model ${modelName}`)
  return match[1]
}

function extractEnumValues(schema: string, enumName: string): string[] {
  const match = schema.match(
    new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) throw new Error(`Missing Prisma enum ${enumName}`)
  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Z][A-Z0-9_]*$/u.test(line))
}

describe('fund account domain database schema', () => {
  it('defines the confirmed enums and eight Prisma models', () => {
    const schema = readSchema()
    const enums = {
      FundAccountOwnerType: ['USER', 'COMPANY'],
      FundBusinessCategory: ['REVENUE', 'COST', 'NEUTRAL', 'ADJUSTMENT'],
      FundAmountSignPolicy: ['POSITIVE_ONLY', 'NON_ZERO_SIGNED'],
      FundRuleInputMode: ['STANDARD', 'ADMIN_ADJUSTMENT'],
      FundPostingRuleStatus: ['DRAFT', 'ACTIVE', 'RETIRED'],
      FundAccountTarget: ['USER', 'COMPANY'],
      FundEntryDirection: ['CREDIT', 'DEBIT'],
      FundDirectionPolicy: ['CREDIT', 'DEBIT', 'FOLLOW_AMOUNT_SIGN'],
      FundAmountStrategy: [
        'FULL_AMOUNT',
        'USER_SHARE',
        'COMPANY_REMAINDER',
      ],
      FundAdjustmentMode: ['USER_ONLY', 'USER_AND_COMPANY_BY_SHARE'],
      FundPostingBatchKind: ['BUSINESS', 'MANUAL_ADJUSTMENT', 'REVERSAL'],
    } as const

    for (const [enumName, values] of Object.entries(enums)) {
      expect(extractEnumValues(schema, enumName)).toEqual(values)
    }

    for (const modelName of [
      'FundAccount',
      'FundBusinessSource',
      'FundPostingType',
      'FundPostingRuleVersion',
      'FundPostingRuleLeg',
      'FundBusinessSourcePostingType',
      'FundPostingBatch',
      'FundLedgerEntry',
    ]) {
      expect(schema).toContain(`model ${modelName} {`)
    }
  })

  it('keeps money, ownership, snapshots and restrictive relations explicit', () => {
    const schema = readSchema()
    const account = extractModel(schema, 'FundAccount')
    const postingType = extractModel(schema, 'FundPostingType')
    const ruleVersion = extractModel(schema, 'FundPostingRuleVersion')
    const batch = extractModel(schema, 'FundPostingBatch')
    const entry = extractModel(schema, 'FundLedgerEntry')

    expect(account).toMatch(/balance\s+Decimal\s+@default\(0\) @db\.Decimal\(30, 2\)/u)
    expect(account).toContain('@map("user_share_rate") @db.Decimal(7, 2)')
    expect(account).toContain('@map("next_sequence") @db.BigInt')
    expect(account).toContain(
      '@relation("FundAccountUser", fields: [userId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
    )
    expect(account).toContain('@@map("fund_accounts")')

    expect(postingType).toContain('@map("current_rule_version_id") @db.Uuid')
    expect(ruleVersion).toContain(
      '@@unique([postingTypeId, revision], map: "fund_posting_rule_versions_posting_type_id_revision_key")',
    )
    expect(ruleVersion).toContain(
      '@@unique([id, postingTypeId], map: "fund_posting_rule_versions_id_posting_type_id_key")',
    )

    for (const field of [
      'batchNo',
      'kind',
      'postingTypeId',
      'postingTypeCodeSnapshot',
      'postingTypeNameSnapshot',
      'businessCategorySnapshot',
      'businessSourceId',
      'businessSourceCodeSnapshot',
      'businessSourceNameSnapshot',
      'ruleVersionId',
      'ruleRevisionSnapshot',
      'userId',
      'businessAmount',
      'currency',
      'userShareRateSnapshot',
      'companyShareRateSnapshot',
      'businessId',
      'businessNo',
      'summary',
      'metadata',
      'businessOccurredAt',
      'consumerCode',
      'idempotencyKeyHash',
      'requestFingerprintHash',
      'adjustmentMode',
      'reversalOfBatchId',
      'reversalReason',
      'actorUserId',
      'requestId',
      'correlationId',
      'postedAt',
    ]) {
      expect(batch).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(batch).toContain('@map("business_amount") @db.Decimal(30, 2)')
    expect(batch).toContain('@map("user_share_rate_snapshot") @db.Decimal(7, 2)')
    expect(batch).toContain('@map("company_share_rate_snapshot") @db.Decimal(7, 2)')
    expect(batch).not.toMatch(/updatedAt\s/u)

    expect(entry).toMatch(/amount\s+Decimal\s+@db\.Decimal\(30, 2\)/u)
    expect(entry).toContain('@map("balance_before") @db.Decimal(30, 2)')
    expect(entry).toContain('@map("balance_after") @db.Decimal(30, 2)')
    expect(entry).toContain('@map("account_sequence") @db.BigInt')
    expect(entry).not.toMatch(/updatedAt\s/u)
  })

  it('fails closed before narrowing all eight persisted precision columns', () => {
    const migration = readPrecisionMigration()

    for (const [table, column] of [
      ['fund_accounts', 'balance'],
      ['fund_accounts', 'user_share_rate'],
      ['fund_posting_batches', 'business_amount'],
      ['fund_posting_batches', 'user_share_rate_snapshot'],
      ['fund_posting_batches', 'company_share_rate_snapshot'],
      ['fund_ledger_entries', 'amount'],
      ['fund_ledger_entries', 'balance_before'],
      ['fund_ledger_entries', 'balance_after'],
    ] as const) {
      expect(migration).toContain(`FROM "${table}"`)
      expect(migration).toContain(`"${column}" <> round("${column}", 2)`)
    }

    expect(migration).not.toMatch(/UPDATE\s+"fund_/iu)
    expect(migration).toContain('NUMERIC(30, 2)')
    expect(migration).toContain('NUMERIC(7, 2)')
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
  })

  it('creates named constraints, indexes and immutable triggers', () => {
    const migration = readMigration()

    for (const constraintName of [
      'fund_accounts_owner_shape_check',
      'fund_accounts_currency_cny_check',
      'fund_accounts_balance_scale_check',
      'fund_accounts_user_share_rate_range_check',
      'fund_accounts_next_sequence_positive_check',
      'fund_accounts_version_positive_check',
      'fund_business_sources_code_format_check',
      'fund_business_sources_name_nonblank_check',
      'fund_business_sources_version_positive_check',
      'fund_posting_types_code_format_check',
      'fund_posting_types_name_nonblank_check',
      'fund_posting_types_version_positive_check',
      'fund_posting_rule_versions_revision_positive_check',
      'fund_posting_rule_versions_status_shape_check',
      'fund_posting_rule_legs_position_positive_check',
      'fund_posting_rule_legs_adjustment_shape_check',
      'fund_posting_batches_currency_cny_check',
      'fund_posting_batches_business_amount_nonzero_check',
      'fund_posting_batches_share_snapshot_check',
      'fund_posting_batches_hash_length_check',
      'fund_posting_batches_kind_shape_check',
      'fund_ledger_entries_line_no_positive_check',
      'fund_ledger_entries_amount_positive_check',
      'fund_ledger_entries_balance_equation_check',
      'fund_ledger_entries_account_sequence_positive_check',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'fund_accounts_user_id_key',
      'fund_accounts_one_company_key',
      'fund_business_sources_code_key',
      'fund_posting_types_code_key',
      'fund_posting_rule_versions_posting_type_id_revision_key',
      'fund_posting_rule_versions_one_active_key',
      'fund_posting_rule_versions_one_draft_key',
      'fund_posting_rule_legs_rule_version_id_position_key',
      'fund_posting_batches_batch_no_key',
      'fund_posting_batches_consumer_source_idempotency_key',
      'fund_ledger_entries_batch_id_line_no_key',
      'fund_ledger_entries_account_id_account_sequence_key',
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE UNIQUE INDEX "${indexName}"`, 'u'),
      )
    }

    for (const triggerName of [
      'fund_accounts_identity_immutable_trigger',
      'fund_business_sources_code_immutable_trigger',
      'fund_posting_types_code_immutable_trigger',
      'fund_posting_types_current_rule_guard_trigger',
      'fund_posting_rule_versions_immutable_trigger',
      'fund_posting_rule_legs_parent_guard_trigger',
      'fund_posting_batches_immutable_trigger',
      'fund_ledger_entries_immutable_trigger',
    ]) {
      expect(migration).toContain(`CREATE TRIGGER "${triggerName}"`)
    }
    expect(migration).toMatch(
      /fund_posting_batches_immutable_trigger[\s\S]*?BEFORE UPDATE OR DELETE/u,
    )
    expect(migration).toMatch(
      /fund_ledger_entries_immutable_trigger[\s\S]*?BEFORE UPDATE OR DELETE/u,
    )
  })

  it('seeds the exact company account, configuration, permissions and audits', () => {
    const schema = readSchema()
    const migration = readMigration()

    expect(readdirSync(resolve(serverRoot, 'prisma/migrations'), {
      withFileTypes: true,
    }).filter(entry => (
      entry.isDirectory() && entry.name.includes('fund_account_domain_foundation')
    )).map(entry => entry.name)).toEqual([migrationDirectory])
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    for (const eventType of FUND_AUDIT_EVENT_TYPES) {
      expect(extractEnumValues(schema, 'AuditEventType')).toContain(eventType)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }

    expect(FUND_ACCOUNT_PERMISSION_CODES).toEqual([
      'fund-accounts:read',
      ...FUND_PERMISSION_SEEDS.map(([, code]) => code),
    ])
    expect(MANAGEMENT_PERMISSION_CODES).toEqual(
      expect.arrayContaining([...FUND_ACCOUNT_PERMISSION_CODES]),
    )
    for (const [id, code] of FUND_PERMISSION_SEEDS) {
      expect(migration).toMatch(
        new RegExp(`'${id}',\\s*'${code}'[\\s\\S]*?true`, 'u'),
      )
    }

    expect(migration).toContain(
      "'00000000-0000-4000-8000-000000002001'",
    )
    expect(migration).toContain("'ADMIN_CONSOLE'")
    for (const code of INITIAL_POSTING_TYPE_CODES) {
      expect(migration).toContain(`'${code}'`)
    }
    expect(migration).toContain(
      'fund account domain migration invariant mismatch: table count',
    )
    expect(migration).toContain(
      'fund account domain migration invariant mismatch: seed counts',
    )
    expect(migration).not.toMatch(
      /INSERT INTO "fund_posting_batches"|INSERT INTO "fund_ledger_entries"/u,
    )
  })
})
