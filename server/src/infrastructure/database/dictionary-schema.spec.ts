import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MANAGEMENT_PERMISSION_CODES } from '../../modules/access-control/permission.constants'

const serverRoot = resolve(__dirname, '../../..')
const schemaPath = resolve(serverRoot, 'prisma/schema.prisma')
const migrationDirectory =
  '20260803090000_dictionary_management_schema_and_permissions'
const migrationPath = resolve(
  serverRoot,
  `prisma/migrations/${migrationDirectory}/migration.sql`,
)

const DICTIONARY_PERMISSION_SEEDS = [
  ['00000000-0000-4000-8000-000000000133', 'dictionaries:read', '查询系统字典'],
  ['00000000-0000-4000-8000-000000000134', 'dictionaries:create', '创建系统字典'],
  ['00000000-0000-4000-8000-000000000135', 'dictionaries:update', '编辑系统字典'],
  ['00000000-0000-4000-8000-000000000136', 'dictionaries:enable', '启用系统字典'],
  ['00000000-0000-4000-8000-000000000137', 'dictionaries:disable', '停用系统字典'],
] as const

const DICTIONARY_AUDIT_EVENT_TYPES = [
  'DICTIONARY_TYPE_CREATED',
  'DICTIONARY_TYPE_UPDATED',
  'DICTIONARY_TYPE_ENABLED',
  'DICTIONARY_TYPE_DISABLED',
  'DICTIONARY_ITEM_CREATED',
  'DICTIONARY_ITEM_UPDATED',
  'DICTIONARY_ITEM_ENABLED',
  'DICTIONARY_ITEM_DISABLED',
] as const

const SALES_ORDER_AUDIT_EVENT_TYPES = [
  'SALES_ORDER_CREATED',
  'SALES_ORDER_ORDER_STATUS_CHANGED',
  'SALES_ORDER_FULFILLMENT_STATUS_CHANGED',
  'SALES_ORDER_PAYMENT_TERMS_UPDATED',
  'SALES_ORDER_PAYMENT_RECORDED',
  'SALES_ORDER_PAYMENT_VOIDED',
  'SALES_ORDER_DOCUMENT_ATTACHED',
  'SALES_ORDER_DOCUMENT_DETACHED',
  'SALES_ORDER_PRODUCT_APPENDED',
] as const

const DICTIONARY_CONSTRAINTS = [
  'dictionary_types_pkey',
  'dictionary_types_code_format_check',
  'dictionary_types_name_nonblank_check',
  'dictionary_types_description_nonblank_check',
  'dictionary_types_sort_order_nonnegative_check',
  'dictionary_types_version_positive_check',
  'dictionary_items_pkey',
  'dictionary_items_value_format_check',
  'dictionary_items_label_nonblank_check',
  'dictionary_items_description_nonblank_check',
  'dictionary_items_sort_order_nonnegative_check',
  'dictionary_items_version_positive_check',
  'dictionary_items_dictionary_type_id_fkey',
] as const

const DICTIONARY_INDEXES = [
  'dictionary_types_code_key',
  'dictionary_types_sort_order_code_id_idx',
  'dictionary_types_enabled_sort_order_code_id_idx',
  'dictionary_items_dictionary_type_id_value_key',
  'dictionary_items_type_id_sort_order_value_id_idx',
  'dictionary_items_type_id_enabled_sort_order_value_id_idx',
] as const

function readSchema(): string {
  return readFileSync(schemaPath, 'utf8')
}

function readMigration(): string {
  return readFileSync(migrationPath, 'utf8')
}

function extractBlock(
  source: string,
  keyword: 'enum' | 'model',
  name: string,
): string {
  const match = source.match(
    new RegExp(`${keyword} ${name} \\{([\\s\\S]*?)\\n\\}`, 'u'),
  )

  if (!match?.[1]) {
    throw new Error(`Missing Prisma ${keyword} ${name}`)
  }

  return match[1]
}

function extractEnumValues(schema: string, enumName: string): string[] {
  return extractBlock(schema, 'enum', enumName)
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^[A-Z][A-Z0-9_]*$/u.test(line))
}

