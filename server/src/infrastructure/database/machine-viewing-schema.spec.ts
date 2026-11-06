import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serverRoot = resolve(__dirname, '../../..')
const schema = readFileSync(resolve(serverRoot, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  resolve(serverRoot, 'prisma/migrations/20261106120000_machine_viewing_appointments/migration.sql'),
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
      'site            MachineViewingSite',
      'machineType     MachineViewingMachineType',
      'appointmentDate DateTime',
      'period          MachineViewingPeriod',
      'hour            Int?',
      'customerName    String',
      'customerPhone   String?',
      'contactPerson   String',
      'createdByUserId String',
      'requestKeyHash  Bytes',
      '@map("appointment_date") @db.Date',
      '@map("created_by_user_id") @db.Uuid',
      '@map("request_key_hash") @db.ByteA',
    ]) {
      expect(model).toContain(field)
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
