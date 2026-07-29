import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import {
  AuditEventType,
  UserStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'currency-api-e2e-'

interface ApiErrorBody {
  code: string
}

interface CurrencyBody {
  id: string
  code: string
  name: string
  englishName: string | null
  symbol: string | null
  minorUnit: number
  enabled: boolean
  isBase: boolean
  sortOrder: number
  exchangeRateConfigured: boolean
  version: number
}

interface CurrencyCatalogBody {
  id: string
  code: string
  enabled: boolean
  isBase: boolean
  minorUnit: number
}

interface ExchangeRateBody {
  id: string
  currencyId: string
  foreignUnitsPerCny: string
  version: number
}

interface ExchangeRatePageBody {
  items: Array<{
    currency: CurrencyCatalogBody
    currentRate: ExchangeRateBody | null
  }>
  page: number
  pageSize: number
  total: number
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function randomCurrencyCode(): string {
  const hex = randomUUID().replaceAll('-', '').slice(0, 3)
  return [...hex]
    .map(character =>
      String.fromCharCode(
        'A'.charCodeAt(0) + Number.parseInt(character, 16),
      ),
    )
    .join('')
}

describe('Currency management API with PostgreSQL', () => {
  jest.setTimeout(30_000)

  let application: INestApplication
  let audit: AuditService
  let passwordProvider: PasswordProvider
  let prisma: PrismaService
  const createdCurrencyIds = new Set<string>()
  const createdRateIds = new Set<string>()
  const createdUserIds = new Set<string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    audit = application.get(AuditService)
    passwordProvider = application.get(PasswordProvider)
    prisma = application.get(PrismaService)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    const currencyIds = [...createdCurrencyIds]
    const rateIds = [...createdRateIds]
    const userIds = [...createdUserIds]

    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          ...(currencyIds.length > 0
            ? [{ targetId: { in: currencyIds } }]
            : []),
          ...(rateIds.length > 0
            ? [{ targetId: { in: rateIds } }]
            : []),
          ...(userIds.length > 0
            ? [{ actorUserId: { in: userIds } }]
            : []),
        ],
      },
    })

    if (currencyIds.length > 0) {
      // 删除测试数据前先恢复合法停用状态；正式产品不提供物理删除 API。
      await prisma.currency.updateMany({
        where: {
          id: { in: currencyIds },
          code: { not: 'CNY' },
        },
        data: { enabled: false },
      })
      await prisma.exchangeRate.deleteMany({
        where: { currencyId: { in: currencyIds } },
      })
      await prisma.currency.deleteMany({
        where: {
          id: { in: currencyIds },
          code: { not: 'CNY' },
        },
      })
    }

    if (userIds.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          status: UserStatus.ACTIVE,
          createdByUserId: null,
          disabledAt: null,
          disabledByUserId: null,
        },
      })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }

    createdCurrencyIds.clear()
    createdRateIds.clear()
    createdUserIds.clear()
  })

  afterAll(async () => {
    await application.close()
  })

  async function createUser(options: { systemAdmin?: boolean } = {}) {
    const username = `${USERNAME_PREFIX}${randomUUID()}`
    const password = `Currency-${randomUUID().slice(0, 8)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username.toLowerCase(),
        displayName: '货币 E2E 用户',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (options.systemAdmin === true) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'system_admin' },
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      })
    }
    return { password, user }
  }

  async function login(
    browser: ReturnType<typeof request.agent>,
    username: string,
    password: string,
  ): Promise<void> {
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
  }

  it('keeps Catalog session-only and completes the guarded current-rate lifecycle', async () => {
    const ordinary = await createUser()
    const ordinaryBrowser = request.agent(application.getHttpServer())
    await login(ordinaryBrowser, ordinary.user.username, ordinary.password)

    const ordinaryCatalog = await ordinaryBrowser
      .get('/api/currency-catalog')
      .expect(200)
    const initialCatalog = readResponseBody<CurrencyCatalogBody[]>(
      ordinaryCatalog,
    )
    expect(initialCatalog.map(currency => currency.code)).toEqual([
      'CNY',
      'TWD',
      'MYR',
      'USD',
    ])
    expect(initialCatalog.find(currency => currency.code === 'CNY'))
      .toMatchObject({
        enabled: true,
        isBase: true,
        minorUnit: 2,
      })
    await ordinaryBrowser.get('/api/currencies').expect(403)

    const administrator = await createUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )
    const code = randomCurrencyCode()

    const createdResponse = await adminBrowser
      .post('/api/currencies')
      .set(CSRF_HEADERS)
      .send({
        code,
        name: '端到端测试币',
        englishName: 'End-to-end Currency',
        symbol: 'E2E',
        minorUnit: 4,
        sortOrder: 900,
      })
      .expect(201)
    const created = readResponseBody<CurrencyBody>(createdResponse)
    createdCurrencyIds.add(created.id)
    expect(created).toMatchObject({
      code,
      enabled: false,
      exchangeRateConfigured: false,
      minorUnit: 4,
      version: 1,
    })

    await adminBrowser
      .post(`/api/currencies/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'CURRENCY_EXCHANGE_RATE_REQUIRED',
        )
      })

    await adminBrowser
      .post('/api/exchange-rates')
      .set(CSRF_HEADERS)
      .send({
        currencyId: created.id,
        foreignUnitsPerCny: '4.800000000000',
      })
      .expect(201)
      .expect((response) => {
        const rate = readResponseBody<ExchangeRateBody>(response)
        createdRateIds.add(rate.id)
        expect(rate).toMatchObject({
          currencyId: created.id,
          foreignUnitsPerCny: '4.8',
          version: 1,
        })
      })

    await adminBrowser
      .post('/api/exchange-rates')
      .set(CSRF_HEADERS)
      .send({
        currencyId: '00000000-0000-4000-8000-000000001001',
        foreignUnitsPerCny: '1',
      })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
        )
      })

    const enabledResponse = await adminBrowser
      .post(`/api/currencies/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    expect(readResponseBody<CurrencyBody>(enabledResponse)).toMatchObject({
      enabled: true,
      exchangeRateConfigured: true,
      version: 2,
    })

    // 同一 expectedVersion 并发更新时只允许一个提交，另一方必须显式刷新。
    const currencyUpdates = await Promise.all([
      adminBrowser
        .patch(`/api/currencies/${created.id}`)
        .set(CSRF_HEADERS)
        .send({ name: '并发名称 A', expectedVersion: 2 }),
      adminBrowser
        .patch(`/api/currencies/${created.id}`)
        .set(CSRF_HEADERS)
        .send({ name: '并发名称 B', expectedVersion: 2 }),
    ])
    expect(currencyUpdates.map(response => response.status).sort())
      .toEqual([200, 409])
    expect(
      readResponseBody<ApiErrorBody>(
        currencyUpdates.find(response => response.status === 409)
          ?? { body: {} },
      ).code,
    ).toBe('CURRENCY_STATE_CHANGED')

    const rateId = [...createdRateIds][0]
    if (rateId === undefined) {
      throw new Error('Expected the E2E rate id')
    }
    const rateUpdates = await Promise.all([
      adminBrowser
        .patch(`/api/exchange-rates/${rateId}`)
        .set(CSRF_HEADERS)
        .send({
          foreignUnitsPerCny: '5.250000000000',
          expectedVersion: 1,
        }),
      adminBrowser
        .patch(`/api/exchange-rates/${rateId}`)
        .set(CSRF_HEADERS)
        .send({
          foreignUnitsPerCny: '5.5',
          expectedVersion: 1,
        }),
    ])
    expect(rateUpdates.map(response => response.status).sort())
      .toEqual([200, 409])
    const persistedRate = readResponseBody<ExchangeRateBody>(
      await adminBrowser
        .get(`/api/exchange-rates/${rateId}`)
        .expect(200),
    )
    expect(['5.25', '5.5']).toContain(persistedRate.foreignUnitsPerCny)
    expect(persistedRate.version).toBe(2)

    const catalogAfterEnable = readResponseBody<CurrencyCatalogBody[]>(
      await ordinaryBrowser.get('/api/currency-catalog').expect(200),
    )
    expect(catalogAfterEnable.find(currency => currency.code === code))
      .toMatchObject({
        enabled: true,
        minorUnit: 4,
      })

    const disabledResponse = await adminBrowser
      .post(`/api/currencies/${created.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    expect(readResponseBody<CurrencyBody>(disabledResponse)).toMatchObject({
      enabled: false,
      exchangeRateConfigured: true,
      version: 4,
    })

    const ratePage = readResponseBody<ExchangeRatePageBody>(
      await adminBrowser
        .get('/api/exchange-rates')
        .query({ query: code })
        .expect(200),
    )
    expect(ratePage).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [
        {
          currency: { code, enabled: false },
          currentRate: { id: rateId, version: 2 },
        },
      ],
    })

    const eventTypes = await prisma.auditEvent.findMany({
      where: {
        targetId: { in: [created.id, rateId] },
      },
      select: { eventType: true },
      orderBy: { occurredAt: 'asc' },
    })
    expect(eventTypes.map(event => event.eventType)).toEqual([
      AuditEventType.CURRENCY_CREATED,
      AuditEventType.EXCHANGE_RATE_CREATED,
      AuditEventType.CURRENCY_ENABLED,
      AuditEventType.CURRENCY_UPDATED,
      AuditEventType.EXCHANGE_RATE_UPDATED,
      AuditEventType.CURRENCY_DISABLED,
    ])
  })

  it('rolls back Currency when Audit fails in the same transaction', async () => {
    const administrator = await createUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )
    const code = randomCurrencyCode()
    jest.spyOn(audit, 'record').mockRejectedValueOnce(
      new Error('must-not-leak audit failure'),
    )

    await adminBrowser
      .post('/api/currencies')
      .set(CSRF_HEADERS)
      .send({
        code,
        name: '不得提交的货币',
        minorUnit: 2,
        sortOrder: 999,
      })
      .expect(500)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'INTERNAL_ERROR',
        )
      })

    await expect(
      prisma.currency.count({ where: { code } }),
    ).resolves.toBe(0)
  })
})
