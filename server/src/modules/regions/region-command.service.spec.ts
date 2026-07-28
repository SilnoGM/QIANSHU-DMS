import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  RegionLevel,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import type { RegionDto } from './dto/region.dto'
import {
  assertRegionIdentityAvailable,
  createRegionRecord,
  lockRegionIdsInStableOrder,
  readRegionCommandDto,
  readRegionForCreate,
  readRegionForUpdate,
  readRegionStatusGraph,
  updateRegionRecord,
} from './region-command.persistence'
import { RegionCommandService } from './region-command.service'

jest.mock('../../infrastructure/database/transaction-timeouts', () => ({
  applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('./region-command.persistence', () => ({
  assertRegionIdentityAvailable: jest.fn().mockResolvedValue(undefined),
  createRegionRecord: jest.fn(),
  lockRegionIdsInStableOrder: jest.fn().mockResolvedValue(undefined),
  readRegionCommandDto: jest.fn(),
  readRegionForCreate: jest.fn(),
  readRegionForUpdate: jest.fn(),
  readRegionStatusGraph: jest.fn(),
  updateRegionRecord: jest.fn(),
}))

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)
const mockedAssertRegionIdentityAvailable = jest.mocked(
  assertRegionIdentityAvailable,
)
const mockedCreateRegionRecord = jest.mocked(createRegionRecord)
const mockedLockRegionIdsInStableOrder = jest.mocked(
  lockRegionIdsInStableOrder,
)
const mockedReadRegionCommandDto = jest.mocked(readRegionCommandDto)
const mockedReadRegionForCreate = jest.mocked(readRegionForCreate)
const mockedReadRegionForUpdate = jest.mocked(readRegionForUpdate)
const mockedReadRegionStatusGraph = jest.mocked(readRegionStatusGraph)
const mockedUpdateRegionRecord = jest.mocked(updateRegionRecord)

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const COUNTRY_ID = '20000000-0000-4000-8000-000000000001'
const PROVINCE_ID = '30000000-0000-4000-8000-000000000001'
const CITY_ID = '40000000-0000-4000-8000-000000000001'
const CHILD_ID = '50000000-0000-4000-8000-000000000001'
const REQUEST_ID = 'region-command-spec'

const context = {
  actorUserId: ACTOR_ID,
  requestId: REQUEST_ID,
} as const

const now = new Date('2026-07-27T00:00:00.000Z')

function regionDto(
  overrides: Partial<RegionDto> = {},
): RegionDto {
  return {
    id: CITY_ID,
    parentId: PROVINCE_ID,
    code: 'TEST-CITY',
    name: '测试城市',
    englishName: null,
    sourceName: null,
    sourceCode: null,
    administrativeType: RegionLevel.CITY,
    level: RegionLevel.CITY,
    enabled: true,
    effectiveEnabled: true,
    sortOrder: 10,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

function createFixture() {
  const transaction = {}
  const prisma = {
    $transaction: jest.fn((callback: (tx: object) => unknown) =>
      callback(transaction)),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({ id: 'audit-id' }),
  }

  return {
    audit,
    prisma,
    service: new RegionCommandService(
      prisma as unknown as PrismaService,
      audit,
    ),
    transaction,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockedApplyTransactionTimeouts.mockResolvedValue(undefined)
  mockedAssertRegionIdentityAvailable.mockResolvedValue(undefined)
  mockedLockRegionIdsInStableOrder.mockResolvedValue(undefined)
  mockedReadRegionForCreate.mockResolvedValue({
    id: PROVINCE_ID,
    parentId: COUNTRY_ID,
    level: RegionLevel.PROVINCE_STATE,
    enabled: true,
  })
  mockedCreateRegionRecord.mockResolvedValue({ id: CITY_ID })
  mockedReadRegionCommandDto.mockResolvedValue(regionDto())
  mockedReadRegionForUpdate.mockResolvedValue({
    id: CITY_ID,
    parentId: PROVINCE_ID,
    code: 'TEST-CITY',
    name: '测试城市',
    normalizedName: '测试城市',
    englishName: null,
    level: RegionLevel.CITY,
    enabled: true,
    sortOrder: 10,
  })
  mockedUpdateRegionRecord.mockResolvedValue(undefined)
})

describe('RegionCommandService', () => {
  it('creates under a FOR SHARE parent after the timeout and audits only public input fields', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.create(context, {
      parentId: PROVINCE_ID,
      code: ' test-city ',
      name: '  测试   城市  ',
      sortOrder: 10,
      enabled: true,
    })).resolves.toEqual(regionDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedReadRegionForCreate).toHaveBeenCalledWith(
      transaction,
      PROVINCE_ID,
    )
    expect(
      mockedApplyTransactionTimeouts.mock.invocationCallOrder[0],
    ).toBeLessThan(mockedReadRegionForCreate.mock.invocationCallOrder[0])
    expect(mockedAssertRegionIdentityAvailable).toHaveBeenCalledWith(
      transaction,
      {
        code: 'TEST-CITY',
        normalizedName: '测试 城市',
        parentId: PROVINCE_ID,
      },
    )
    expect(mockedCreateRegionRecord).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        administrativeType: RegionLevel.CITY,
        code: 'TEST-CITY',
        englishName: null,
        level: RegionLevel.CITY,
        name: '测试 城市',
        normalizedName: '测试 城市',
        parentId: PROVINCE_ID,
        sourceCode: null,
        sourceName: null,
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: AuditEventType.REGION_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: ACTOR_ID,
      targetType: 'Region',
      targetId: CITY_ID,
      requestId: REQUEST_ID,
      metadata: {
        changedFields: 'code,enabled,name,parentId,sortOrder',
        level: RegionLevel.CITY,
        affectedCount: 1,
      },
    })
  })

  it('locks an update target and returns an idempotent no-op without write or audit', async () => {
    const { audit, service, transaction } = createFixture()

    await expect(service.update(context, CITY_ID, {
      name: '测试城市',
      englishName: null,
      sortOrder: 10,
    })).resolves.toEqual(regionDto())

    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(transaction)
    expect(mockedReadRegionForUpdate).toHaveBeenCalledWith(
      transaction,
      CITY_ID,
    )
    expect(mockedUpdateRegionRecord).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('updates display name even when its normalized uniqueness key is unchanged', async () => {
    mockedReadRegionForUpdate.mockResolvedValue({
      id: CITY_ID,
      parentId: PROVINCE_ID,
      code: 'TEST-CITY',
      name: 'Foo',
      normalizedName: 'foo',
      englishName: null,
      level: RegionLevel.CITY,
      enabled: true,
      sortOrder: 10,
    })
    const { audit, service, transaction } = createFixture()

    await service.update(context, CITY_ID, { name: 'FOO' })

    expect(mockedAssertRegionIdentityAvailable).not.toHaveBeenCalled()
    expect(mockedUpdateRegionRecord).toHaveBeenCalledWith(
      transaction,
      CITY_ID,
      { name: 'FOO' },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.REGION_UPDATED,
        metadata: {
          changedFields: 'name',
          level: RegionLevel.CITY,
          affectedCount: 1,
        },
      }),
    )
  })

  it('locks ancestry and subtree IDs in UUID order, changes only target own state and counts effective changes', async () => {
    const before = [
      {
        id: CHILD_ID,
        parentId: CITY_ID,
        level: RegionLevel.CITY,
        enabled: true,
      },
      {
        id: CITY_ID,
        parentId: PROVINCE_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: true,
      },
      {
        id: COUNTRY_ID,
        parentId: null,
        level: RegionLevel.COUNTRY_REGION,
        enabled: true,
      },
      {
        id: PROVINCE_ID,
        parentId: COUNTRY_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: true,
      },
    ]
    mockedReadRegionStatusGraph
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
    mockedReadRegionCommandDto.mockResolvedValue(
      regionDto({
        id: CITY_ID,
        level: RegionLevel.PROVINCE_STATE,
        enabled: false,
        effectiveEnabled: false,
      }),
    )
    const { audit, service, transaction } = createFixture()

    const result = await service.disable(context, CITY_ID)
    expect(result.affectedCount).toBe(2)
    expect(result.region).toMatchObject({
      id: CITY_ID,
      enabled: false,
    })

    expect(mockedLockRegionIdsInStableOrder).toHaveBeenCalledWith(
      transaction,
      [COUNTRY_ID, PROVINCE_ID, CITY_ID, CHILD_ID].sort(),
    )
    expect(mockedUpdateRegionRecord).toHaveBeenCalledWith(
      transaction,
      CITY_ID,
      { enabled: false },
    )
    expect(audit.record).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: AuditEventType.REGION_DISABLED,
        metadata: {
          changedFields: 'enabled',
          level: RegionLevel.PROVINCE_STATE,
          affectedCount: 2,
        },
      }),
    )
  })

  it('maps Audit failure to a safe 500 so the enclosing transaction rejects', async () => {
    const { audit, service } = createFixture()
    audit.record.mockRejectedValue(new Error('sensitive database detail'))

    await expect(service.create(context, {
      parentId: PROVINCE_ID,
      code: 'TEST-CITY',
      name: '测试城市',
      sortOrder: 10,
      enabled: true,
    })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
  })
})
