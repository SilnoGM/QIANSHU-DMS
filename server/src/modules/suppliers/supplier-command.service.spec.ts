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
import { SupplierCommandService } from './supplier-command.service'
import {
  completeSupplierCreateRequest,
  createSupplierRecord,
  lockSupplierCreateRequest,
  lockSupplierNumberingIssuance,
  readSupplierDetailForCommand,
  readSupplierRegistrationDuplicate,
  upsertAndLockSupplierCreateRequest,
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
  readSupplierRegistrationDuplicate: jest.fn(),
  upsertAndLockSupplierCreateRequest: jest.fn(),
}))

const mockedTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedUpsertIntent = jest.mocked(upsertAndLockSupplierCreateRequest)
const mockedLockIntent = jest.mocked(lockSupplierCreateRequest)
const mockedLockIssuance = jest.mocked(lockSupplierNumberingIssuance)
const mockedDuplicate = jest.mocked(readSupplierRegistrationDuplicate)
const mockedCreate = jest.mocked(createSupplierRecord)
const mockedComplete = jest.mocked(completeSupplierCreateRequest)
const mockedReadDetail = jest.mocked(readSupplierDetailForCommand)
let persistedFingerprintHash = Buffer.alloc(32)

const ACTOR_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const KEY = '2f1adcbc-5d63-4f0f-9a9f-265d4c823241'
const REQUEST_ID = '5f6ddb91-c9a0-4ee4-a1de-e2587128fdc3'
const INTENT_ID = '29a605c9-04e3-4099-91eb-63fa1e8c1961'
const SUPPLIER_ID = '65297363-f67c-43f1-a800-0b1fbe15cb67'
const ISSUANCE_ID = '7cbb8ee3-e2a1-419f-a37e-fc0dcefc35e0'
const COUNTRY_ID = '8df74fee-b367-463a-997b-bc5df945f170'
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
