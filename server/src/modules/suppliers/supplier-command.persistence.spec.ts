import type { Prisma } from '../../generated/prisma/client'
import { SupplierEntityType } from '../../generated/prisma/enums'
import {
  completeSupplierCreateRequest,
  createSupplierRecord,
  lockSupplierCreateRequest,
  lockSupplierNumberingIssuance,
  readSupplierForMutation,
  readSupplierRegistrationDuplicate,
  upsertAndLockSupplierCreateRequest,
  updateSupplierRecord,
} from './supplier-command.persistence'

const REQUEST_ID = '29a605c9-04e3-4099-91eb-63fa1e8c1961'
const SUPPLIER_ID = '65297363-f67c-43f1-a800-0b1fbe15cb67'
const ISSUANCE_ID = '7cbb8ee3-e2a1-419f-a37e-fc0dcefc35e0'

interface SqlShape {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}

function sqlText(value: unknown): string {
  return (value as SqlShape).strings.join(' ')
}

function sqlValues(value: unknown): readonly unknown[] {
  return (value as SqlShape).values
}

function transactionFixture() {
  const executeRaw = jest.fn<Promise<number>, [unknown]>().mockResolvedValue(1)
  const queryRaw = jest.fn<Promise<unknown[]>, [unknown]>()
  const findFirst = jest.fn().mockResolvedValue(null)
  const create = jest.fn().mockResolvedValue({ id: SUPPLIER_ID })
  const supplierUpdateMany = jest.fn().mockResolvedValue({ count: 1 })
  const updateMany = jest.fn().mockResolvedValue({ count: 1 })
  return {
    executeRaw,
    queryRaw,
    findFirst,
    create,
    supplierUpdateMany,
    updateMany,
    transaction: {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      supplier: { findFirst, create, updateMany: supplierUpdateMany },
      supplierCreateRequest: { updateMany },
    } as unknown as Prisma.TransactionClient,
  }
}

