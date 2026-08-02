import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MANAGEMENT_PERMISSION_CODES } from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory =
  '20260802090000_numbering_management_schema_and_permissions'
const migrationPath = resolve(
  serverRoot,
  `prisma/migrations/${migrationDirectory}/migration.sql`,
)

const NUMBERING_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000126', 'numbering-rules:read'],
  ['00000000-0000-4000-8000-000000000127', 'numbering-rules:create'],
  ['00000000-0000-4000-8000-000000000128', 'numbering-rules:update'],
  ['00000000-0000-4000-8000-000000000129', 'numbering-rules:publish'],
  ['00000000-0000-4000-8000-000000000130', 'numbering-rules:enable'],
  ['00000000-0000-4000-8000-000000000131', 'numbering-rules:disable'],
  [
    '00000000-0000-4000-8000-000000000132',
    'numbering-rules:read-issuances',
  ],
] as const

const NUMBERING_AUDIT_EVENT_TYPES = [
  'NUMBERING_RULE_CREATED',
  'NUMBERING_RULE_UPDATED',
  'NUMBERING_RULE_VERSION_PUBLISHED',
  'NUMBERING_RULE_ENABLED',
  'NUMBERING_RULE_DISABLED',
] as const

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractModel(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma model ${modelName}`)
  }

  return match[1]
}

function extractEnumValues(schema: string, enumName: string): string[] {
  const match = schema.match(
    new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\n\\}`),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma enum ${enumName}`)
  }

  return match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Z][A-Z0-9_]*$/u.test(line))
}

describe('numbering management database schema', () => {
  it('defines the six confirmed enums and five relational Prisma models', () => {
    const schema = readSchema()

    for (const enumName of [
      'NumberingRuleStatus',
      'NumberingRuleVersionStatus',
      'NumberingSegmentType',
      'NumberingResetPolicy',
      'NumberingDateFormat',
      'NumberingRandomMode',
    ]) {
      expect(schema).toContain(`enum ${enumName} {`)
    }

    expect(extractEnumValues(schema, 'NumberingRuleStatus')).toEqual([
      'DRAFT',
      'ENABLED',
      'DISABLED',
    ])
    expect(extractEnumValues(schema, 'NumberingRuleVersionStatus')).toEqual([
      'DRAFT',
      'ACTIVE',
      'RETIRED',
    ])
    expect(extractEnumValues(schema, 'NumberingSegmentType')).toEqual([
      'FIXED',
      'DATE',
      'SEPARATOR',
      'SEQUENCE',
      'RANDOM',
    ])
    expect(extractEnumValues(schema, 'NumberingResetPolicy')).toEqual([
      'NEVER',
      'YEARLY',
      'MONTHLY',
      'DAILY',
    ])
    expect(extractEnumValues(schema, 'NumberingDateFormat')).toEqual([
      'YYYY',
      'YY',
      'MM',
      'DD',
      'YYYYMM',
      'YYYYMMDD',
      'YYMMDD',
    ])
    expect(extractEnumValues(schema, 'NumberingRandomMode')).toEqual([
      'LETTERS_THEN_DIGITS',
      'SHUFFLED',
    ])

    for (const modelName of [
      'NumberingRule',
      'NumberingRuleVersion',
      'NumberingRuleSegment',
      'NumberingPeriodState',
      'NumberingIssuance',
    ]) {
      expect(schema).toContain(`model ${modelName} {`)
    }

    const rule = extractModel(schema, 'NumberingRule')
    const version = extractModel(schema, 'NumberingRuleVersion')
    const segment = extractModel(schema, 'NumberingRuleSegment')
    const periodState = extractModel(schema, 'NumberingPeriodState')
    const issuance = extractModel(schema, 'NumberingIssuance')

    expect(rule).toContain('@unique(map: "numbering_rules_rule_code_key")')
    expect(rule).toContain('@map("rule_code") @db.VarChar(64)')
    expect(rule).toContain(
      '@@index([status, updatedAt(sort: Desc), id(sort: Desc)], map: "numbering_rules_status_updated_at_id_idx")',
    )

    expect(version).toContain(
      '@@unique([ruleId, revision], map: "numbering_rule_versions_rule_id_revision_key")',
    )
    expect(version).toContain(
      '@@unique([id, ruleId], map: "numbering_rule_versions_id_rule_id_key")',
    )
    expect(version).toContain(
      '@relation(fields: [ruleId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
    )

    expect(segment).toContain('@map("sequence_start_value") @db.BigInt')
    expect(segment).toContain('@map("sequence_step") @db.BigInt')
    expect(segment).toContain(
      '@@unique([versionId, position], map: "numbering_rule_segments_version_id_position_key")',
    )

    expect(periodState).toContain('@map("next_sequence_value") @db.BigInt')
    expect(periodState).toContain('@default(0) @map("used_count") @db.BigInt')
    expect(periodState).toContain(
      '@@unique([ruleId, periodKey], map: "numbering_period_states_rule_id_period_key_key")',
    )

    expect(issuance).toContain('@map("idempotency_key_hash") @db.ByteA')
    expect(issuance).toContain('@map("request_fingerprint_hash") @db.ByteA')
    expect(issuance).toContain(
      '@@unique([ruleId, generatedNumber], map: "numbering_issuances_rule_id_generated_number_key")',
    )
    expect(issuance).toContain(
      '@@unique([consumerCode, idempotencyKeyHash], map: "numbering_issuances_consumer_code_idempotency_key_hash_key")',
    )
    expect(issuance).toContain(
      '@@index([ruleId, generatedNumber(ops: raw("varchar_pattern_ops"))], map: "numbering_issuances_rule_id_generated_number_prefix_idx")',
    )
    expect(issuance).not.toMatch(
      /generatedNumber\s+String\s+@unique|@@unique\(\[generatedNumber\]/u,
    )
  })

  it('creates every confirmed named constraint, composite FK and partial unique index', () => {
    const migration = readMigration()

    for (const constraintName of [
      'numbering_rules_rule_code_format_check',
      'numbering_rules_name_nonblank_check',
      'numbering_rules_description_nonblank_check',
      'numbering_rules_version_positive_check',
      'numbering_rule_versions_revision_positive_check',
      'numbering_rule_versions_timezone_check',
      'numbering_rule_versions_config_fingerprint_check',
      'numbering_rule_versions_published_at_shape_check',
      'numbering_rule_segments_position_range_check',
      'numbering_rule_segments_shape_check',
      'numbering_rule_segments_fixed_value_format_check',
      'numbering_rule_segments_separator_value_check',
      'numbering_rule_segments_sequence_range_check',
      'numbering_rule_segments_random_length_check',
      'numbering_period_states_period_key_format_check',
      'numbering_period_states_used_count_nonnegative_check',
      'numbering_period_states_next_sequence_nonnegative_check',
      'numbering_issuances_generated_number_format_check',
      'numbering_issuances_consumer_code_format_check',
      'numbering_issuances_sequence_value_nonnegative_check',
      'numbering_issuances_idempotency_key_hash_32_bytes_check',
      'numbering_issuances_request_fingerprint_hash_32_bytes_check',
      'numbering_rule_versions_rule_id_fkey',
      'numbering_rule_segments_version_id_fkey',
      'numbering_period_states_rule_id_fkey',
      'numbering_issuances_rule_id_fkey',
      'numbering_issuances_rule_version_id_rule_id_fkey',
      'numbering_issuances_rule_id_period_key_fkey',
    ]) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }

    for (const indexName of [
      'numbering_rules_rule_code_key',
      'numbering_rule_versions_rule_id_revision_key',
      'numbering_rule_versions_id_rule_id_key',
      'numbering_rule_versions_one_active_key',
      'numbering_rule_versions_one_draft_key',
      'numbering_rule_segments_version_id_position_key',
      'numbering_rule_segments_one_sequence_key',
      'numbering_rule_segments_one_random_key',
      'numbering_period_states_rule_id_period_key_key',
      'numbering_issuances_rule_id_generated_number_key',
      'numbering_issuances_consumer_code_idempotency_key_hash_key',
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE UNIQUE INDEX "${indexName}"`, 'u'),
      )
    }

    for (const indexName of [
      'numbering_rule_versions_one_active_key',
      'numbering_rule_versions_one_draft_key',
      'numbering_rule_segments_one_sequence_key',
      'numbering_rule_segments_one_random_key',
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE UNIQUE INDEX "${indexName}"[\\s\\S]*?WHERE`, 'u'),
      )
    }

    for (const foreignKeyName of [
      'numbering_rule_versions_rule_id_fkey',
      'numbering_rule_segments_version_id_fkey',
      'numbering_period_states_rule_id_fkey',
      'numbering_issuances_rule_id_fkey',
      'numbering_issuances_rule_version_id_rule_id_fkey',
      'numbering_issuances_rule_id_period_key_fkey',
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `CONSTRAINT "${foreignKeyName}"[^;]*ON DELETE RESTRICT ON UPDATE RESTRICT;`,
          'u',
        ),
      )
    }

    expect(migration).toMatch(
      /CONSTRAINT "numbering_issuances_rule_version_id_rule_id_fkey"[\s\S]*?FOREIGN KEY \("rule_version_id", "rule_id"\)[\s\S]*?REFERENCES "numbering_rule_versions" \("id", "rule_id"\)[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "numbering_issuances_rule_id_period_key_fkey"[\s\S]*?FOREIGN KEY \("rule_id", "period_key"\)[\s\S]*?REFERENCES "numbering_period_states" \("rule_id", "period_key"\)[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
  })

  it('creates immutable identity, legal-version and permanent-ledger triggers', () => {
    const migration = readMigration()

    for (const functionName of [
      'enforce_numbering_rule_invariants',
      'enforce_numbering_rule_version_invariants',
      'enforce_numbering_rule_segment_parent_draft',
      'enforce_numbering_issuance_immutability',
    ]) {
      expect(migration).toContain(`CREATE FUNCTION "${functionName}"()`)
    }

    for (const constraintName of [
      'numbering_rules_identity_immutable_check',
      'numbering_rules_delete_check',
      'numbering_rule_versions_identity_immutable_check',
      'numbering_rule_versions_config_immutable_check',
      'numbering_rule_versions_status_transition_check',
      'numbering_rule_versions_delete_check',
      'numbering_rule_segments_parent_draft_check',
      'numbering_issuances_immutable_check',
    ]) {
      expect(migration).toContain(`CONSTRAINT = '${constraintName}'`)
    }

    expect(migration).toMatch(
      /FROM "numbering_rule_versions"[\s\S]*?FOR SHARE/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "numbering_issuances_immutability_trigger"[\s\S]*?BEFORE UPDATE OR DELETE/u,
    )
  })

  it('adds the confirmed descending and prefix-query indexes without global output uniqueness', () => {
    const migration = readMigration()

    for (const indexName of [
      'numbering_rules_status_updated_at_id_idx',
      'numbering_rule_versions_rule_id_revision_id_idx',
      'numbering_issuances_rule_id_period_key_issued_at_id_idx',
      'numbering_issuances_rule_id_issued_at_id_idx',
      'numbering_issuances_rule_id_consumer_code_issued_at_id_idx',
      'numbering_issuances_rule_id_generated_number_prefix_idx',
    ]) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }

    expect(migration).toMatch(
      /"numbering_issuances_rule_id_generated_number_prefix_idx"[\s\S]*?"generated_number" varchar_pattern_ops/u,
    )
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*\("generated_number"\)/u,
    )
    expect(
      migration.match(/CHECK \("generated_number" ~/gu),
    ).toHaveLength(1)
  })

  it('adds seven assignable permissions, system-admin grants and five audit events atomically', () => {
    const schema = readSchema()
    const migration = readMigration()

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)

    for (const eventType of NUMBERING_AUDIT_EVENT_TYPES) {
      expect(schema).toContain(`  ${eventType}`)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }

    for (const [id, code] of NUMBERING_PERMISSION_SEEDS) {
      expect(migration).toMatch(
        new RegExp(`'${id}',\\s*'${code}'[\\s\\S]*?false`, 'u'),
      )
      expect(MANAGEMENT_PERMISSION_CODES).toContain(code)
    }

    expect(migration).toMatch(
      /'00000000-0000-4000-8000-000000000130',\s*'numbering-rules:enable',\s*'启用编号规则',\s*'启用已有活动版本的编号规则',\s*false/u,
    )

    expect(migration).toMatch(
      /INSERT INTO "role_permissions"[\s\S]*?'00000000-0000-4000-8000-000000000001'[\s\S]*?WHERE "code" IN \([\s\S]*?'numbering-rules:read'[\s\S]*?'numbering-rules:read-issuances'[\s\S]*?\);/u,
    )
  })

  it('keeps one strict forward migration with no default rule seed or drift masking', () => {
    const numberingMigrations = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('numbering_'))
      .map(entry => entry.name)
      .sort()
    const migration = readMigration()

    expect(numberingMigrations).toEqual([migrationDirectory])
    expect(migration).not.toContain('INSERT INTO "numbering_rules"')
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')
    expect(migration).not.toMatch(/\bIF NOT EXISTS\b/iu)
    expect(migration).not.toMatch(/\b(?:curl|fetch|https?):/iu)
    expect(migration).toContain('numbering migration invariant mismatch')
  })
})
