import { ApiException } from '../../infrastructure/http/api.exception'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'

import { AuditQueryService } from './audit-query.service'

const ACTOR_USER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const EVENT_ID = 'c277ef16-894a-472a-b2f4-33a4bfc21d00'

interface AuditEventQueryRow {
  id: string
  eventType: AuditEventType
  outcome: AuditOutcome
  occurredAt: Date
  actorType: AuditActorType
  actorUserId: string | null
  actorUser: { displayName: string } | null
  targetType: string | null
  targetId: string | null
  requestId: string
  correlationId: string | null
  reasonCode: string | null
  metadata: unknown
}

function createRow(
  overrides: Partial<AuditEventQueryRow> = {},
): AuditEventQueryRow {
  return {
    id: EVENT_ID,
    eventType: AuditEventType.USER_UPDATED,
    outcome: AuditOutcome.SUCCESS,
    occurredAt: new Date('2026-07-17T08:30:00.000Z'),
    actorType: AuditActorType.USER,
    actorUserId: ACTOR_USER_ID,
    actorUser: { displayName: '系统管理员' },
    targetType: 'User',
    targetId: ACTOR_USER_ID,
    requestId: 'req-123',
    correlationId: 'correlation-123',
    reasonCode: 'ADMIN_REQUEST',
    metadata: { changedFieldCount: 1 },
    ...overrides,
  }
}

interface PrismaFixture {
  prisma: PrismaService
  queryRaw: jest.Mock<Promise<unknown[]>, [unknown]>
  count: jest.Mock<Promise<number>, [unknown]>
  findMany: jest.Mock<Promise<AuditEventQueryRow[]>, [unknown]>
  transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => Promise<unknown>]>
}

function createPrismaFixture(
  rows: AuditEventQueryRow[] = [createRow()],
  total = rows.length,
): PrismaFixture {
  const queryRaw = jest
    .fn<Promise<unknown[]>, [unknown]>()
    .mockResolvedValue([])
  const count = jest.fn<Promise<number>, [unknown]>().mockResolvedValue(total)
  const findMany = jest
    .fn<Promise<AuditEventQueryRow[]>, [unknown]>()
    .mockResolvedValue(rows)
  const transaction = jest
    .fn<Promise<unknown>, [(tx: unknown) => Promise<unknown>]>()
    .mockImplementation(callback =>
      callback({
        $queryRaw: queryRaw,
        auditEvent: { count, findMany },
      }),
    )

  return {
    prisma: {
      $transaction: transaction,
    } as unknown as PrismaService,
    queryRaw,
    count,
    findMany,
    transaction,
  }
}

