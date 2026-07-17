import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'supertest'
import request from 'supertest'

import { REQUEST_ID_HEADER } from '../src/app.constants'
import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

const databaseUrl = requireDatabaseUrl()

const databasePassword = new URL(databaseUrl).password

if (!databasePassword) {
  throw new Error('A database password is required for E2E tests')
}

const decodedDatabasePassword = decodeURIComponent(databasePassword)

const FAILURE_CANARY = 'health-e2e-sensitive-canary'
const CLIENT_REQUEST_ID = 'req_00000000-0000-4000-8000-000000000000'
const REQUEST_ID_PATTERN =
  /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FAILURE_MESSAGE =
  `postgresql://fake-user:fake-health-password@localhost/test ` +
  `DATABASE_URL SELECT 1 stack ${FAILURE_CANARY}`
const URL_SCHEME_PATTERN = /[a-z][a-z\d+.-]*:\/\//i

function requireApplication(
  application: INestApplication | undefined,
): INestApplication {
  if (!application) {
    throw new Error('E2E application is not initialized')
  }

  return application
}

function expectServerGeneratedRequestId(response: Response): void {
  const requestId = response.headers[REQUEST_ID_HEADER.toLowerCase()]

  expect(typeof requestId).toBe('string')
  expect(requestId).toMatch(REQUEST_ID_PATTERN)
  expect(requestId).not.toBe(CLIENT_REQUEST_ID)
}

function expectRealSecretsAreAbsent(body: unknown): void {
  const serializedBody = JSON.stringify(body)
  const normalizedBody = serializedBody.toLowerCase()

  // 真实 URL 与密码绝不作为 matcher 参数，失败输出只能展示布尔值。
  expect(serializedBody.includes(databaseUrl)).toBe(false)
  expect(serializedBody.includes(databasePassword)).toBe(false)
  expect(serializedBody.includes(decodedDatabasePassword)).toBe(false)
  expect(normalizedBody.includes('postgresql://')).toBe(false)
  expect(normalizedBody.includes('postgres://')).toBe(false)
  expect(URL_SCHEME_PATTERN.test(serializedBody)).toBe(false)
}

function expectFailureDetailsAreAbsent(body: unknown): void {
  const normalizedBody = JSON.stringify(body).toLowerCase()

  expect(normalizedBody.includes(FAILURE_CANARY)).toBe(false)
  expect(normalizedBody.includes('postgresql://')).toBe(false)
  expect(normalizedBody.includes('postgres://')).toBe(false)
  expect(URL_SCHEME_PATTERN.test(normalizedBody)).toBe(false)
  expect(normalizedBody.includes('database_url')).toBe(false)
  expect(normalizedBody.includes('password')).toBe(false)
  expect(normalizedBody.includes('select 1')).toBe(false)
  expect(normalizedBody.includes('stack')).toBe(false)
  expect(normalizedBody.includes('url')).toBe(false)
}

describe('database health route with a real PostgreSQL connection', () => {
  let application: INestApplication | undefined

  beforeAll(async () => {
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()

      application = moduleRef.createNestApplication()
      configureApplication(application)
      await application.init()
    } catch (error) {
      await application?.close().catch(() => undefined)
      application = undefined
      throw error
    }
  })

  afterAll(async () => {
    await application?.close()
    application = undefined
  })

  it('returns the complete Terminus success body without a global envelope or secrets', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .get('/api/health')
      .set(REQUEST_ID_HEADER, CLIENT_REQUEST_ID)
      .expect(200)

    expectServerGeneratedRequestId(response)
    expectRealSecretsAreAbsent(response.body)
    expect(response.body).toEqual({
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    })
    expect(response.headers['cache-control']).toBe(
      'no-cache, no-store, must-revalidate',
    )
    expect(response.body).not.toHaveProperty('data')
  })

  it('keeps the health route behind the global api prefix', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .get('/health')
      .set(REQUEST_ID_HEADER, CLIENT_REQUEST_ID)
      .expect(404)

    expectServerGeneratedRequestId(response)
  })
})

describe('database health route with a failed database probe', () => {
  let application: INestApplication | undefined

  beforeAll(async () => {
    const failingPrisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error(FAILURE_MESSAGE)),
    }

    try {
      // override 必须发生在 compile 前，确保失败 E2E 不创建或连接真实 PrismaService。
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(failingPrisma)
        .compile()

      application = moduleRef.createNestApplication()
      configureApplication(application)
      await application.init()
    } catch (error) {
      await application?.close().catch(() => undefined)
      application = undefined
      throw error
    }
  })

  afterAll(async () => {
    await application?.close()
    application = undefined
  })

  it('returns only the complete sanitized Terminus failure body', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .get('/api/health')
      .set(REQUEST_ID_HEADER, CLIENT_REQUEST_ID)
      .expect(503)

    expectServerGeneratedRequestId(response)
    expectRealSecretsAreAbsent(response.body)
    expectFailureDetailsAreAbsent(response.body)
    expect(response.body).toEqual({
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    })
    expect(response.body).not.toHaveProperty('data')
  })
})
