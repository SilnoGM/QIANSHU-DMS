import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'pg'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { Prisma } from '../src/generated/prisma/client'
import { DictionaryTone } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../src/infrastructure/database/transaction-timeouts'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
  type EffectiveDictionaryValue,
} from '../src/modules/dictionaries/dictionary-lookup.service'
import {
  createIsolatedDictionaryDatabase,
  type IsolatedDictionaryDatabase,
  IsolatedDictionaryPrismaService,
} from './dictionary-e2e-database'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const LOCK_OBSERVATION_TIMEOUT_MS = 1_000
const ASYNC_ASSERTION_TIMEOUT_MS = 3_000

interface ApiErrorBody {
  readonly code: string
  readonly message: string
  readonly requestId: string
}

interface AuthContextBody {
  readonly permissions: string[]
}

interface DictionaryCatalogItemBody {
  readonly value: string
  readonly label: string
  readonly tone: DictionaryTone
  readonly enabled: boolean
  readonly effectiveEnabled: boolean
  readonly sortOrder: number
}

interface DictionaryCatalogBody {
  readonly code: string
  readonly name: string
  readonly enabled: boolean
  readonly items: DictionaryCatalogItemBody[]
}

interface DictionaryCatalogBatchBody {
  readonly dictionaries: DictionaryCatalogBody[]
  readonly missingCodes: string[]
}

interface SeededDictionaryCatalogs {
  readonly activeCode: string
  readonly activeTypeId: string
  readonly activeEnabledItemId: string
  readonly activeEnabledValue: string
  readonly activeSecondValue: string
  readonly activeDisabledValue: string
  readonly disabledCode: string
  readonly disabledEnabledValue: string
  readonly disabledDisabledValue: string
  readonly firstMissingCode: string
  readonly secondMissingCode: string
}

interface BackendActivityRow {
  readonly waitEventType: string | null
}

interface BackendPidRow {
  readonly pid: number
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function readResponseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

function createDeferred<T>(): Deferred<T> {
  let resolver: ((value: T) => void) | undefined
  let settled = false
  const promise = new Promise<T>((resolve) => {
    resolver = resolve
  })

  return {
    promise,
    resolve: (value) => {
      if (settled) {
        return
      }
      settled = true
      const currentResolver = resolver
      if (currentResolver === undefined) {
        throw new Error('Deferred resolver is unavailable')
      }
      currentResolver(value)
    },
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  failureMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(failureMessage))
    }, timeoutMilliseconds)
  })

  try {
    return await Promise.race([operation, timeout])
  }
  finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

function readDatabaseErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  return Reflect.get(error, 'code')
}

async function expectLockUnavailable(
  client: Client,
  table: 'dictionary_items' | 'dictionary_types',
  id: string,
): Promise<void> {
  try {
    await client.query(
      `SELECT "id" FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE NOWAIT`,
      [id],
    )
  }
  catch (error) {
    // 只断言 PostgreSQL 稳定错误码，不把驱动 message、SQL 或连接信息带入输出。
    expect(readDatabaseErrorCode(error)).toBe('55P03')
    return
  }

  throw new Error(`Expected ${table} row lock to be unavailable`)
}

async function waitForBackendLock(
  monitor: Client,
  backendPid: number,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < LOCK_OBSERVATION_TIMEOUT_MS) {
    const activity = await monitor.query<BackendActivityRow>(`
      SELECT "wait_event_type" AS "waitEventType"
      FROM "pg_stat_activity"
      WHERE "pid" = $1
    `, [backendPid])
    if (activity.rows[0]?.waitEventType === 'Lock') {
      return
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }

  throw new Error('Dictionary Lookup did not enter a bounded lock wait')
}

function expectPrivateRequestId(response: {
  readonly headers: Record<string, string | string[] | undefined>
}): string {
  expect(response.headers['cache-control']).toBe('private, no-store')
  const requestId = response.headers['x-request-id']
  expect(requestId).toMatch(/^req_[0-9a-f-]{36}$/u)
  if (typeof requestId !== 'string') {
    throw new Error('Expected response X-Request-Id')
  }
  return requestId
}

