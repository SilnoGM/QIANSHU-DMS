import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106120000_machine_viewing_appointments/migration.sql'),
  'utf8',
)
const numberMigration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106130000_machine_viewing_appointment_number/migration.sql'),
  'utf8',
)
const legacySortMigration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106140000_machine_viewing_legacy_number_sort/migration.sql'),
  'utf8',
)
const statusMigration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106150000_machine_viewing_status_and_feedback/migration.sql'),
  'utf8',
)
const permissionConstants = readFileSync(
  resolve(serverRoot, 'src/modules/access-control/permission.constants.ts'),
  'utf8',
)

const PERMISSION_CODES = ['machine-viewings:read', 'machine-viewings:create'] as const

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

describe('machine viewing appointment database contract', () => {
  it('declares the three fixed enums with snake_case storage names', () => {
    const site = enumBlock('MachineViewingSite')
    expect(site).toContain('NEW_TAIPEI_LINKOU')
    expect(site).toContain('TAICHUNG_LONGJING')
    expect(site).toContain('@@map("machine_viewing_site")')

    const machineType = enumBlock('MachineViewingMachineType')
    for (const value of ['MINI_TILLER', 'SHREDDER', 'INCINERATOR']) {
      expect(machineType).toContain(value)
    }
    expect(machineType).toContain('@@map("machine_viewing_machine_type")')

    const period = enumBlock('MachineViewingPeriod')
    expect(period).toContain('AM')
    expect(period).toContain('PM')
    expect(period).toContain('@@map("machine_viewing_period")')
  })

  it('keeps the inferred year, optional hour and submitter on the model', () => {
    const model = modelBlock('MachineViewingAppointment')
    for (const field of [
      'site',
      'machineType',
      'appointmentDate',
      'period',
      'hour',
      'customerName',
      'customerPhone',
      'contactPerson',
      'createdByUserId',
      'requestKeyHash',
    ]) {
      expect(model).toMatch(new RegExp(`^\\s*${field}\\s`, 'mu'))
    }
    for (const column of [
      '@map("appointment_date") @db.Date',
      '@map("created_by_user_id") @db.Uuid',
      '@map("request_key_hash") @db.ByteA',
    ]) {
      expect(model).toContain(column)
    }
    expect(model).toContain('@@unique([createdByUserId, requestKeyHash]')
    expect(model).toContain('"machine_viewing_appointments_creator_request_key"')
    expect(model).toContain('"machine_viewing_appointments_time_idx"')
    expect(model).toContain('@@map("machine_viewing_appointments")')
  })

  it('creates the table, constraints and indexes in one migration', () => {
    for (const type of ['machine_viewing_site', 'machine_viewing_machine_type', 'machine_viewing_period']) {
      expect(migration).toContain(`CREATE TYPE "${type}" AS ENUM`)
    }
    expect(migration).toContain('CREATE TABLE "machine_viewing_appointments"')
    expect(migration).toContain('CONSTRAINT "machine_viewing_appointments_hour_range_check"')
    expect(migration).toContain('CHECK ("hour" IS NULL OR ("hour" BETWEEN 1 AND 12))')
    expect(migration).toContain('CONSTRAINT "machine_viewing_appointments_customer_name_shape_check"')
    expect(migration).toContain('CONSTRAINT "machine_viewing_appointments_contact_person_shape_check"')
    expect(migration).toContain('CONSTRAINT "machine_viewing_appointments_request_key_check"')
    expect(migration).toContain('CHECK (octet_length("request_key_hash") = 32)')
    expect(migration).toContain('"machine_viewing_appointments_created_by_user_id_fkey"')
    expect(migration).toContain('CREATE INDEX "machine_viewing_appointments_time_idx"')
    expect(migration).toContain('CREATE INDEX "machine_viewing_appointments_creator_created_idx"')
  })

  it('registers both delegable permissions and grants the built-in roles', () => {
    for (const code of PERMISSION_CODES) {
      expect(migration).toContain(`'${code}'`)
      expect(permissionConstants).toContain(`'${code}'`)
    }
    expect(migration).toContain('"system_only"')
    expect(migration).toMatch(/ON CONFLICT \("code"\) DO NOTHING/u)

    expect(migration).toMatch(
      /WHERE role\."code" = 'system_admin'[\s\S]*?ON CONFLICT DO NOTHING;/u,
    )
    expect(migration).toMatch(
      /role\."code" = 'operations_staff'[\s\S]*?'machine-viewings:read', 'machine-viewings:create'/u,
    )
    // 采运只读：列表可见即可，不能拿到 create 权限。
    expect(migration).toMatch(
      /role\."code" = 'purchasing_staff'[\s\S]*?ON CONFLICT DO NOTHING;/u,
    )
    const purchasingStart = migration.lastIndexOf(`role."code" = 'purchasing_staff'`)
    const purchasingGrant = migration.slice(purchasingStart, migration.indexOf('DO $$', purchasingStart))
    expect(purchasingGrant).toContain(`'machine-viewings:read'`)
    expect(purchasingGrant).not.toContain(`'machine-viewings:create'`)
  })

  it('appends the audit event type in both schema and migration', () => {
    expect(enumBlock('AuditEventType')).toContain('MACHINE_VIEWING_APPOINTMENT_CREATED')
    expect(migration).toContain(
      `ALTER TYPE "audit_event_type" ADD VALUE IF NOT EXISTS 'MACHINE_VIEWING_APPOINTMENT_CREATED'`,
    )
  })

  it('binds every appointment to a number issued by MACHINE_VIEWING_NO', () => {
    const model = modelBlock('MachineViewingAppointment')
    expect(model).toContain('appointmentNo')
    expect(model).toContain('@map("appointment_no") @db.VarChar(64)')
    expect(model).toContain('numberingIssuanceId')
    expect(model).toContain('@map("numbering_issuance_id") @db.Uuid')
    expect(modelBlock('NumberingIssuance')).toContain('machineViewingAppointment MachineViewingAppointment?')

    expect(numberMigration).toContain('ADD COLUMN "appointment_no" VARCHAR(64)')
    expect(numberMigration).toContain('ADD COLUMN "numbering_issuance_id" UUID')
    expect(numberMigration).toContain(`'MV/LEGACY-'`)
    expect(numberMigration).toContain('"machine_viewing_appointments_number_key" UNIQUE ("appointment_no")')
    expect(numberMigration).toContain('"machine_viewing_appointments_numbering_issuance_id_fkey"')
    expect(numberMigration).toContain(`CHECK ("appointment_no" ~ '^MV/[A-Z0-9]+-[0-9]{4,}$')`)
    expect(numberMigration).toContain(`'MACHINE_VIEWING_NO'`)
    expect(numberMigration).toContain(`'MV'`)
    expect(numberMigration).toContain(`'YYYYMMDD'`)
    expect(numberMigration).toContain(
      'd145ae12d9e093a305346e711c38d7a0ba552ab34dcb73b03857f6782d2850fd',
    )
    expect(numberMigration).toContain(`"status" = 'ENABLED'`)
    expect(numberMigration).toContain(`version."status" = 'ACTIVE'`)

    // 历史测试行必须改成排序最低的哨兵编号，否则会压住所有真实编号。
    expect(legacySortMigration).toContain(`WHERE "appointment_no" LIKE 'MV/LEGACY-%'`)
    expect(legacySortMigration).toContain(`'MV/00000000-' || lpad(`)
  })

  it('adds the read-only status and feedback fields with a safe default', () => {
    const status = enumBlock('MachineViewingStatus')
    for (const value of ['PENDING_APPOINTMENT', 'APPOINTED', 'FEEDBACK_GIVEN', 'CANCELLED']) {
      expect(status).toContain(value)
    }
    expect(status).toContain('@@map("machine_viewing_status")')

    const model = modelBlock('MachineViewingAppointment')
    expect(model).toContain('status              MachineViewingStatus     @default(PENDING_APPOINTMENT)')
    expect(model).toContain('feedback            String?                  @db.VarChar(500)')

    expect(statusMigration).toContain(`CREATE TYPE "machine_viewing_status" AS ENUM`)
    expect(statusMigration).toContain(
      `ADD COLUMN "status" "machine_viewing_status" NOT NULL DEFAULT 'PENDING_APPOINTMENT'`,
    )
    expect(statusMigration).toContain(`ADD COLUMN "feedback" VARCHAR(500)`)
    expect(statusMigration).toContain('"machine_viewing_appointments_feedback_shape_check"')
    expect(statusMigration).toContain(`CHECK ("feedback" IS NULL OR ("feedback" = btrim("feedback") AND length("feedback") > 0))`)
    // 本期不开放状态流转，迁移里不应出现任何权限或审计枚举变更。
    expect(statusMigration).not.toContain('INSERT INTO "permissions"')
    expect(statusMigration).not.toContain('audit_event_type')
  })

  it('keeps the permission catalog and seed roles in sync', () => {
    const seed = readFileSync(resolve(serverRoot, 'src/cli/seed/seed.dataset.ts'), 'utf8')
    expect(seed).toContain(`'machine-viewings:read'`)
    expect(seed).toContain(`'machine-viewings:create'`)
    const operationsSeed = seed.slice(
      seed.indexOf(`code: 'operations_staff'`),
      seed.indexOf(`code: 'finance_staff'`),
    )
    expect(operationsSeed).toContain(`'machine-viewings:read'`)
    expect(operationsSeed).toContain(`'machine-viewings:create'`)
    // 采运只读：列表可见即可，不能拿到 create 权限。
    const purchasingSeed = seed.slice(seed.indexOf(`code: 'purchasing_staff'`))
    expect(purchasingSeed).toContain(`'machine-viewings:read'`)
    expect(purchasingSeed).not.toContain(`'machine-viewings:create'`)
  })
})
