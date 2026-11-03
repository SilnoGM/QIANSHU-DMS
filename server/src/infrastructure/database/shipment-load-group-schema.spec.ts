import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..', '..')

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261102150000_shipment_load_groups/migration.sql')

describe('shipment load group schema', () => {
  it('declares the group and member models with the expected lifecycle fields', () => {
    expect(schema).toContain('model ShipmentLoadGroup {')
    expect(schema).toContain('model ShipmentLoadGroupMember {')
    expect(schema).toContain('enum ShipmentLoadGroupStatus {')
    for (const value of ['ACTIVE', 'RELEASED', 'ARCHIVED']) {
      expect(schema).toContain(`  ${value}`)
    }
    expect(schema).toMatch(/sealed\s+Boolean\s+@default\(false\)/u)
    expect(schema).toContain('@@unique([createdById, requestKey], map: "shipment_load_groups_actor_request_key")')
    expect(schema).toContain('@@id([groupId, shipmentId])')
  })

  it('keeps one active membership per shipment and one primary member per group', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "shipment_load_group_members_active_shipment_key"')
    expect(migration).toContain('ON "shipment_load_group_members"("shipment_id") WHERE "active"')
    expect(migration).toContain('CREATE UNIQUE INDEX "shipment_load_group_members_primary_group_key"')
    expect(migration).toContain('ON "shipment_load_group_members"("group_id") WHERE "is_primary"')
  })

  it('guards the same purchase order, sales order, warehouse, mark and eligibility', () => {
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_members_order_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_members_owner_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_members_eligible_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_members_facts_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_members_count_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_seal_check\'')
    expect(migration).toContain('CONSTRAINT = \'shipment_load_group_release_check\'')
  })

  it('appends the two audit events and keeps the migration transactional', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u)
    expect(migration).toContain('ALTER TYPE "audit_event_type" ADD VALUE \'PURCHASE_SHIPMENT_LOAD_GROUP_CREATED\'')
    expect(migration).toContain('ALTER TYPE "audit_event_type" ADD VALUE \'PURCHASE_SHIPMENT_LOAD_GROUP_RELEASED\'')
  })
})