describe('AuditQueryService', () => {
  it('uses default pagination and a deterministic newest-first order', async () => {
    const fixture = createPrismaFixture()
    const service = new AuditQueryService(fixture.prisma)

    await expect(service.list({})).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(fixture.count).toHaveBeenCalledWith({ where: {} })
    const findManyInput = fixture.findMany.mock.calls[0]?.[0] as {
      where: unknown
      orderBy: unknown
      skip: number
      take: number
      select: unknown
    }
    expect(findManyInput).toMatchObject({
      where: {},
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    })
    expect(findManyInput.select).toBeDefined()
    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function))
    const timeoutOrder = fixture.queryRaw.mock.invocationCallOrder[0]
    const countOrder = fixture.count.mock.invocationCallOrder[0]
    const findManyOrder = fixture.findMany.mock.invocationCallOrder[0]
    expect(timeoutOrder).toBeLessThan(countOrder)
    expect(countOrder).toBeLessThan(findManyOrder)
  })

  it('uses only page and pageSize to calculate the requested page', async () => {
    const fixture = createPrismaFixture([], 0)
    const service = new AuditQueryService(fixture.prisma)

    await service.list({
      page: 2,
      pageSize: 50,
    })

    expect(fixture.count).toHaveBeenCalledWith({ where: {} })
    expect(fixture.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 50,
        take: 50,
      }),
    )
  })

  it('组合精确查询条件，并让 count/findMany 共享同一 where', async () => {
    const fixture = createPrismaFixture([], 0)
    const service = new AuditQueryService(fixture.prisma)

    await service.list({
      page: 1,
      pageSize: 20,
      requestId: 'request-123',
      eventType: AuditEventType.USER_UPDATED,
      outcome: AuditOutcome.FAILURE,
    })

    const countInput = fixture.count.mock.calls[0]?.[0] as {
      where: unknown
    }
    const findManyInput = fixture.findMany.mock.calls[0]?.[0] as {
      where: unknown
    }
    expect(countInput.where).toEqual({
      requestId: 'request-123',
      eventType: AuditEventType.USER_UPDATED,
      outcome: AuditOutcome.FAILURE,
    })
    expect(findManyInput.where).toBe(countInput.where)
  })

  it('按 Unicode code point 接受 64 个双码元字符的 requestId', async () => {
    const fixture = createPrismaFixture([], 0)
    const service = new AuditQueryService(fixture.prisma)
    const requestId = '😀'.repeat(64)

    await service.list({ requestId })

    expect(fixture.count).toHaveBeenCalledWith({
      where: { requestId },
    })
  })

  it('returns only the public projection and serializes timestamps', async () => {
    const fixture = createPrismaFixture()
    const service = new AuditQueryService(fixture.prisma)

    const result = await service.list({})

    expect(result.items).toEqual([
      {
        id: EVENT_ID,
        eventType: AuditEventType.USER_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        occurredAt: '2026-07-17T08:30:00.000Z',
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_USER_ID,
        actorDisplayName: '系统管理员',
        targetType: 'User',
        targetId: ACTOR_USER_ID,
        requestId: 'req-123',
        correlationId: 'correlation-123',
        reasonCode: 'ADMIN_REQUEST',
        metadata: { changedFieldCount: 1 },
      },
    ])

    const query = fixture.findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>
    }
    expect(query.select.sourceIpHash).toBeUndefined()
    expect(query.select.actorUser).toEqual({
      select: { displayName: true },
    })
    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
      'actorDisplayName',
      'actorType',
      'actorUserId',
      'correlationId',
      'eventType',
      'id',
      'metadata',
      'occurredAt',
      'outcome',
      'reasonCode',
      'requestId',
      'targetId',
      'targetType',
    ])
    expect(JSON.stringify(result)).not.toContain('sourceIpHash')
  })

  it.each([
    AuditActorType.SYSTEM,
    AuditActorType.ANONYMOUS,
  ])('%s 事件不臆造用户展示名', async (actorType) => {
    const fixture = createPrismaFixture([
      createRow({
        actorType,
        actorUserId: null,
        actorUser: null,
      }),
    ])
    const service = new AuditQueryService(fixture.prisma)

    const result = await service.list({})

    expect(result.items[0]?.actorDisplayName).toBeNull()
  })

  it('drops nested or collection metadata values instead of exposing them', async () => {
    const fixture = createPrismaFixture([
      createRow({
        metadata: {
          text: 'safe',
          count: 3,
          flag: true,
          empty: null,
          nested: { value: 'not-public' },
          values: ['not-public'],
        },
      }),
    ])
    const service = new AuditQueryService(fixture.prisma)

    const result = await service.list({})

    expect(result.items[0]?.metadata).toEqual({
      text: 'safe',
      count: 3,
      flag: true,
      empty: null,
    })
  })

  it.each([
    ['zero page', { page: 0 }],
    ['fraction page', { page: 1.5 }],
    ['non-number page', { page: '1' }],
    ['zero pageSize', { pageSize: 0 }],
    ['pageSize above 100', { pageSize: 101 }],
    [
      'unsafe offset',
      { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    ],
    ['empty requestId', { requestId: '' }],
    ['requestId above 64 code points', { requestId: '😀'.repeat(65) }],
    ['unknown eventType', { eventType: 'UNKNOWN_EVENT' }],
    ['unknown outcome', { outcome: 'UNKNOWN_OUTCOME' }],
  ])('rejects %s with the fixed 422 contract', async (_name, query) => {
    const fixture = createPrismaFixture()
    const service = new AuditQueryService(fixture.prisma)

    let thrown: unknown
    try {
      await service.list(query as never)
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiException)
    expect((thrown as ApiException).getStatus()).toBe(422)
    expect((thrown as ApiException).code).toBe('VALIDATION_FAILED')
    expect((thrown as ApiException).publicMessage).toBe('请求参数校验失败')
    expect(fixture.count).not.toHaveBeenCalled()
    expect(fixture.findMany).not.toHaveBeenCalled()
  })

  it('queries every call and never serves an in-process cached page', async () => {
    const fixture = createPrismaFixture()
    const service = new AuditQueryService(fixture.prisma)

    await service.list({ page: 1, pageSize: 20 })
    await service.list({ page: 1, pageSize: 20 })

    expect(fixture.count).toHaveBeenCalledTimes(2)
    expect(fixture.findMany).toHaveBeenCalledTimes(2)
    expect(fixture.transaction).toHaveBeenCalledTimes(2)
  })

  it('maps database failures to one fixed safe 500 error', async () => {
    const fixture = createPrismaFixture()
    fixture.transaction.mockRejectedValueOnce(
      new Error('password=must-not-leak host=internal-db.example'),
    )
    const service = new AuditQueryService(fixture.prisma)

    let thrown: unknown
    try {
      await service.list({})
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiException)
    expect((thrown as ApiException).getStatus()).toBe(500)
    expect((thrown as ApiException).code).toBe('INTERNAL_ERROR')
    expect((thrown as ApiException).publicMessage).toBe('服务器内部错误')
    expect((thrown as Error).message).not.toContain('must-not-leak')
    expect((thrown as Error).message).not.toContain('internal-db.example')
  })
})