describe('Dictionary Catalog API and Lookup with PostgreSQL', () => {
  jest.setTimeout(30_000)

  let application: INestApplication
  let database: IsolatedDictionaryDatabase
  let lookup: DictionaryLookupService
  let originalDatabaseUrl: string | undefined
  let passwords: PasswordProvider
  let prisma: PrismaService
  let seeded: SeededDictionaryCatalogs

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL
    database = await createIsolatedDictionaryDatabase()
    process.env.DATABASE_URL = database.databaseUrl
    const isolatedPrisma = new IsolatedDictionaryPrismaService(database)

    // ConfigModule 必须在 DATABASE_URL 切换后加载，避免任何连接落到 public。
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

    lookup = application.get(DictionaryLookupService)
    passwords = application.get(PasswordProvider)
    prisma = application.get(PrismaService)
    seeded = await seedDictionaryCatalogs(prisma)
  })

  afterAll(async () => {
    try {
      await application?.close()
    }
    finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL
      }
      else {
        process.env.DATABASE_URL = originalDatabaseUrl
      }
      // Trigger 禁止物理删除业务行，统一销毁本 spec 独占且格式受控的 schema。
      await database?.dispose()
    }
  })

  async function createOrdinaryBrowser(
    options: { readonly mustChangePassword?: boolean } = {},
  ): Promise<{
    readonly browser: ReturnType<typeof request.agent>
    readonly loginBody: AuthContextBody
  }> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `dictionary-catalog-e2e-${suffix}`
    const password = `Dict-${suffix.slice(0, 12)}`
    await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '字典目录 E2E 普通用户',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)

    return {
      browser,
      loginBody: readResponseBody<AuthContextBody>(loginResponse),
    }
  }

  it('requires Session but lets an ordinary user read the complete single Catalog without management permission', async () => {
    const anonymousEndpoints = [
      `/api/dictionary-catalog/${seeded.activeCode}`,
      `/api/dictionary-catalog?codes=${seeded.activeCode}`,
    ]
    for (const endpoint of anonymousEndpoints) {
      const response = await request(application.getHttpServer())
        .get(endpoint)
        .expect(401)
      const body = readResponseBody<ApiErrorBody>(response)
      expect(body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
      expect(body.requestId).toBe(expectPrivateRequestId(response))
    }

    const passwordChangeRequired = await createOrdinaryBrowser({
      mustChangePassword: true,
    })
    for (const endpoint of anonymousEndpoints) {
      const response = await passwordChangeRequired.browser
        .get(endpoint)
        .expect(403)
      const body = readResponseBody<ApiErrorBody>(response)
      expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED')
      expect(body.requestId).toBe(expectPrivateRequestId(response))
    }

    const { browser, loginBody } = await createOrdinaryBrowser()
    expect(loginBody.permissions).toEqual([])

    const missingResponse = await browser
      .get(`/api/dictionary-catalog/${seeded.firstMissingCode}`)
      .expect(404)
    const missingBody = readResponseBody<ApiErrorBody>(missingResponse)
    expect(missingBody).toMatchObject({
      code: 'DICTIONARY_TYPE_NOT_FOUND',
      message: '字典类型不存在',
    })
    expect(missingBody.requestId).toBe(
      expectPrivateRequestId(missingResponse),
    )

    // Catalog GET 不需要 CSRF，也不继承 dictionaries:read 管理权限。
    const normalizedPathCode = encodeURIComponent(
      ` ${seeded.activeCode.toUpperCase()} `,
    )
    const response = await browser
      .get(`/api/dictionary-catalog/${normalizedPathCode}`)
      .expect(200)
    expectPrivateRequestId(response)
    expect(readResponseBody<DictionaryCatalogBody>(response)).toEqual({
      code: seeded.activeCode,
      name: '订单状态',
      enabled: true,
      items: [
        {
          value: seeded.activeDisabledValue,
          label: '已归档',
          tone: DictionaryTone.DEFAULT,
          enabled: false,
          effectiveEnabled: false,
          sortOrder: 10,
        },
        {
          value: seeded.activeSecondValue,
          label: '加急处理',
          tone: DictionaryTone.INFO,
          enabled: true,
          effectiveEnabled: true,
          sortOrder: 10,
        },
        {
          value: seeded.activeEnabledValue,
          label: '可用',
          tone: DictionaryTone.SUCCESS,
          enabled: true,
          effectiveEnabled: true,
          sortOrder: 20,
        },
      ],
    })
    expect(Object.keys(readResponseBody<DictionaryCatalogBody>(response)))
      .toEqual(['code', 'name', 'enabled', 'items'])
    for (const item of readResponseBody<DictionaryCatalogBody>(response).items) {
      expect(Object.keys(item)).toEqual([
        'value',
        'label',
        'tone',
        'enabled',
        'effectiveEnabled',
        'sortOrder',
      ])
    }

    const forbiddenResponse = await browser
      .get('/api/dictionary-types')
      .expect(403)
    expect(readResponseBody<ApiErrorBody>(forbiddenResponse).code).toBe(
      'FORBIDDEN',
    )
    expectPrivateRequestId(forbiddenResponse)
  })

  it('keeps repeated batch codes in normalized request order and reports partial missing without dropping disabled states', async () => {
    const { browser } = await createOrdinaryBrowser()
    const requestedCodes = [
      ` ${seeded.disabledCode.toUpperCase()} `,
      seeded.firstMissingCode,
      seeded.activeCode,
      seeded.secondMissingCode.toUpperCase(),
    ]
    const query = requestedCodes
      .map(code => `codes=${encodeURIComponent(code)}`)
      .join('&')
    const response = await browser
      .get(`/api/dictionary-catalog?${query}`)
      .expect(200)
    expectPrivateRequestId(response)

    const body = readResponseBody<DictionaryCatalogBatchBody>(response)
    expect(body.dictionaries.map(dictionary => dictionary.code)).toEqual([
      seeded.disabledCode,
      seeded.activeCode,
    ])
    expect(body.missingCodes).toEqual([
      seeded.firstMissingCode,
      seeded.secondMissingCode,
    ])
    expect(body.dictionaries[0]).toEqual({
      code: seeded.disabledCode,
      name: '配送方式',
      enabled: false,
      items: [
        {
          value: seeded.disabledEnabledValue,
          label: '快递',
          tone: DictionaryTone.PRIMARY,
          enabled: true,
          effectiveEnabled: false,
          sortOrder: 5,
        },
        {
          value: seeded.disabledDisabledValue,
          label: '自提',
          tone: DictionaryTone.WARNING,
          enabled: false,
          effectiveEnabled: false,
          sortOrder: 10,
        },
      ],
    })

    const allMissingQuery = [
      seeded.secondMissingCode.toUpperCase(),
      ` ${seeded.firstMissingCode.toUpperCase()} `,
    ].map(code => `codes=${encodeURIComponent(code)}`).join('&')
    const allMissingResponse = await browser
      .get(`/api/dictionary-catalog?${allMissingQuery}`)
      .expect(200)
    expect(readResponseBody<DictionaryCatalogBatchBody>(
      allMissingResponse,
    )).toEqual({
      dictionaries: [],
      missingCodes: [
        seeded.secondMissingCode,
        seeded.firstMissingCode,
      ],
    })
    expectPrivateRequestId(allMissingResponse)

    // 规范化后重复的 repeated code 必须显式拒绝，不能静默去重。
    const duplicateResponse = await browser
      .get('/api/dictionary-catalog')
      .query({
        codes: [seeded.activeCode, ` ${seeded.activeCode.toUpperCase()} `],
      })
      .expect(422)
    expect(readResponseBody<ApiErrorBody>(duplicateResponse).code).toBe(
      'VALIDATION_FAILED',
    )
    expectPrivateRequestId(duplicateResponse)

    const boundaryToken = randomUUID().replaceAll('-', '').slice(0, 12)
    const invalidQueries = [
      '',
      `?codes=${encodeURIComponent(
        `${seeded.activeCode},${seeded.disabledCode}`,
      )}`,
      `?${Array.from(
        { length: 21 },
        (_unused, index) => `codes=e2e_${boundaryToken}.code_${index}`,
      ).join('&')}`,
    ]
    for (const invalidQuery of invalidQueries) {
      const boundaryResponse = await browser
        .get(`/api/dictionary-catalog${invalidQuery}`)
        .expect(422)
      expect(readResponseBody<ApiErrorBody>(boundaryResponse).code).toBe(
        'VALIDATION_FAILED',
      )
      expectPrivateRequestId(boundaryResponse)
    }
  })

  it('validates new values in the caller transaction and resolves disabled or unknown historical raw values exactly', async () => {
    await expect(prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      return lookup.requireEffectiveValue(transaction, {
        dictionaryCode: ` ${seeded.activeCode.toUpperCase()} `,
        value: ` ${seeded.activeEnabledValue.toLowerCase()} `,
      })
    })).resolves.toEqual({
      dictionaryCode: seeded.activeCode,
      value: seeded.activeEnabledValue,
      label: '可用',
      tone: DictionaryTone.SUCCESS,
    })

    const unavailableCases = [
      {
        dictionaryCode: seeded.firstMissingCode,
        value: seeded.activeEnabledValue,
        reason: 'DICTIONARY_TYPE_NOT_FOUND',
      },
      {
        dictionaryCode: seeded.disabledCode,
        value: seeded.disabledEnabledValue,
        reason: 'DICTIONARY_TYPE_DISABLED',
      },
      {
        dictionaryCode: seeded.activeCode,
        value: `MISSING_${randomUUID().replaceAll('-', '').toUpperCase()}`,
        reason: 'DICTIONARY_ITEM_NOT_FOUND',
      },
      {
        dictionaryCode: seeded.activeCode,
        value: seeded.activeDisabledValue,
        reason: 'DICTIONARY_ITEM_DISABLED',
      },
    ] as const
    for (const unavailable of unavailableCases) {
      const action = prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return lookup.requireEffectiveValue(transaction, unavailable)
      })
      await expect(action).rejects.toBeInstanceOf(
        DictionaryValueUnavailableError,
      )
      await expect(action).rejects.toMatchObject({
        code: 'DICTIONARY_VALUE_NOT_EFFECTIVE',
        reason: unavailable.reason,
      })
    }

    await expect(lookup.resolveStoredValue({
      dictionaryCode: ` ${seeded.activeCode.toUpperCase()} `,
      value: seeded.activeDisabledValue,
    })).resolves.toEqual({
      known: true,
      dictionaryCode: seeded.activeCode,
      value: seeded.activeDisabledValue,
      label: '已归档',
      tone: DictionaryTone.DEFAULT,
      typeEnabled: true,
      itemEnabled: false,
      effectiveEnabled: false,
    })
    await expect(lookup.resolveStoredValue({
      dictionaryCode: seeded.disabledCode,
      value: seeded.disabledEnabledValue,
    })).resolves.toEqual({
      known: true,
      dictionaryCode: seeded.disabledCode,
      value: seeded.disabledEnabledValue,
      label: '快递',
      tone: DictionaryTone.PRIMARY,
      typeEnabled: false,
      itemEnabled: true,
      effectiveEnabled: false,
    })

    for (const rawValue of [
      ` ${seeded.activeEnabledValue} `,
      seeded.activeEnabledValue.toLowerCase(),
      '',
    ]) {
      await expect(lookup.resolveStoredValue({
        dictionaryCode: seeded.activeCode,
        value: rawValue,
      })).resolves.toEqual({
        known: false,
        dictionaryCode: seeded.activeCode,
        value: rawValue,
      })
    }
  })

  it('waits on Type before Item and holds both FOR SHARE locks until the caller transaction ends', async () => {
    const holder = new Client({
      connectionString: database.databaseUrl,
      connectionTimeoutMillis: ASYNC_ASSERTION_TIMEOUT_MS,
      query_timeout: ASYNC_ASSERTION_TIMEOUT_MS,
    })
    const monitor = new Client({
      connectionString: database.databaseUrl,
      connectionTimeoutMillis: ASYNC_ASSERTION_TIMEOUT_MS,
      query_timeout: ASYNC_ASSERTION_TIMEOUT_MS,
    })
    const probe = new Client({
      connectionString: database.databaseUrl,
      connectionTimeoutMillis: ASYNC_ASSERTION_TIMEOUT_MS,
      query_timeout: ASYNC_ASSERTION_TIMEOUT_MS,
    })
    const lookupStarted = createDeferred<number>()
    const lookupAcquired = createDeferred<void>()
    const releaseLookup = createDeferred<void>()
    let holderTransactionOpen = false
    let lookupPromise: Promise<EffectiveDictionaryValue> | undefined

    try {
      // 连接建立也必须位于 finally 保护内，部分 connect 失败时不能泄漏已连接句柄。
      await holder.connect()
      await monitor.connect()
      await probe.connect()
      await holder.query('BEGIN')
      holderTransactionOpen = true
      await holder.query(
        'SELECT "id" FROM "dictionary_types" WHERE "id" = $1::uuid FOR UPDATE',
        [seeded.activeTypeId],
      )

      lookupPromise = prisma.$transaction(async (transaction) => {
        // 调用方必须先设置 timeout，再读取 backend pid 或进入 Lookup。
        await applyTransactionTimeouts(transaction)
        const pidRows = await transaction.$queryRaw<BackendPidRow[]>(
          Prisma.sql`SELECT pg_backend_pid()::integer AS "pid"`,
        )
        const backendPid = pidRows[0]?.pid
        if (backendPid === undefined) {
          throw new Error('Dictionary Lookup backend pid is unavailable')
        }
        lookupStarted.resolve(backendPid)
        const descriptor = await lookup.requireEffectiveValue(transaction, {
          dictionaryCode: seeded.activeCode,
          value: seeded.activeEnabledValue,
        })
        lookupAcquired.resolve(undefined)
        await releaseLookup.promise
        return descriptor
      })
      // 清理路径建立前就挂 rejection handler，避免断言提前失败产生 unhandled rejection。
      void lookupPromise.catch(() => undefined)

      const backendPid = await withTimeout(
        lookupStarted.promise,
        ASYNC_ASSERTION_TIMEOUT_MS,
        'Dictionary Lookup transaction did not start',
      )
      await waitForBackendLock(monitor, backendPid)

      /*
       * Lookup 正等待 Type FOR SHARE 时 Item 必须仍可独占锁定；若实现错误地先锁
       * Item，这个 NOWAIT 会得到 55P03，从而精确暴露反向锁序。
       */
      const itemBeforeType = await probe.query<{ readonly id: string }>(
        'SELECT "id"::text FROM "dictionary_items" WHERE "id" = $1::uuid FOR UPDATE NOWAIT',
        [seeded.activeEnabledItemId],
      )
      expect(itemBeforeType.rows).toEqual([{ id: seeded.activeEnabledItemId }])

      await holder.query('COMMIT')
      holderTransactionOpen = false
      await withTimeout(
        lookupAcquired.promise,
        ASYNC_ASSERTION_TIMEOUT_MS,
        'Dictionary Lookup did not acquire Type and Item locks',
      )

      // Lookup 返回后调用方事务仍未结束，Type 与 Item 的 FOR SHARE 都应阻塞写锁。
      await expectLockUnavailable(
        probe,
        'dictionary_types',
        seeded.activeTypeId,
      )
      await expectLockUnavailable(
        probe,
        'dictionary_items',
        seeded.activeEnabledItemId,
      )

      releaseLookup.resolve(undefined)
      await expect(withTimeout(
        lookupPromise,
        ASYNC_ASSERTION_TIMEOUT_MS,
        'Dictionary Lookup transaction did not finish',
      )).resolves.toEqual({
        dictionaryCode: seeded.activeCode,
        value: seeded.activeEnabledValue,
        label: '可用',
        tone: DictionaryTone.SUCCESS,
      })

      // 调用方 transaction commit 后两个行锁都必须立即释放。
      await expect(probe.query(
        'SELECT "id" FROM "dictionary_types" WHERE "id" = $1::uuid FOR UPDATE NOWAIT',
        [seeded.activeTypeId],
      )).resolves.toMatchObject({ rowCount: 1 })
      await expect(probe.query(
        'SELECT "id" FROM "dictionary_items" WHERE "id" = $1::uuid FOR UPDATE NOWAIT',
        [seeded.activeEnabledItemId],
      )).resolves.toMatchObject({ rowCount: 1 })
    }
    finally {
      if (holderTransactionOpen) {
        await holder.query('ROLLBACK').catch(() => undefined)
      }
      releaseLookup.resolve(undefined)
      await lookupPromise?.catch(() => undefined)
      await Promise.allSettled([
        holder.end(),
        monitor.end(),
        probe.end(),
      ])
    }
  })
})

