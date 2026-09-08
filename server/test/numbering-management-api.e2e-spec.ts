import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { NumberingGeneratorService } from '../src/modules/numbering/numbering-generator.service'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from '../src/modules/numbering/numbering.errors'
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
  purpose: 'BUSINESS' | 'SHIPPING_MARK'
  id: string
  ruleCode: string
  name: string
  status: 'DISABLED' | 'DRAFT' | 'ENABLED'
  version: number
  activeVersion: null | {
    id: string
    revision: number
    status: 'ACTIVE'
  }
  draftVersion: null | {
    id: string
    revision: number
    status: 'DRAFT'
  }
  statistics: {
    capacity: string
    usedCount: string
    lifetimeUsedCount: string
    nextSequenceValue: string | null
    periodKey: string
  }
}

interface NumberingPreviewBody {
  capacity: string
  usedCount: string
  remainingCount: string
  nextSequenceValue: string | null
  nextNumberPreview: string | null
  samples: string[]
}

interface NumberingIssuancePageBody {
  items: Array<{
    id: string
    generatedNumber: string
    ruleRevision: number
    sequenceValue: string | null
    consumerCode: string
  }>
  page: number
  pageSize: number
  total: number
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

describe('Numbering management API and internal generator with PostgreSQL', () => {
  jest.setTimeout(90_000)

  let application: INestApplication
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

    // AppModule 必须在 DATABASE_URL 切换后加载，ConfigModule 才会把所有连接
    // 固定到本 spec 的隔离 schema，而不是共享开发 schema。
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

  async function createAdministrator() {
    const suffix = randomUUID()
    const username = `numbering-api-e2e-${suffix}`
    const password = `Num-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '编号管理 E2E 用户',
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
    return { password, user }
  }

  it('completes create, preview, publish, enable, generate, disable and clone without exposing generate HTTP', async () => {
    const administrator = await createAdministrator()
    const browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({
        username: administrator.user.username,
        password: administrator.password,
      })
      .expect(200)

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    const ruleCode = `ORDER_${suffix}`
    const config = {
      resetPolicy: 'DAILY',
      segments: [
        { type: 'FIXED', value: 'ORD' },
        { type: 'SEPARATOR', value: '-' },
        { type: 'DATE', format: 'YYYYMMDD' },
        { type: 'SEPARATOR', value: '-' },
        { type: 'SEQUENCE', width: 3, startValue: '1', step: '1' },
      ],
    }

    const createResponse = await browser
      .post('/api/numbering-rules')
      .set(CSRF_HEADERS)
      .send({
        ruleCode: ` ${ruleCode.toLowerCase()} `,
        purpose: 'BUSINESS',
        name: '  订单编号  ',
        description: '  E2E 生命周期  ',
        ...config,
      })
      .expect(201)
    const created = readResponseBody<NumberingRuleDetailBody>(createResponse)
    expect(created).toMatchObject({
      ruleCode,
      name: '订单编号',
      status: 'DRAFT',
      version: 1,
      activeVersion: null,
      draftVersion: { revision: 1, status: 'DRAFT' },
      statistics: {
        capacity: '999',
        usedCount: '0',
        lifetimeUsedCount: '0',
        nextSequenceValue: '1',
      },
    })

    const previewResponse = await browser
      .post('/api/numbering-rules/preview')
      .set(CSRF_HEADERS)
      .send({ ruleId: created.id, ...config })
      .expect(200)
    const preview = readResponseBody<NumberingPreviewBody>(previewResponse)
    expect(preview).toMatchObject({
      capacity: '999',
      usedCount: '0',
      remainingCount: '999',
      nextSequenceValue: '1',
    })
    expect(preview.nextNumberPreview).toMatch(/^ORD-\d{8}-001$/u)
    expect(preview.samples).toHaveLength(5)

    const publishedResponse = await browser
      .post(`/api/numbering-rules/${created.id}/publish`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1, draftRevision: 1 })
      .expect(200)
    const published = readResponseBody<NumberingRuleDetailBody>(
      publishedResponse,
    )
    expect(published).toMatchObject({
      status: 'DRAFT',
      version: 2,
      activeVersion: { revision: 1, status: 'ACTIVE' },
      draftVersion: null,
    })

    const enabledResponse = await browser
      .post(`/api/numbering-rules/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
    const enabled = readResponseBody<NumberingRuleDetailBody>(enabledResponse)
    expect(enabled).toMatchObject({ status: 'ENABLED', version: 3 })

    const idempotencyKey = `order-${randomUUID()}`
    const issuance = await generator.generate({
      ruleCode,
      consumerCode: 'ORDER.E2E',
      idempotencyKey,
    })
    expect(issuance).toMatchObject({
      ruleCode,
      ruleRevision: 1,
      idempotentReplay: false,
    })
    expect(issuance.number).toMatch(/^ORD-\d{8}-001$/u)

    const detailResponse = await browser
      .get(`/api/numbering-rules/${created.id}`)
      .expect(200)
    const detail = readResponseBody<NumberingRuleDetailBody>(detailResponse)
    expect(detail.statistics).toMatchObject({
      usedCount: '1',
      lifetimeUsedCount: '1',
      nextSequenceValue: '2',
    })

    const issuancePageResponse = await browser
      .get(`/api/numbering-rules/${created.id}/issuances`)
      .query({ generatedNumber: issuance.number })
      .expect(200)
    const issuancePage = readResponseBody<NumberingIssuancePageBody>(
      issuancePageResponse,
    )
    expect(issuancePage).toMatchObject({ page: 1, pageSize: 20, total: 1 })
    expect(issuancePage.items).toEqual([
      expect.objectContaining({
        generatedNumber: issuance.number,
        ruleRevision: 1,
        sequenceValue: '1',
        consumerCode: 'ORDER.E2E',
      }),
    ])

    const disabledResponse = await browser
      .post(`/api/numbering-rules/${created.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    const disabled = readResponseBody<NumberingRuleDetailBody>(disabledResponse)
    expect(disabled).toMatchObject({ status: 'DISABLED', version: 4 })

    // 已提交 ledger 的重放优先于可用性判断；停用后新请求必须被拒绝。
    await expect(generator.generate({
      ruleCode,
      consumerCode: 'ORDER.E2E',
      idempotencyKey,
    })).resolves.toMatchObject({
      number: issuance.number,
      idempotentReplay: true,
    })
    await expect(generator.generate({
      ruleCode,
      consumerCode: 'ORDER.E2E',
      idempotencyKey: `new-${randomUUID()}`,
    })).rejects.toMatchObject<Partial<NumberingGenerationError>>({
      code: NUMBERING_ERROR_CODES.RULE_UNAVAILABLE,
      retryable: false,
    })

    const cloneResponse = await browser
      .post(`/api/numbering-rules/${created.id}/clone`)
      .set(CSRF_HEADERS)
      .send({
        expectedVersion: 4,
        ruleCode: `CLONE_${suffix}`,
        name: '订单编号副本',
      })
      .expect(201)
    const cloned = readResponseBody<NumberingRuleDetailBody>(cloneResponse)
    expect(cloned).toMatchObject({
      ruleCode: `CLONE_${suffix}`,
      status: 'DRAFT',
      version: 1,
      activeVersion: null,
      draftVersion: { revision: 1, status: 'DRAFT' },
    })

    await browser
      .post('/api/numbering-rules/generate')
      .set(CSRF_HEADERS)
      .send({ ruleCode, consumerCode: 'ORDER.E2E', idempotencyKey: 'x' })
      .expect(404)
    await browser
      .post(`/api/numbering-rules/${created.id}/generate`)
      .set(CSRF_HEADERS)
      .send({ consumerCode: 'ORDER.E2E', idempotencyKey: 'x' })
      .expect(404)
    await browser
      .post('/api/numbering/generate')
      .set(CSRF_HEADERS)
      .send({ ruleCode, consumerCode: 'ORDER.E2E', idempotencyKey: 'x' })
      .expect(404)

    const storedIssuance = await prisma.numberingIssuance.findFirstOrThrow({
      where: { ruleId: created.id },
    })
    await expect(prisma.numberingIssuance.delete({
      where: { id: storedIssuance.id },
    })).rejects.toBeDefined()
    await expect(prisma.numberingIssuance.count({
      where: { id: storedIssuance.id },
    })).resolves.toBe(1)

    const auditEvents = await prisma.auditEvent.findMany({
      where: { targetId: created.id },
      orderBy: { occurredAt: 'asc' },
    })
    expect(auditEvents.map(event => event.eventType)).toEqual([
      'NUMBERING_RULE_CREATED',
      'NUMBERING_RULE_VERSION_PUBLISHED',
      'NUMBERING_RULE_ENABLED',
      'NUMBERING_RULE_DISABLED',
    ])
    const serializedAudit = JSON.stringify(auditEvents)
    expect(serializedAudit).not.toContain('idempotencyKey')
    expect(serializedAudit).not.toContain('idempotencyKeyHash')
    expect(serializedAudit).not.toContain('requestFingerprintHash')
  })

  it('enforces purposes on create, inherits clone purpose, and counts the keyword/status scope across pages', async () => {
    const administrator = await createAdministrator()
    const browser = request.agent(application.getHttpServer())
    await browser.post('/api/auth/login').set(CSRF_HEADERS)
      .send({ username: administrator.user.username, password: administrator.password }).expect(200)
    const keyword = `PURPOSE_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`
    const input = { ruleCode: keyword, name: keyword, resetPolicy: 'NEVER', segments: [{ type: 'SEQUENCE', width: 4, startValue: '1', step: '1' }] }
    for (const purpose of [undefined, null, 'ALL', 'INVALID']) {
      await browser.post('/api/numbering-rules').set(CSRF_HEADERS).send({ ...input, purpose }).expect(422)
    }
    const created = readResponseBody<NumberingRuleDetailBody>(await browser.post('/api/numbering-rules')
      .set(CSRF_HEADERS).send({ ...input, purpose: 'SHIPPING_MARK' }).expect(201))
    expect(created.purpose).toBe('SHIPPING_MARK')
    await browser.patch(`/api/numbering-rules/${created.id}`).set(CSRF_HEADERS)
      .send({ expectedVersion: 1, name: keyword, purpose: 'BUSINESS' }).expect(422)
    await browser.post(`/api/numbering-rules/${created.id}/clone`).set(CSRF_HEADERS)
      .send({ expectedVersion: 1, ruleCode: `${keyword}_COPY`, name: keyword, purpose: 'BUSINESS' }).expect(422)
    const copied = readResponseBody<NumberingRuleDetailBody>(await browser.post(`/api/numbering-rules/${created.id}/clone`)
      .set(CSRF_HEADERS).send({ expectedVersion: 1, ruleCode: `${keyword}_COPY`, name: keyword }).expect(201))
    expect(copied.purpose).toBe('SHIPPING_MARK')
    await browser.post('/api/numbering-rules').set(CSRF_HEADERS)
      .send({ ...input, ruleCode: `${keyword}_BUSINESS`, purpose: 'BUSINESS' }).expect(201)
    for (const [purpose, total] of [[undefined, 3], ['BUSINESS', 1], ['SHIPPING_MARK', 2]] as const) {
      const response = await browser.get('/api/numbering-rules').query({ keyword, status: 'DRAFT', pageSize: 1, page: 2, ...(purpose ? { purpose } : {}) }).expect(200)
      expect(response.body).toMatchObject({ total, purposeCounts: [{ value: 'ALL', count: 3 }, { value: 'BUSINESS', count: 1 }, { value: 'SHIPPING_MARK', count: 2 }] })
    }
    await browser.get('/api/numbering-rules').query({ purpose: 'ALL' }).expect(422)
    await browser.post(`/api/numbering-rules/${created.id}/publish`).set(CSRF_HEADERS).send({ expectedVersion: 1, draftRevision: 1 }).expect(200)
    await browser.post(`/api/numbering-rules/${created.id}/enable`).set(CSRF_HEADERS).send({ expectedVersion: 2 }).expect(200)
    const idempotencyKey = randomUUID()
    const issued = await generator.generate({ ruleCode: keyword, consumerCode: 'PURPOSE.E2E', idempotencyKey })
    const replay = await generator.generate({ ruleCode: keyword, consumerCode: 'PURPOSE.E2E', idempotencyKey })
    expect(replay.number).toBe(issued.number)
    expect(issued.number).toBe('0001')
  })
})
