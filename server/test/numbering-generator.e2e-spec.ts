import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'pg'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import {
  calculateIdempotencyKeyHash,
  calculateNumberingRequestFingerprintHash,
} from '../src/modules/numbering/numbering-internal-input'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
  type NumberingGenerationErrorCode,
} from '../src/modules/numbering/numbering.errors'
import type { NumberingRandomSource } from '../src/modules/numbering/random-source'
import type {
  NumberingResetPolicy,
  NumberingRuleSegment,
} from '../src/modules/numbering/rule-engine'
import {
  createIsolatedNumberingDatabase,
  type IsolatedNumberingDatabase,
  IsolatedNumberingPrismaService,
} from './numbering-e2e-database'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const

interface NumberingRuleDetailBody {
  id: string
  ruleCode: string
  status: 'DISABLED' | 'DRAFT' | 'ENABLED'
  version: number
  activeVersion: null | { revision: number }
  draftVersion: null | { revision: number }
  statistics: {
    lifetimeUsedCount: string
    periodKey: string
    usedCount: string
  }
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function uniqueRuleCode(prefix: string): string {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
  return `${prefix}_${suffix}`
}

function periodParts(instant: string): {
  daily: string
  monthly: string
  yearly: string
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find(part => part.type === type)?.value
    if (!value) {
      throw new Error(`Missing ${type} in Asia/Shanghai period`)
    }
    return value
  }
  const year = read('year')
  const month = read('month')
  const day = read('day')
  return {
    daily: `${year}${month}${day}`,
    monthly: `${year}${month}`,
    yearly: year,
  }
}

class QueuedRandomSource implements NumberingRandomSource {
  private index = 0

  constructor(
    private readonly values: readonly number[],
    private readonly fallback = 0,
  ) {}

  get calls(): number {
    return this.index
  }

  nextInt(maxExclusive: number): number {
    const value = this.values[this.index] ?? this.fallback
    this.index += 1
    if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
      throw new Error('Queued E2E random value is outside the requested bound')
    }
    return value
  }
}

async function expectGenerationError(
  action: Promise<unknown>,
  code: NumberingGenerationErrorCode,
): Promise<void> {
  try {
    await action
  }
  catch (error) {
    expect(error).toBeInstanceOf(NumberingGenerationError)
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`Expected NumberingGenerationError ${code}`)
}