async function seedDictionaryCatalogs(
  prisma: PrismaService,
): Promise<SeededDictionaryCatalogs> {
  const token = randomUUID().replaceAll('-', '').slice(0, 12)
  const upperToken = token.toUpperCase()
  const activeCode = `e2e_${token}.order_status`
  const disabledCode = `e2e_${token}.shipping_method`
  const activeEnabledValue = `AVAILABLE_${upperToken}`
  const activeSecondValue = `EXPRESS_${upperToken}`
  const activeDisabledValue = `ARCHIVED_${upperToken}`
  const disabledEnabledValue = `COURIER_${upperToken}`
  const disabledDisabledValue = `PICKUP_${upperToken}`

  const activeType = await prisma.dictionaryType.create({
    data: {
      code: activeCode,
      name: '订单状态',
      description: 'Catalog E2E active Type',
      sortOrder: 20,
    },
  })
  await prisma.dictionaryItem.create({
    data: {
      dictionaryTypeId: activeType.id,
      value: activeDisabledValue,
      label: '已归档',
      tone: DictionaryTone.DEFAULT,
      enabled: false,
      sortOrder: 10,
    },
  })
  await prisma.dictionaryItem.create({
    data: {
      dictionaryTypeId: activeType.id,
      value: activeSecondValue,
      label: '加急处理',
      tone: DictionaryTone.INFO,
      enabled: true,
      sortOrder: 10,
    },
  })
  const activeEnabledItem = await prisma.dictionaryItem.create({
    data: {
      dictionaryTypeId: activeType.id,
      value: activeEnabledValue,
      label: '可用',
      tone: DictionaryTone.SUCCESS,
      enabled: true,
      sortOrder: 20,
    },
  })
  await prisma.dictionaryType.update({
    where: { id: activeType.id },
    data: { enabled: true },
  })

  const disabledType = await prisma.dictionaryType.create({
    data: {
      code: disabledCode,
      name: '配送方式',
      description: 'Catalog E2E disabled Type',
      sortOrder: 30,
    },
  })
  await prisma.dictionaryItem.create({
    data: {
      dictionaryTypeId: disabledType.id,
      value: disabledEnabledValue,
      label: '快递',
      tone: DictionaryTone.PRIMARY,
      enabled: true,
      sortOrder: 5,
    },
  })
  await prisma.dictionaryItem.create({
    data: {
      dictionaryTypeId: disabledType.id,
      value: disabledDisabledValue,
      label: '自提',
      tone: DictionaryTone.WARNING,
      enabled: false,
      sortOrder: 10,
    },
  })

  return {
    activeCode,
    activeTypeId: activeType.id,
    activeEnabledItemId: activeEnabledItem.id,
    activeEnabledValue,
    activeSecondValue,
    activeDisabledValue,
    disabledCode,
    disabledEnabledValue,
    disabledDisabledValue,
    firstMissingCode: `e2e_${token}.payment_mode`,
    secondMissingCode: `e2e_${token}.fulfillment_mode`,
  }
}