describe('supplier create persistence', () => {
  it('inserts intent with conflict tolerance, then locks the unique scope row', async () => {
    const fixture = transactionFixture()
    const scopeHash = Buffer.alloc(32, 1)
    const fingerprintHash = Buffer.alloc(32, 2)
    fixture.queryRaw.mockResolvedValue([{
      id: REQUEST_ID,
      requestFingerprintHash: fingerprintHash,
      supplierId: null,
    }])

    await expect(upsertAndLockSupplierCreateRequest(fixture.transaction, {
      idempotencyScopeHash: scopeHash,
      requestFingerprintHash: fingerprintHash,
    })).resolves.toEqual({
      id: REQUEST_ID,
      requestFingerprintHash: fingerprintHash,
      supplierId: null,
    })

    const insertSql = fixture.executeRaw.mock.calls[0]?.[0]
    const lockSql = fixture.queryRaw.mock.calls[0]?.[0]
    expect(sqlText(insertSql)).toContain(
      'ON CONFLICT ("idempotency_scope_hash") DO NOTHING',
    )
    expect(sqlValues(insertSql)).toEqual([scopeHash, fingerprintHash])
    expect(sqlText(lockSql)).toContain('FOR UPDATE')
    expect(sqlValues(lockSql)).toEqual([scopeHash])
    expect(fixture.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.queryRaw.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('locks Tx-C intent and numbering provenance with the required lock modes', async () => {
    const fixture = transactionFixture()
    fixture.queryRaw
      .mockResolvedValueOnce([{
        id: REQUEST_ID,
        requestFingerprintHash: Buffer.alloc(32),
        supplierId: null,
      }])
      .mockResolvedValueOnce([{
        id: ISSUANCE_ID,
        generatedNumber: 'SUP-0001',
        consumerCode: 'SUPPLIER.CREATE',
        ruleCode: 'SUPPLIER',
      }])

    await lockSupplierCreateRequest(fixture.transaction, REQUEST_ID)
    await lockSupplierNumberingIssuance(fixture.transaction, ISSUANCE_ID)

    const intentSql = fixture.queryRaw.mock.calls[0]?.[0]
    const issuanceSql = fixture.queryRaw.mock.calls[1]?.[0]
    expect(sqlText(intentSql)).toContain('FOR UPDATE')
    expect(sqlValues(intentSql)).toEqual([REQUEST_ID])
    expect(sqlText(issuanceSql)).toContain(
      'INNER JOIN "numbering_rules" AS rule',
    )
    expect(sqlText(issuanceSql)).toContain('FOR KEY SHARE OF issuance')
    expect(sqlValues(issuanceSql)).toEqual([ISSUANCE_ID])
  })

  it('prechecks registration, creates exact data and completes intent once', async () => {
    const fixture = transactionFixture()
    fixture.findFirst.mockResolvedValue({ id: 'duplicate' })
    const data = {
      code: 'SUP-0001',
      numberingIssuanceId: ISSUANCE_ID,
      legalName: '示例供应商',
      normalizedLegalName: '示例供应商',
      shortName: null,
      normalizedShortName: null,
      entityType: SupplierEntityType.ORGANIZATION,
      registrationCountryRegionId: null,
      registrationNumber: null,
      normalizedRegistrationNumber: null,
      contactName: null,
      normalizedContactName: null,
      contactPhone: null,
      normalizedContactPhone: null,
      contactWechatId: null,
      normalizedContactWechatId: null,
      addressCountryRegionId: null,
      addressProvinceStateId: null,
      addressCityId: null,
      addressLine: null,
      postalCode: null,
      remark: null,
      enabled: false as const,
    }

    await expect(readSupplierRegistrationDuplicate(
      fixture.transaction,
      'country-id',
      'REG-1',
    )).resolves.toBe('duplicate')
    await expect(createSupplierRecord(fixture.transaction, data)).resolves
      .toEqual({ id: SUPPLIER_ID })
    await expect(completeSupplierCreateRequest(
      fixture.transaction,
      REQUEST_ID,
      SUPPLIER_ID,
    )).resolves.toBeUndefined()

    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        registrationCountryRegionId: 'country-id',
        normalizedRegistrationNumber: 'REG-1',
      },
      select: { id: true },
    })
    expect(fixture.create).toHaveBeenCalledWith({
      data,
      select: { id: true },
    })
    expect(fixture.updateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, supplierId: null },
      data: { supplierId: SUPPLIER_ID },
    })
  })

  it('rejects malformed intent hashes and non-single completion', async () => {
    const malformed = transactionFixture()
    malformed.queryRaw.mockResolvedValue([{
      id: REQUEST_ID,
      requestFingerprintHash: Buffer.alloc(31),
      supplierId: null,
    }])
    await expect(lockSupplierCreateRequest(
      malformed.transaction,
      REQUEST_ID,
    )).rejects.toThrow('Supplier create intent invariant violated')

    const raced = transactionFixture()
    raced.updateMany.mockResolvedValue({ count: 0 })
    await expect(completeSupplierCreateRequest(
      raced.transaction,
      REQUEST_ID,
      SUPPLIER_ID,
    )).rejects.toThrow('Supplier create intent completion invariant violated')
  })

  it('locks Supplier before mutation and increments only the expected version', async () => {
    const fixture = transactionFixture()
    fixture.queryRaw.mockResolvedValue([{
      id: SUPPLIER_ID,
      code: 'SUP-0001',
      legalName: '示例供应商',
      normalizedLegalName: '示例供应商',
      shortName: null,
      normalizedShortName: null,
      entityType: SupplierEntityType.ORGANIZATION,
      registrationCountryRegionId: null,
      registrationNumber: null,
      normalizedRegistrationNumber: null,
      contactName: null,
      normalizedContactName: null,
      contactPhone: null,
      normalizedContactPhone: null,
      contactWechatId: null,
      normalizedContactWechatId: null,
      addressCountryRegionId: null,
      addressProvinceStateId: null,
      addressCityId: null,
      addressLine: null,
      postalCode: null,
      remark: null,
      enabled: false,
      version: 3,
    }])

    await expect(readSupplierForMutation(
      fixture.transaction,
      SUPPLIER_ID,
    )).resolves.toMatchObject({ id: SUPPLIER_ID, version: 3 })
    const lockSql = fixture.queryRaw.mock.calls[0]?.[0]
    expect(sqlText(lockSql)).toContain('FROM "suppliers"')
    expect(sqlText(lockSql)).toContain('FOR UPDATE')
    expect(sqlValues(lockSql)).toEqual([SUPPLIER_ID])

    await updateSupplierRecord(
      fixture.transaction,
      SUPPLIER_ID,
      { remark: '新备注' },
      3,
    )
    expect(fixture.supplierUpdateMany).toHaveBeenLastCalledWith({
      where: { id: SUPPLIER_ID, version: 3 },
      data: { remark: '新备注', version: { increment: 1 } },
    })
  })

  it('treats a lost expected-version update as an invariant violation', async () => {
    const fixture = transactionFixture()
    fixture.supplierUpdateMany.mockResolvedValue({ count: 0 })
    await expect(updateSupplierRecord(
      fixture.transaction,
      SUPPLIER_ID,
      { enabled: true },
      3,
    )).rejects.toThrow('Supplier locked update invariant violated')
  })
})