describe('dictionary management database schema', () => {
  it('defines the confirmed tone and two flat Prisma models', () => {
    const schema = readSchema()
    const dictionaryType = extractBlock(schema, 'model', 'DictionaryType')
    const dictionaryItem = extractBlock(schema, 'model', 'DictionaryItem')

    expect(extractEnumValues(schema, 'DictionaryTone')).toEqual([
      'DEFAULT',
      'PRIMARY',
      'SUCCESS',
      'WARNING',
      'DANGER',
      'INFO',
    ])

    for (const field of [
      'id',
      'code',
      'name',
      'description',
      'enabled',
      'sortOrder',
      'version',
      'createdAt',
      'updatedAt',
      'items',
    ]) {
      expect(dictionaryType).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(dictionaryType).toContain(
      '@unique(map: "dictionary_types_code_key")',
    )
    expect(dictionaryType).toContain(
      '@@index([sortOrder, code, id], map: "dictionary_types_sort_order_code_id_idx")',
    )
    expect(dictionaryType).toContain(
      '@@index([enabled, sortOrder, code, id], map: "dictionary_types_enabled_sort_order_code_id_idx")',
    )
    expect(dictionaryType).toContain('@@map("dictionary_types")')

    for (const field of [
      'id',
      'dictionaryTypeId',
      'value',
      'label',
      'description',
      'tone',
      'enabled',
      'sortOrder',
      'version',
      'createdAt',
      'updatedAt',
      'dictionaryType',
    ]) {
      expect(dictionaryItem).toMatch(new RegExp(`\\n\\s*${field}\\s`, 'u'))
    }
    expect(dictionaryItem).toContain(
      '@@unique([dictionaryTypeId, value], map: "dictionary_items_dictionary_type_id_value_key")',
    )
    expect(dictionaryItem).toContain(
      '@relation(fields: [dictionaryTypeId], references: [id], onDelete: Restrict, onUpdate: Restrict)',
    )
    expect(dictionaryItem).toContain(
      '@@index([dictionaryTypeId, sortOrder, value, id], map: "dictionary_items_type_id_sort_order_value_id_idx")',
    )
    expect(dictionaryItem).toContain(
      '@@index([dictionaryTypeId, enabled, sortOrder, value, id], map: "dictionary_items_type_id_enabled_sort_order_value_id_idx")',
    )
    expect(dictionaryItem).toContain('@@map("dictionary_items")')

    for (const rejectedField of [
      'tenantId',
      'parentId',
      'deletedAt',
      'isSystem',
      'isDefault',
      'effectiveEnabled',
      'revision',
    ]) {
      expect(dictionaryType).not.toContain(rejectedField)
      expect(dictionaryItem).not.toContain(rejectedField)
    }
  })

  it('creates exactly the confirmed constraints and business indexes', () => {
    const migration = readMigration()

    for (const constraintName of DICTIONARY_CONSTRAINTS) {
      expect(migration).toContain(`CONSTRAINT "${constraintName}"`)
    }
    for (const indexName of DICTIONARY_INDEXES) {
      expect(migration).toContain(`INDEX "${indexName}"`)
    }

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "dictionary_types_code_key"/u,
    )
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "dictionary_items_dictionary_type_id_value_key"/u,
    )
    expect(migration).toMatch(
      /CONSTRAINT "dictionary_items_dictionary_type_id_fkey"[\s\S]*?ON DELETE RESTRICT ON UPDATE RESTRICT;/u,
    )
    expect(migration).toContain(
      `CHECK ("code" ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$')`,
    )
    expect(migration).toContain(
      `CHECK ("value" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$')`,
    )
  })

  it('uses stable triggers for immutable identity and enabled-item invariants', () => {
    const migration = readMigration()

    for (const functionName of [
      'enforce_dictionary_type_invariants',
      'enforce_dictionary_item_invariants',
    ]) {
      expect(migration).toContain(`CREATE FUNCTION "${functionName}"()`)
    }
    for (const constraintName of [
      'dictionary_types_delete_check',
      'dictionary_types_identity_immutable_check',
      'dictionary_types_enabled_item_required_check',
      'dictionary_items_delete_check',
      'dictionary_items_identity_immutable_check',
      'dictionary_items_last_enabled_check',
    ]) {
      expect(migration).toContain(`CONSTRAINT = '${constraintName}'`)
    }

    expect(migration).toMatch(
      /FROM "dictionary_items"[\s\S]*?"dictionary_type_id" = NEW\."id"[\s\S]*?"enabled" = true/u,
    )
    expect(migration).toMatch(
      /FROM "dictionary_types"[\s\S]*?"id" = NEW\."dictionary_type_id"[\s\S]*?FOR UPDATE/u,
    )
    expect(migration).toMatch(
      /FROM "dictionary_items"[\s\S]*?"id" <> OLD\."id"[\s\S]*?"enabled" = true/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "dictionary_types_invariants_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OF "id", "code", "enabled" OR DELETE[\s\S]*?EXECUTE FUNCTION "enforce_dictionary_type_invariants"\(\);/u,
    )
    expect(migration).toMatch(
      /CREATE TRIGGER "dictionary_items_invariants_trigger"[\s\S]*?BEFORE INSERT OR UPDATE OF "id", "dictionary_type_id", "value", "enabled" OR DELETE[\s\S]*?EXECUTE FUNCTION "enforce_dictionary_item_invariants"\(\);/u,
    )
  })

  it('adds exact permissions, administrator grants and audit events atomically', () => {
    const migration = readMigration()
    const schema = readSchema()
    const auditEventTypes = extractEnumValues(schema, 'AuditEventType')

    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).not.toContain('IF NOT EXISTS')
    expect(migration).not.toContain('ADD VALUE IF NOT EXISTS')
    expect(migration).not.toContain('ON CONFLICT DO NOTHING')

    for (const eventType of DICTIONARY_AUDIT_EVENT_TYPES) {
      expect(schema).toContain(`  ${eventType}`)
      expect(migration).toContain(
        `ALTER TYPE "audit_event_type" ADD VALUE '${eventType}'`,
      )
    }
    // 产品、资金、销售订单、销售加购与采购订单领域会在后续 append-only migration 扩展审计类型；
    // 字典测试锁定当前全量基线，同时只要求字典 migration 对自身八个类型负责。
    expect(auditEventTypes).toHaveLength(72)
    expect(auditEventTypes).toContain('PRODUCT_CREATED')
    expect(auditEventTypes).toContain('PRODUCT_UPDATED')
    expect(auditEventTypes).toContain('SALES_ORDER_PRODUCT_APPENDED')
    expect(
      auditEventTypes.filter(eventType => eventType.startsWith('DICTIONARY_')),
    ).toEqual(DICTIONARY_AUDIT_EVENT_TYPES)
    expect(
      auditEventTypes.filter(eventType => eventType.startsWith('SALES_ORDER_')),
    ).toEqual(SALES_ORDER_AUDIT_EVENT_TYPES)
    for (const [id, code, name] of DICTIONARY_PERMISSION_SEEDS) {
      expect(migration).toMatch(
        new RegExp(
          `'${id}',\\s*'${code}',\\s*'${name}'[\\s\\S]*?false`,
          'u',
        ),
      )
    }
    const dictionaryPermissionStart = MANAGEMENT_PERMISSION_CODES.indexOf(
      'dictionaries:read',
    )
    expect(
      MANAGEMENT_PERMISSION_CODES.slice(
        dictionaryPermissionStart,
        dictionaryPermissionStart + DICTIONARY_PERMISSION_SEEDS.length,
      ),
    ).toEqual(
      DICTIONARY_PERMISSION_SEEDS.map(([, code]) => code),
    )
    expect(migration).toMatch(
      /FROM "roles" AS role[\s\S]*?CROSS JOIN "permissions" AS permission[\s\S]*?role\."id" = '00000000-0000-4000-8000-000000000001'[\s\S]*?role\."code" = 'system_admin'[\s\S]*?'dictionaries:read'[\s\S]*?'dictionaries:disable'/u,
    )
  })

  it('self-checks every physical boundary and keeps the catalog empty', () => {
    const migration = readMigration()

    expect(migration).toContain('FROM pg_enum AS enum_entry')
    expect(migration).toContain('enum_entry.enumlabel')
    expect(migration).not.toContain('::"audit_event_type"')
    for (const assertion of [
      'dictionary migration invariant mismatch: table count',
      'dictionary migration invariant mismatch: constraint count',
      'dictionary migration invariant mismatch: index count',
      'dictionary migration invariant mismatch: function count',
      'dictionary migration invariant mismatch: trigger count',
      'dictionary migration invariant mismatch: tone enum count',
      'dictionary migration invariant mismatch: permission catalog',
      'dictionary migration invariant mismatch: system admin grants',
      'dictionary migration invariant mismatch: audit event count',
      'dictionary migration invariant mismatch: default type seed',
      'dictionary migration invariant mismatch: default item seed',
    ]) {
      expect(migration).toContain(assertion)
    }
    expect(migration).not.toContain('INSERT INTO "dictionary_types"')
    expect(migration).not.toContain('INSERT INTO "dictionary_items"')
  })

  it('keeps one append-only dictionary migration with no business seed', () => {
    const migrationDirectories = readdirSync(
      resolve(serverRoot, 'prisma/migrations'),
      { withFileTypes: true },
    )
      .filter(entry => entry.isDirectory() && entry.name.includes('dictionary_'))
      .map(entry => entry.name)
      .sort()

    expect(migrationDirectories).toEqual([migrationDirectory])
  })
})