async function waitForBlockedQuery(
  monitor: Client,
  blockerPid: number | null,
  lockClause: 'FOR SHARE' | 'FOR UPDATE',
): Promise<number> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const result = await monitor.query<{ pid: number }>(
      `
        SELECT activity.pid
        FROM pg_stat_activity AS activity
        WHERE cardinality(pg_blocking_pids(activity.pid)) > 0
          AND ($1::integer IS NULL
            OR $1 = ANY(pg_blocking_pids(activity.pid)))
          AND activity.wait_event_type = 'Lock'
          AND position($2 IN activity.query) > 0
        ORDER BY activity.pid
        LIMIT 1
      `,
      [blockerPid, lockClause],
    )
    const pid = result.rows[0]?.pid
    if (typeof pid === 'number') {
      return pid
    }
    // 轮询数据库可观测锁状态，而不是依赖机器速度猜测固定延时。
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for blocked ${lockClause} query`)
}

describe('NumberingGeneratorService concurrency and capacity with PostgreSQL', () => {
  jest.setTimeout(180_000)

  let application: INestApplication
  let browser: ReturnType<typeof request.agent>
  let database: IsolatedNumberingDatabase
  let generator: NumberingGeneratorService
  let originalDatabaseUrl: string | undefined
  let passwordProvider: PasswordProvider
  let prisma: PrismaService

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL
    database = await createIsolatedNumberingDatabase()
    process.env.DATABASE_URL = database.databaseUrl
    const isolatedPrisma = new IsolatedNumberingPrismaService(database)

    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(isolatedPrisma)
      .compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    generator = application.get(NumberingGeneratorService)
    passwordProvider = application.get(PasswordProvider)
    prisma = application.get(PrismaService)

    const suffix = randomUUID()
    const username = `numbering-generator-e2e-${suffix}`
    const password = `Num-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '编号发号 E2E 用户',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    })

    browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
  })

  afterAll(async () => {
    await application?.close()
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    }
    else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
    await database?.dispose()
  })

  async function createEnabledRule(input: {
    resetPolicy: NumberingResetPolicy
    ruleCode: string
    segments: readonly NumberingRuleSegment[]
  }): Promise<NumberingRuleDetailBody> {
    const createdResponse = await browser
      .post('/api/numbering-rules')
      .set(CSRF_HEADERS)
      .send({
        ruleCode: input.ruleCode,
        name: `E2E ${input.ruleCode}`,
        resetPolicy: input.resetPolicy,
        segments: input.segments,
      })
      .expect(201)
    const created = readResponseBody<NumberingRuleDetailBody>(createdResponse)
    expect(created).toMatchObject({ version: 1, status: 'DRAFT' })

    await browser
      .post(`/api/numbering-rules/${created.id}/publish`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1, draftRevision: 1 })
      .expect(200)
    const enabledResponse = await browser
      .post(`/api/numbering-rules/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
    return readResponseBody<NumberingRuleDetailBody>(enabledResponse)
  }

  const sequence = (
    width = 6,
    startValue = '1',
    step = '1',
  ): NumberingRuleSegment => ({
    type: 'SEQUENCE',
    width,
    startValue,
    step,
  })

  it.each([
    ['NEVER', 'ALL'],
    ['YEARLY', 'yearly'],
    ['MONTHLY', 'monthly'],
    ['DAILY', 'daily'],
  ] as const)(
    'uses one Asia/Shanghai database instant for %s period state',
    async (resetPolicy, expectedPeriod) => {
      const ruleCode = uniqueRuleCode(`PERIOD_${resetPolicy}`)
      const dateSegment: NumberingRuleSegment[] = resetPolicy === 'NEVER'
        ? []
        : [{
            type: 'DATE',
            format: resetPolicy === 'YEARLY'
              ? 'YYYY'
              : resetPolicy === 'MONTHLY'
                ? 'YYYYMM'
                : 'YYYYMMDD',
          }]
      const rule = await createEnabledRule({
        resetPolicy,
        ruleCode,
        segments: [...dateSegment, sequence(4)],
      })
      const result = await generator.generate({
        ruleCode,
        consumerCode: 'PERIOD.E2E',
        idempotencyKey: randomUUID(),
      })
      const expected = expectedPeriod === 'ALL'
        ? 'ALL'
        : periodParts(result.issuedAt)[expectedPeriod]

      const state = await prisma.numberingPeriodState.findUniqueOrThrow({
        where: {
          ruleId_periodKey: { ruleId: rule.id, periodKey: expected },
        },
      })
      expect(state).toMatchObject({ usedCount: 1n, nextSequenceValue: 2n })
      const issuance = await prisma.numberingIssuance.findFirstOrThrow({
        where: { ruleId: rule.id },
      })
      expect(issuance.id).toBe(result.issuanceId)
      expect(issuance.periodKey).toBe(expected)
      expect(issuance.issuedAt.toISOString()).toBe(result.issuedAt)
    },
  )

  it('serializes 100 distinct keys and collapses 100 same-key calls to one ledger row', async () => {
    const distinctCode = uniqueRuleCode('DISTINCT')
    const distinctRule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode: distinctCode,
      segments: [sequence()],
    })
    const distinctResults = await Promise.all(Array.from(
      { length: 100 },
      (_value, index) => generator.generate({
        ruleCode: distinctCode,
        consumerCode: 'CONCURRENCY.DISTINCT',
        idempotencyKey: `distinct-${index}-${randomUUID()}`,
      }),
    ))
    expect(new Set(distinctResults.map(result => result.number)).size).toBe(100)
    expect(new Set(distinctResults.map(result => result.issuanceId)).size)
      .toBe(100)
    expect(distinctResults.every(result => !result.idempotentReplay)).toBe(true)
    const distinctLedger = await prisma.numberingIssuance.findMany({
      where: { ruleId: distinctRule.id },
      orderBy: { sequenceValue: 'asc' },
      select: { id: true, sequenceValue: true },
    })
    expect(distinctLedger.map(row => row.sequenceValue)).toEqual(
      Array.from({ length: 100 }, (_value, index) => BigInt(index + 1)),
    )
    expect(new Set(distinctLedger.map(row => row.id))).toEqual(
      new Set(distinctResults.map(result => result.issuanceId)),
    )
    await expect(prisma.numberingPeriodState.findUniqueOrThrow({
      where: {
        ruleId_periodKey: { ruleId: distinctRule.id, periodKey: 'ALL' },
      },
    })).resolves.toMatchObject({
      usedCount: 100n,
      nextSequenceValue: 101n,
    })

    const sameCode = uniqueRuleCode('SAME_KEY')
    const sameRule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode: sameCode,
      segments: [sequence()],
    })
    const sameKey = `same-${randomUUID()}`
    const sameResults = await Promise.all(Array.from(
      { length: 100 },
      () => generator.generate({
        ruleCode: sameCode,
        consumerCode: 'CONCURRENCY.SAME',
        idempotencyKey: sameKey,
      }),
    ))
    expect(new Set(sameResults.map(result => result.number)).size).toBe(1)
    expect(new Set(sameResults.map(result => result.issuanceId)).size).toBe(1)
    expect(sameResults.filter(result => !result.idempotentReplay)).toHaveLength(1)
    expect(sameResults.filter(result => result.idempotentReplay)).toHaveLength(99)
    await expect(prisma.numberingIssuance.count({
      where: { ruleId: sameRule.id },
    })).resolves.toBe(1)
    await expect(prisma.numberingPeriodState.findUniqueOrThrow({
      where: {
        ruleId_periodKey: { ruleId: sameRule.id, periodKey: 'ALL' },
      },
    })).resolves.toMatchObject({
      usedCount: 1n,
      nextSequenceValue: 2n,
    })
  })

  it('issues the last sequence capacity exactly once and never advances after exhaustion', async () => {
    const ruleCode = uniqueRuleCode('LAST_CAPACITY')
    const rule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode,
      segments: [sequence(1, '8')],
    })

    await expect(generator.generate({
      ruleCode,
      consumerCode: 'CAPACITY.E2E',
      idempotencyKey: `preconsume-${randomUUID()}`,
    })).resolves.toMatchObject({ number: '8' })

    // 先把容量消耗到只剩最后一位，再让 20 个不同幂等键真实竞争同一 state。
    const competition = await Promise.allSettled(Array.from(
      { length: 20 },
      (_value, index) => generator.generate({
        ruleCode,
        consumerCode: 'CAPACITY.E2E',
        idempotencyKey: `last-${index}-${randomUUID()}`,
      }),
    ))
    const fulfilled = competition.filter(
      (result): result is PromiseFulfilledResult<
        Awaited<ReturnType<NumberingGeneratorService['generate']>>
      > => result.status === 'fulfilled',
    )
    const rejected = competition.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0]?.value.number).toBe('9')
    expect(rejected).toHaveLength(19)
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(NumberingGenerationError)
      expect(result.reason).toMatchObject({
        code: NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED,
      })
    }

    await expect(prisma.numberingPeriodState.findUniqueOrThrow({
      where: {
        ruleId_periodKey: { ruleId: rule.id, periodKey: 'ALL' },
      },
    })).resolves.toMatchObject({ usedCount: 2n, nextSequenceValue: null })
    await expect(prisma.numberingIssuance.count({
      where: { ruleId: rule.id },
    })).resolves.toBe(2)
  })

  it('supports pure random and mixed output and distinguishes the 31st retry from 32 collisions', async () => {
    const randomCode = uniqueRuleCode('RANDOM')
    const randomRule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode: randomCode,
      segments: [{
        type: 'RANDOM',
        letterLength: 1,
        digitLength: 0,
        mode: 'LETTERS_THEN_DIGITS',
      }],
    })
    const firstSource = new QueuedRandomSource([0])
    const firstService = new NumberingGeneratorService(prisma, firstSource)
    await expect(firstService.generate({
      ruleCode: randomCode,
      consumerCode: 'RANDOM.E2E',
      idempotencyKey: `first-${randomUUID()}`,
    })).resolves.toMatchObject({ number: 'A', idempotentReplay: false })

    const thirtyFirstCollisionThenSuccess = new QueuedRandomSource([
      ...Array.from({ length: 31 }, () => 0),
      1,
    ])
    const retryService = new NumberingGeneratorService(
      prisma,
      thirtyFirstCollisionThenSuccess,
    )
    await expect(retryService.generate({
      ruleCode: randomCode,
      consumerCode: 'RANDOM.E2E',
      idempotencyKey: `retry-${randomUUID()}`,
    })).resolves.toMatchObject({ number: 'B', idempotentReplay: false })
    expect(thirtyFirstCollisionThenSuccess.calls).toBe(32)

    const exhaustedSource = new QueuedRandomSource([])
    const exhaustedService = new NumberingGeneratorService(
      prisma,
      exhaustedSource,
    )
    await expectGenerationError(exhaustedService.generate({
      ruleCode: randomCode,
      consumerCode: 'RANDOM.E2E',
      idempotencyKey: `collisions-${randomUUID()}`,
    }), NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED)
    expect(exhaustedSource.calls).toBe(32)
    await expect(prisma.numberingPeriodState.findUniqueOrThrow({
      where: {
        ruleId_periodKey: { ruleId: randomRule.id, periodKey: 'ALL' },
      },
    })).resolves.toMatchObject({ usedCount: 2n, nextSequenceValue: null })
    await expect(prisma.numberingIssuance.count({
      where: { ruleId: randomRule.id },
    })).resolves.toBe(2)

    const mixedCode = uniqueRuleCode('MIXED')
    const mixedRule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode: mixedCode,
      segments: [
        sequence(2),
        {
          type: 'RANDOM',
          letterLength: 0,
          digitLength: 1,
          mode: 'LETTERS_THEN_DIGITS',
        },
      ],
    })
    const mixedSource = new QueuedRandomSource([3, 4])
    const mixedService = new NumberingGeneratorService(prisma, mixedSource)
    const mixedResults = await Promise.all([
      mixedService.generate({
        ruleCode: mixedCode,
        consumerCode: 'MIXED.E2E',
        idempotencyKey: `mixed-a-${randomUUID()}`,
      }),
      mixedService.generate({
        ruleCode: mixedCode,
        consumerCode: 'MIXED.E2E',
        idempotencyKey: `mixed-b-${randomUUID()}`,
      }),
    ])
    expect(mixedResults.map(result => result.number).sort()).toEqual([
      '013',
      '024',
    ])
    const mixedIssuances = await prisma.numberingIssuance.findMany({
      where: { ruleId: mixedRule.id },
      orderBy: { sequenceValue: 'asc' },
    })
    expect(mixedIssuances.map(row => row.sequenceValue)).toEqual([1n, 2n])
  })

  it('sums lifetime usage and serializes publish with generation before honoring disable replay', async () => {
    const lifetimeCode = uniqueRuleCode('LIFETIME')
    const lifetimeRule = await createEnabledRule({
      resetPolicy: 'DAILY',
      ruleCode: lifetimeCode,
      segments: [
        { type: 'DATE', format: 'YYYYMMDD' },
        sequence(4),
      ],
    })
    const current = await generator.generate({
      ruleCode: lifetimeCode,
      consumerCode: 'LIFETIME.E2E',
      idempotencyKey: randomUUID(),
    })
    const currentPeriod = periodParts(current.issuedAt).daily
    const historicalPeriod = currentPeriod === '19990101'
      ? '19990102'
      : '19990101'
    const activeLifetimeVersion = await prisma.numberingRuleVersion
      .findFirstOrThrow({
        where: { ruleId: lifetimeRule.id, status: 'ACTIVE' },
      })
    await prisma.numberingPeriodState.create({
      data: {
        ruleId: lifetimeRule.id,
        periodKey: historicalPeriod,
        usedCount: 7n,
        nextSequenceValue: 8n,
      },
    })
    await prisma.numberingIssuance.createMany({
      data: Array.from({ length: 7 }, (_value, index) => {
        const sequenceValue = BigInt(index + 1)
        return {
          ruleId: lifetimeRule.id,
          ruleVersionId: activeLifetimeVersion.id,
          periodKey: historicalPeriod,
          generatedNumber:
            `${historicalPeriod}${String(index + 1).padStart(4, '0')}`,
          sequenceValue,
          consumerCode: 'LIFETIME.HISTORY',
          idempotencyKeyHash: Uint8Array.from(
            calculateIdempotencyKeyHash(
              `historical-${index}-${randomUUID()}`,
            ),
          ),
          requestFingerprintHash: Uint8Array.from(
            calculateNumberingRequestFingerprintHash(lifetimeCode),
          ),
          issuedAt: new Date('1999-01-01T00:00:00.000Z'),
        }
      }),
    })
    const lifetimeResponse = await browser
      .get(`/api/numbering-rules/${lifetimeRule.id}`)
      .expect(200)
    const lifetime = readResponseBody<NumberingRuleDetailBody>(
      lifetimeResponse,
    )
    expect(lifetime.statistics).toMatchObject({
      periodKey: currentPeriod,
      usedCount: '1',
      lifetimeUsedCount: '8',
    })
    const [lifetimeState, lifetimeLedgerCount] = await Promise.all([
      prisma.numberingPeriodState.aggregate({
        where: { ruleId: lifetimeRule.id },
        _sum: { usedCount: true },
      }),
      prisma.numberingIssuance.count({
        where: { ruleId: lifetimeRule.id },
      }),
    ])
    expect(lifetimeState._sum.usedCount).toBe(8n)
    expect(BigInt(lifetimeLedgerCount)).toBe(lifetimeState._sum.usedCount)
    await prisma.auditEvent.deleteMany({
      where: { targetId: lifetimeRule.id },
    })
    await expect(prisma.numberingIssuance.count({
      where: { ruleId: lifetimeRule.id },
    })).resolves.toBe(8)

    const publishCode = uniqueRuleCode('PUBLISH_RACE')
    const publishRule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode: publishCode,
      segments: [sequence(3)],
    })
    await generator.generate({
      ruleCode: publishCode,
      consumerCode: 'PUBLISH.E2E',
      idempotencyKey: `before-${randomUUID()}`,
    })
    const updateResponse = await browser
      .patch(`/api/numbering-rules/${publishRule.id}`)
      .set(CSRF_HEADERS)
      .send({
        expectedVersion: 3,
        segments: [sequence(4)],
      })
      .expect(200)
    const updated = readResponseBody<NumberingRuleDetailBody>(updateResponse)
    expect(updated).toMatchObject({
      version: 4,
      activeVersion: { revision: 1 },
      draftVersion: { revision: 2 },
    })

    const racingKey = `during-${randomUUID()}`
    const [publishedResponse, racingResult] = await Promise.all([
      browser
        .post(`/api/numbering-rules/${publishRule.id}/publish`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 4, draftRevision: 2 })
        .expect(200),
      generator.generate({
        ruleCode: publishCode,
        consumerCode: 'PUBLISH.E2E',
        idempotencyKey: racingKey,
      }),
    ])
    const published = readResponseBody<NumberingRuleDetailBody>(
      publishedResponse,
    )
    expect(published).toMatchObject({
      status: 'ENABLED',
      version: 5,
      activeVersion: { revision: 2 },
      draftVersion: null,
    })
    if (racingResult.ruleRevision === 1) {
      expect(racingResult.number).toMatch(/^\d{3}$/u)
    }
    else {
      expect(racingResult).toMatchObject({ ruleRevision: 2 })
      expect(racingResult.number).toMatch(/^\d{4}$/u)
    }
    const [publishState, publishLedger] = await Promise.all([
      prisma.numberingPeriodState.findUniqueOrThrow({
        where: {
          ruleId_periodKey: { ruleId: publishRule.id, periodKey: 'ALL' },
        },
      }),
      prisma.numberingIssuance.findMany({
        where: { ruleId: publishRule.id },
        orderBy: { sequenceValue: 'asc' },
        include: {
          ruleVersion: { select: { revision: true } },
        },
      }),
    ])
    expect(publishState).toMatchObject({
      usedCount: 2n,
      nextSequenceValue: 3n,
    })
    expect(publishLedger.map(row => row.sequenceValue)).toEqual([1n, 2n])
    expect(publishLedger).toHaveLength(2)
    expect(publishLedger[1]?.generatedNumber).toBe(racingResult.number)
    expect(publishLedger[1]?.ruleVersion.revision).toBe(
      racingResult.ruleRevision,
    )

    await browser
      .post(`/api/numbering-rules/${publishRule.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 5 })
      .expect(200)
    await expect(generator.generate({
      ruleCode: publishCode,
      consumerCode: 'PUBLISH.E2E',
      idempotencyKey: racingKey,
    })).resolves.toMatchObject({
      issuanceId: racingResult.issuanceId,
      number: racingResult.number,
      ruleRevision: racingResult.ruleRevision,
      idempotentReplay: true,
    })
    await expectGenerationError(generator.generate({
      ruleCode: publishCode,
      consumerCode: 'PUBLISH.E2E',
      idempotencyKey: `disabled-${randomUUID()}`,
    }), NUMBERING_ERROR_CODES.RULE_UNAVAILABLE)
  })

  it('replays a committed ledger row when disable is queued before the retry shared lock', async () => {
    const ruleCode = uniqueRuleCode('DISABLE_LOCK')
    const rule = await createEnabledRule({
      resetPolicy: 'NEVER',
      ruleCode,
      segments: [sequence(3)],
    })
    const activeVersion = await prisma.numberingRuleVersion.findFirstOrThrow({
      where: { ruleId: rule.id, status: 'ACTIVE' },
    })
    const idempotencyKey = `disable-lock-${randomUUID()}`
    const consumerCode = 'DISABLE.LOCK.E2E'
    const holder = new Client({ connectionString: database.databaseUrl })
    const monitor = new Client({ connectionString: database.databaseUrl })
    let holderTransactionOpen = false
    let disablePromise: Promise<unknown> | undefined
    let retryPromise: Promise<unknown> | undefined

    await Promise.all([holder.connect(), monitor.connect()])
    try {
      const holderPidResult = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid()::integer AS pid',
      )
      const holderPid = holderPidResult.rows[0]?.pid
      if (typeof holderPid !== 'number' || !Number.isInteger(holderPid)) {
        throw new Error('PostgreSQL holder PID is unavailable')
      }

      await holder.query('BEGIN')
      holderTransactionOpen = true
      // 测试闸门必须让后到的 disable(FOR UPDATE) 与 retry(FOR SHARE) 都进入
      // PostgreSQL 锁队列；若这里只持有 FOR SHARE，retry 与 holder 兼容，可能
      // 直接越过尚未获锁的 disable，无法确定性覆盖 lookup#2 重放边界。
      await holder.query(
        `
          SELECT "id"
          FROM "numbering_rules"
          WHERE "id" = $1::uuid
          FOR UPDATE
        `,
        [rule.id],
      )
      await holder.query(
        `
          INSERT INTO "numbering_period_states" (
            "rule_id", "period_key", "next_sequence_value", "used_count"
          )
          VALUES ($1::uuid, 'ALL', 2, 1)
        `,
        [rule.id],
      )
      await holder.query(
        `
          INSERT INTO "numbering_issuances" (
            "rule_id",
            "rule_version_id",
            "period_key",
            "generated_number",
            "sequence_value",
            "consumer_code",
            "idempotency_key_hash",
            "request_fingerprint_hash",
            "issued_at"
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            'ALL',
            '001',
            1,
            $3,
            $4,
            $5,
            transaction_timestamp()
          )
        `,
        [
          rule.id,
          activeVersion.id,
          consumerCode,
          calculateIdempotencyKeyHash(idempotencyKey),
          calculateNumberingRequestFingerprintHash(ruleCode),
        ],
      )

      disablePromise = browser
        .post(`/api/numbering-rules/${rule.id}/disable`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 3 })
        .expect(200)
        .then(response => readResponseBody<NumberingRuleDetailBody>(response))
      void disablePromise.catch(() => undefined)
      const disablePid = await waitForBlockedQuery(
        monitor,
        holderPid,
        'FOR UPDATE',
      )

      retryPromise = generator.generate({
        ruleCode,
        consumerCode,
        idempotencyKey,
      })
      void retryPromise.catch(() => undefined)
      const retryPid = await waitForBlockedQuery(monitor, null, 'FOR SHARE')
      expect(retryPid).not.toBe(disablePid)

      await holder.query('COMMIT')
      holderTransactionOpen = false
      const [disabled, replay] = await Promise.all([
        disablePromise,
        retryPromise,
      ]) as [NumberingRuleDetailBody, Awaited<
        ReturnType<NumberingGeneratorService['generate']>
      >]
      expect(disabled).toMatchObject({ status: 'DISABLED', version: 4 })
      expect(replay).toMatchObject({
        number: '001',
        ruleCode,
        ruleRevision: 1,
        idempotentReplay: true,
      })
      const committedIssuance = await prisma.numberingIssuance
        .findFirstOrThrow({ where: { ruleId: rule.id } })
      expect(replay.issuanceId).toBe(committedIssuance.id)
      await expect(prisma.numberingPeriodState.findUniqueOrThrow({
        where: {
          ruleId_periodKey: { ruleId: rule.id, periodKey: 'ALL' },
        },
      })).resolves.toMatchObject({
        usedCount: 1n,
        nextSequenceValue: 2n,
      })
      await expect(prisma.numberingIssuance.count({
        where: { ruleId: rule.id },
      })).resolves.toBe(1)
    }
    finally {
      if (holderTransactionOpen) {
        await holder.query('ROLLBACK').catch(() => undefined)
      }
      await Promise.allSettled([
        ...(disablePromise === undefined ? [] : [disablePromise]),
        ...(retryPromise === undefined ? [] : [retryPromise]),
      ])
      await Promise.all([
        holder.end().catch(() => undefined),
        monitor.end().catch(() => undefined),
      ])
    }
  })
})
