import { HttpStatus } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  RegionLevel,
  SupplierEntityType,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuditService } from '../audit/audit.service'
import type { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import type { RegionLookupService } from '../regions/region-lookup.service'
import type { SupplierDto } from './dto/supplier-response.dto'
import { SupplierLifecycleService } from './supplier-lifecycle.service'
import { SupplierCommandService } from './supplier-command.service'
import {
  completeSupplierCreateRequest,
  createSupplierRecord,
  lockSupplierCreateRequest,
  lockSupplierNumberingIssuance,
  readSupplierDetailForCommand,
  readSupplierForMutation,
  readSupplierRegistrationDuplicate,
  upsertAndLockSupplierCreateRequest,
  updateSupplierRecord,
} from './supplier-command.persistence'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({ applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined) }),
)
jest.mock('./supplier-command.persistence', () => ({
  completeSupplierCreateRequest: jest.fn(),
  createSupplierRecord: jest.fn(),
  lockSupplierCreateRequest: jest.fn(),
  lockSupplierNumberingIssuance: jest.fn(),
  readSupplierDetailForCommand: jest.fn(),
  readSupplierForMutation: jest.fn(),
  readSupplierRegistrationDuplicate: jest.fn(),
  upsertAndLockSupplierCreateRequest: jest.fn(),
  updateSupplierRecord: jest.fn(),
}))

const mockedTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedUpsertIntent = jest.mocked(upsertAndLockSupplierCreateRequest)
const mockedLockIntent = jest.mocked(lockSupplierCreateRequest)
const mockedLockIssuance = jest.mocked(lockSupplierNumberingIssuance)
const mockedDuplicate = jest.mocked(readSupplierRegistrationDuplicate)
const mockedCreate = jest.mocked(createSupplierRecord)
const mockedComplete = jest.mocked(completeSupplierCreateRequest)
const mockedReadDetail = jest.mocked(readSupplierDetailForCommand)
const mockedReadForMutation = jest.mocked(readSupplierForMutation)
const mockedUpdate = jest.mocked(updateSupplierRecord)
let persistedFingerprintHash = Buffer.alloc(32)

const ACTOR_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const KEY = '2f1adcbc-5d63-4f0f-9a9f-265d4c823241'
const REQUEST_ID = '5f6ddb91-c9a0-4ee4-a1de-e2587128fdc3'
const INTENT_ID = '29a605c9-04e3-4099-91eb-63fa1e8c1961'
const SUPPLIER_ID = '65297363-f67c-43f1-a800-0b1fbe15cb67'
const ISSUANCE_ID = '7cbb8ee3-e2a1-419f-a37e-fc0dcefc35e0'
const COUNTRY_ID = '8df74fee-b367-463a-997b-bc5df945f170'
const SECOND_COUNTRY_ID = '03268638-eead-4336-b0f6-d2b2dcaa72ea'
const PROVINCE_ID = 'a0261629-4fb2-49c9-af89-dbe3ef535e4a'
const CITY_ID = '94ea4f4d-aede-47a4-b228-aa6ad4b4a6b4'

const detail: SupplierDto = {
  id: SUPPLIER_ID,
  code: 'SUP-0001',
  legalName: '示例供应商',
  shortName: null,
  entityType: SupplierEntityType.ORGANIZATION,
  registration: null,
  primaryContact: null,
  primaryAddress: null,
  remark: null,
  enabled: false,
  enableReadiness: {
    ready: false,
    missingFields: ['primaryContact.name', 'primaryContact.channel'],
  },
  version: 1,
  createdAt: '2026-08-05T01:00:00.000Z',
  updatedAt: '2026-08-05T01:00:00.000Z',
}

const mutationRecord = {
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
} as const

function createFixture() {
  const txA = { name: 'tx-a' }
  const txC = { name: 'tx-c' }
  let transactionIndex = 0
  const transaction = jest.fn().mockImplementation(
    (callback: (transaction: unknown) => unknown) => {
      const client = transactionIndex === 0 ? txA : txC
      transactionIndex += 1
      return callback(client)
    },
  )
  const prisma = { $transaction: transaction } as unknown as PrismaService
  const generate = jest.fn().mockResolvedValue({
    issuanceId: ISSUANCE_ID,
    number: 'SUP-0001',
    ruleCode: 'SUPPLIER',
    ruleRevision: 1,
    issuedAt: '2026-08-05T00:59:00.000Z',
    idempotentReplay: false,
  })
  const numbering = { generate } as unknown as NumberingGeneratorService
  const record = jest.fn().mockResolvedValue({})
  const audit = { record } as unknown as AuditService
  const lockReferences = jest.fn().mockResolvedValue(new Map())
  const regionLookup = { lockReferences } as unknown as RegionLookupService

  return {
    service: new SupplierCommandService(
      prisma,
      numbering,
      audit,
      regionLookup,
    ),
    lifecycle: new SupplierLifecycleService(prisma, audit, regionLookup),
    transaction,
    txA,
    txC,
    generate,
    record,
    lockReferences,
  }
}

async function expectApiError(
  action: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await action()
    throw new Error('Expected action to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({ code })
    expect((error as ApiException).getStatus()).toBe(status)
  }
}

describe('SupplierCommandService idempotent create', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    persistedFingerprintHash = Buffer.alloc(32)
    mockedUpsertIntent.mockImplementation((_transaction, input) => {
      persistedFingerprintHash = Buffer.from(input.requestFingerprintHash)
      return Promise.resolve({
        id: INTENT_ID,
        requestFingerprintHash: persistedFingerprintHash,
        supplierId: null,
      })
    })
    mockedLockIntent.mockImplementation(() => Promise.resolve({
      id: INTENT_ID,
      requestFingerprintHash: persistedFingerprintHash,
      supplierId: null,
    }))
    mockedLockIssuance.mockResolvedValue({
      id: ISSUANCE_ID,
      generatedNumber: 'SUP-0001',
      consumerCode: 'SUPPLIER.CREATE',
      ruleCode: 'SUPPLIER',
    })
    mockedDuplicate.mockResolvedValue(null)
    mockedCreate.mockResolvedValue({ id: SUPPLIER_ID })
    mockedComplete.mockResolvedValue(undefined)
    mockedReadDetail.mockResolvedValue(detail)
    mockedReadForMutation.mockResolvedValue(mutationRecord)
    mockedUpdate.mockResolvedValue(undefined)
  })

  it('runs Tx-A, numbering and Tx-C in order and commits Supplier/Audit/intent together', async () => {
    const fixture = createFixture()
    const result = await fixture.service.create(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      KEY,
      {
        legalName: ' 示例供应商 ',
        entityType: SupplierEntityType.ORGANIZATION,
      },
    )

    expect(result).toEqual(detail)
    expect(fixture.transaction).toHaveBeenCalledTimes(2)
    expect(mockedTimeouts).toHaveBeenNthCalledWith(1, fixture.txA)
    expect(mockedTimeouts).toHaveBeenNthCalledWith(2, fixture.txC)
    expect(fixture.generate).toHaveBeenCalledWith({
      ruleCode: 'SUPPLIER',
      consumerCode: 'SUPPLIER.CREATE',
      idempotencyKey: `supplier.create.v1:${ACTOR_ID}:${KEY}`,
    })
    expect(fixture.lockReferences).toHaveBeenCalledWith(fixture.txC, [])
    expect(mockedLockIssuance).toHaveBeenCalledWith(fixture.txC, ISSUANCE_ID)
    expect(mockedCreate).toHaveBeenCalledWith(fixture.txC, expect.objectContaining({
      code: 'SUP-0001',
      numberingIssuanceId: ISSUANCE_ID,
      legalName: '示例供应商',
      normalizedLegalName: '示例供应商',
      entityType: SupplierEntityType.ORGANIZATION,
      enabled: false,
    }))
    expect(fixture.record).toHaveBeenCalledWith(fixture.txC, {
      eventType: AuditEventType.SUPPLIER_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'Supplier',
      targetId: SUPPLIER_ID,
      requestId: REQUEST_ID,
      metadata: {
        supplierCode: 'SUP-0001',
        changedFields: 'code,enabled,entityType,legalName',
        version: 1,
      },
    })
    expect(mockedComplete).toHaveBeenCalledWith(
      fixture.txC,
      INTENT_ID,
      SUPPLIER_ID,
    )
    expect(mockedReadDetail).toHaveBeenCalledWith(fixture.txC, SUPPLIER_ID)
    expect(mockedComplete.mock.invocationCallOrder[0]).toBeLessThan(
      mockedReadDetail.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('returns a completed Tx-A replay without numbering, Tx-C or duplicate Audit', async () => {
    mockedUpsertIntent.mockImplementation((_transaction, input) => {
      persistedFingerprintHash = Buffer.from(input.requestFingerprintHash)
      return Promise.resolve({
        id: INTENT_ID,
        requestFingerprintHash: persistedFingerprintHash,
        supplierId: SUPPLIER_ID,
      })
    })
    const fixture = createFixture()

    await expect(fixture.service.create(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      KEY,
      {
        legalName: '示例供应商',
        entityType: SupplierEntityType.ORGANIZATION,
      },
    )).resolves.toEqual(detail)

    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.generate).not.toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
    expect(fixture.record).not.toHaveBeenCalled()
  })

  it('resumes after Tx-A/numbering windows and accepts numbering replay', async () => {
    const fixture = createFixture()
    fixture.generate.mockResolvedValueOnce({
      issuanceId: ISSUANCE_ID,
      number: 'SUP-0001',
      ruleCode: 'SUPPLIER',
      ruleRevision: 1,
      issuedAt: '2026-08-05T00:59:00.000Z',
      idempotentReplay: true,
    })

    await expect(fixture.service.create(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      KEY,
      {
        legalName: '示例供应商',
        entityType: SupplierEntityType.ORGANIZATION,
      },
    )).resolves.toEqual(detail)
    expect(mockedCreate).toHaveBeenCalledTimes(1)
  })

  it('returns the winner when Tx-C observes a concurrently completed intent', async () => {
    mockedLockIntent.mockImplementation(() => Promise.resolve({
      id: INTENT_ID,
      requestFingerprintHash: persistedFingerprintHash,
      supplierId: SUPPLIER_ID,
    }))
    const fixture = createFixture()

    await expect(fixture.service.create(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      KEY,
      {
        legalName: '示例供应商',
        entityType: SupplierEntityType.ORGANIZATION,
      },
    )).resolves.toEqual(detail)
    expect(mockedLockIssuance).not.toHaveBeenCalled()
    expect(mockedCreate).not.toHaveBeenCalled()
    expect(fixture.record).not.toHaveBeenCalled()
  })

  it('rejects an existing key with another normalized payload before numbering', async () => {
    mockedUpsertIntent.mockResolvedValue({
      id: INTENT_ID,
      requestFingerprintHash: Buffer.alloc(32, 2),
      supplierId: null,
    })
    const fixture = createFixture()

    await expectApiError(
      () => fixture.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
        },
      ),
      HttpStatus.CONFLICT,
      'SUPPLIER_IDEMPOTENCY_CONFLICT',
    )
    expect(fixture.generate).not.toHaveBeenCalled()
  })

  it('maps numbering and issuance provenance failures to fixed 503', async () => {
    const generation = createFixture()
    generation.generate.mockRejectedValue(new Error('numbering secret'))
    await expectApiError(
      () => generation.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
        },
      ),
      HttpStatus.SERVICE_UNAVAILABLE,
      'SUPPLIER_NUMBERING_UNAVAILABLE',
    )

    mockedLockIssuance.mockResolvedValue(null)
    const provenance = createFixture()
    await expectApiError(
      () => provenance.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
        },
      ),
      HttpStatus.SERVICE_UNAVAILABLE,
      'SUPPLIER_NUMBERING_UNAVAILABLE',
    )
  })

  it('maps the registration unique constraint and hides unrelated persistence failures', async () => {
    mockedCreate.mockRejectedValueOnce({
      code: 'P2002',
      meta: { constraint: 'suppliers_registration_country_number_key' },
    })
    const duplicate = createFixture()
    await expectApiError(
      () => duplicate.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
        },
      ),
      HttpStatus.CONFLICT,
      'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
    )

    mockedCreate.mockRejectedValueOnce(new Error('database secret'))
    const failed = createFixture()
    await expectApiError(
      () => failed.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
        },
      ),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it('locks and validates a complete Region chain before registration precheck', async () => {
    const fixture = createFixture()
    fixture.lockReferences.mockResolvedValue(new Map([
      [COUNTRY_ID, {
        id: COUNTRY_ID,
        parentId: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
        effectiveEnabled: true,
      }],
      [PROVINCE_ID, {
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: true,
        effectiveEnabled: true,
      }],
      [CITY_ID, {
        id: CITY_ID,
        parentId: PROVINCE_ID,
        level: RegionLevel.CITY,
        enabled: true,
        effectiveEnabled: true,
      }],
    ]))
    mockedDuplicate.mockResolvedValue('another-supplier')

    await expectApiError(
      () => fixture.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
          registration: { countryRegionId: COUNTRY_ID, number: ' 9133 01 ' },
          primaryAddress: {
            countryRegionId: COUNTRY_ID,
            provinceStateId: PROVINCE_ID,
            cityId: CITY_ID,
            addressLine: null,
            postalCode: null,
          },
        },
      ),
      HttpStatus.CONFLICT,
      'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
    )
    expect(fixture.lockReferences).toHaveBeenCalledWith(
      fixture.txC,
      [COUNTRY_ID, COUNTRY_ID, PROVINCE_ID, CITY_ID],
    )
    expect(mockedDuplicate).toHaveBeenCalledWith(
      fixture.txC,
      COUNTRY_ID,
      '913301',
    )
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('separates invalid hierarchy from unavailable Region references', async () => {
    const invalid = createFixture()
    invalid.lockReferences.mockResolvedValue(new Map())
    await expectApiError(
      () => invalid.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
          registration: { countryRegionId: COUNTRY_ID, number: '913301' },
        },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_REGION_INVALID',
    )

    const missingAddress = createFixture()
    missingAddress.lockReferences.mockResolvedValue(new Map())
    await expectApiError(
      () => missingAddress.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
          primaryAddress: {
            countryRegionId: COUNTRY_ID,
            provinceStateId: null,
            cityId: null,
            addressLine: null,
            postalCode: null,
          },
        },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_REGION_INVALID',
    )

    const unavailable = createFixture()
    unavailable.lockReferences.mockResolvedValue(new Map([[COUNTRY_ID, {
      id: COUNTRY_ID,
      parentId: null,
      level: RegionLevel.COUNTRY_REGION,
      enabled: false,
      effectiveEnabled: false,
    }]]))
    await expectApiError(
      () => unavailable.service.create(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        KEY,
        {
          legalName: '示例供应商',
          entityType: SupplierEntityType.ORGANIZATION,
          registration: { countryRegionId: COUNTRY_ID, number: '913301' },
        },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_REGION_UNAVAILABLE',
    )
  })
})

describe('SupplierCommandService update and lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedReadForMutation.mockResolvedValue(mutationRecord)
    mockedReadDetail.mockResolvedValue(detail)
    mockedDuplicate.mockResolvedValue(null)
    mockedUpdate.mockResolvedValue(undefined)
  })

  it('checks expectedVersion before normalized no-op comparison', async () => {
    const fixture = createFixture()
    await expectApiError(
      () => fixture.lifecycle.update(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        SUPPLIER_ID,
        { legalName: '示例供应商', expectedVersion: 2 },
      ),
      HttpStatus.CONFLICT,
      'SUPPLIER_STATE_CHANGED',
    )
    expect(mockedUpdate).not.toHaveBeenCalled()
    expect(fixture.record).not.toHaveBeenCalled()
  })

  it('returns a normalized update no-op without Region, version or Audit writes', async () => {
    const fixture = createFixture()
    await expect(fixture.lifecycle.update(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      { legalName: ' 示例供应商 ', expectedVersion: 3 },
    )).resolves.toEqual(detail)

    expect(fixture.lockReferences).not.toHaveBeenCalled()
    expect(mockedUpdate).not.toHaveBeenCalled()
    expect(fixture.record).not.toHaveBeenCalled()
    expect(mockedReadDetail).toHaveBeenCalledWith(fixture.txA, SUPPLIER_ID)
  })

  it('updates normalized fields and writes exact metadata in one transaction', async () => {
    const fixture = createFixture()
    await fixture.lifecycle.update(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      {
        legalName: '新供应商',
        shortName: ' 新供方 ',
        primaryContact: {
          name: '张三',
          phone: '138-0000-0000',
          wechatId: null,
        },
        remark: ' 新备注 ',
        expectedVersion: 3,
      },
    )

    expect(mockedUpdate).toHaveBeenCalledWith(fixture.txA, SUPPLIER_ID, {
      legalName: '新供应商',
      normalizedLegalName: '新供应商',
      shortName: '新供方',
      normalizedShortName: '新供方',
      contactName: '张三',
      normalizedContactName: '张三',
      contactPhone: '138-0000-0000',
      normalizedContactPhone: '13800000000',
      contactWechatId: null,
      normalizedContactWechatId: null,
      remark: '新备注',
    }, 3)
    expect(fixture.record).toHaveBeenCalledWith(fixture.txA, {
      eventType: AuditEventType.SUPPLIER_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'Supplier',
      targetId: SUPPLIER_ID,
      requestId: REQUEST_ID,
      metadata: {
        supplierCode: 'SUP-0001',
        changedFields: 'legalName,primaryContact,remark,shortName',
        previousVersion: 3,
        version: 4,
      },
    })
  })

  it('validates changed Region references but preserves unchanged historical ones', async () => {
    mockedReadForMutation.mockResolvedValue({
      ...mutationRecord,
      registrationCountryRegionId: COUNTRY_ID,
      registrationNumber: 'REG-1',
      normalizedRegistrationNumber: 'REG-1',
      addressCountryRegionId: COUNTRY_ID,
    })
    const unchanged = createFixture()
    await unchanged.lifecycle.update(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      { remark: '仅改备注', expectedVersion: 3 },
    )
    expect(unchanged.lockReferences).not.toHaveBeenCalled()

    const changed = createFixture()
    changed.lockReferences.mockResolvedValue(new Map([[SECOND_COUNTRY_ID, {
      id: SECOND_COUNTRY_ID,
      parentId: null,
      level: RegionLevel.COUNTRY_REGION,
      enabled: false,
      effectiveEnabled: false,
    }]]))
    await expectApiError(
      () => changed.lifecycle.update(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        SUPPLIER_ID,
        {
          registration: {
            countryRegionId: SECOND_COUNTRY_ID,
            number: 'REG-2',
          },
          primaryAddress: null,
          expectedVersion: 3,
        },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_REGION_UNAVAILABLE',
    )
  })

  it('prevents an enabled Supplier from losing its required contact channel', async () => {
    mockedReadForMutation.mockResolvedValue({
      ...mutationRecord,
      enabled: true,
      contactName: '张三',
      normalizedContactName: '张三',
      contactPhone: '13800000000',
      normalizedContactPhone: '13800000000',
    })
    const fixture = createFixture()
    await expectApiError(
      () => fixture.lifecycle.update(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        SUPPLIER_ID,
        {
          primaryContact: { name: '张三', phone: null, wechatId: null },
          expectedVersion: 3,
        },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET',
    )
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('enables only a ready Supplier and audits the version transition', async () => {
    mockedReadForMutation.mockResolvedValue({
      ...mutationRecord,
      contactName: '张三',
      normalizedContactName: '张三',
      contactWechatId: 'silnogm',
      normalizedContactWechatId: 'silnogm',
    })
    const fixture = createFixture()
    await fixture.lifecycle.enable(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      { expectedVersion: 3 },
    )

    expect(mockedUpdate).toHaveBeenCalledWith(
      fixture.txA,
      SUPPLIER_ID,
      { enabled: true },
      3,
    )
    expect(fixture.record).toHaveBeenCalledWith(fixture.txA, expect.objectContaining({
      eventType: AuditEventType.SUPPLIER_ENABLED,
      metadata: {
        supplierCode: 'SUP-0001',
        changedFields: 'enabled',
        previousVersion: 3,
        version: 4,
      },
    }))
  })

  it('rejects unready enable and makes same-state disable a version-checked no-op', async () => {
    const unready = createFixture()
    await expectApiError(
      () => unready.lifecycle.enable(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        SUPPLIER_ID,
        { expectedVersion: 3 },
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET',
    )

    const disabled = createFixture()
    await expect(disabled.lifecycle.disable(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      { expectedVersion: 3 },
    )).resolves.toEqual(detail)
    expect(mockedUpdate).not.toHaveBeenCalled()
    expect(disabled.record).not.toHaveBeenCalled()
  })

  it('checks version before same-state status and audits a real disable', async () => {
    const stale = createFixture()
    await expectApiError(
      () => stale.lifecycle.disable(
        { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
        SUPPLIER_ID,
        { expectedVersion: 2 },
      ),
      HttpStatus.CONFLICT,
      'SUPPLIER_STATE_CHANGED',
    )
    expect(mockedReadDetail).not.toHaveBeenCalled()

    mockedReadForMutation.mockResolvedValue({
      ...mutationRecord,
      enabled: true,
      contactName: '张三',
      normalizedContactName: '张三',
      contactPhone: '13800000000',
      normalizedContactPhone: '13800000000',
    })
    const enabled = createFixture()
    await enabled.lifecycle.disable(
      { actorUserId: ACTOR_ID, requestId: REQUEST_ID },
      SUPPLIER_ID,
      { expectedVersion: 3 },
    )
    expect(mockedUpdate).toHaveBeenCalledWith(
      enabled.txA,
      SUPPLIER_ID,
      { enabled: false },
      3,
    )
    expect(enabled.record).toHaveBeenCalledWith(enabled.txA, expect.objectContaining({
      eventType: AuditEventType.SUPPLIER_DISABLED,
      metadata: {
        supplierCode: 'SUP-0001',
        changedFields: 'enabled',
        previousVersion: 3,
        version: 4,
      },
    }))
  })
})
