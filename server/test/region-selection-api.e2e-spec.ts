import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { UserStatus } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { RegionQueryService } from '../src/modules/regions/region-query.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'region-selection-api-e2e-'

interface ApiErrorBody {
  code: string
  message: string
  requestId: string
  fieldErrors?: Record<string, string[]>
}

interface AuthContextBody {
  permissions: string[]
  user: {
    id: string
    mustChangePassword: boolean
  }
}

interface RegionNodeBody {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  level: 'CITY' | 'COUNTRY_REGION' | 'PROVINCE_STATE'
  enabled: boolean
  effectiveEnabled: boolean
  hasChildren: boolean
}

interface RegionPathBody {
  cityId: string
  path: [RegionNodeBody, RegionNodeBody, RegionNodeBody]
}

interface RegionSearchBody {
  items: Array<RegionPathBody>
  limit: number
  hasMore: boolean
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

describe('Region selection API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let regions: RegionQueryService
  let serviceSpy: jest.SpyInstance | undefined
  const createdUserIds = new Set<string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    // 套件统一创建并在 afterAll 关闭监听器，避免 supertest 为每次请求临时 listen/close。
    await application.listen(0, '127.0.0.1')
    prisma = application.get(PrismaService)
    passwords = application.get(PasswordProvider)
    regions = application.get(RegionQueryService)
  })

  afterEach(async () => {
    serviceSpy?.mockRestore()
    serviceSpy = undefined
    await prisma.region.updateMany({
      where: { code: { in: ['TW-TAIWAN', 'TW-64000'] } },
      data: { enabled: true },
    })
    await prisma.authRateLimit.deleteMany()

    const prefixedUsers = await prisma.user.findMany({
      where: { usernameNormalized: { startsWith: USERNAME_PREFIX } },
      select: { id: true },
    })
    prefixedUsers.forEach(({ id }) => createdUserIds.add(id))
    const userIds = [...createdUserIds]
    if (userIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: userIds } },
      })
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
    createdUserIds.clear()
  })

  afterAll(async () => {
    await application.close()
  })

  it('keeps one suite-owned HTTP listener across consecutive requests', async () => {
    const server = application.getHttpServer() as Server
    const address = server.address()
    expect(address).not.toBeNull()
    await request(server).get('/api/health').expect(200)
    await request(server).get('/api/health').expect(200)
    expect(server.listening).toBe(true)
    expect(server.address()).toEqual(address)
  })

  async function createUser(
    options: { mustChangePassword?: boolean } = {},
  ) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = `Region-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: 'Region Selection API E2E',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)
    return { password, user }
  }

  async function login(
    browser: ReturnType<typeof request.agent>,
    username: string,
    password: string,
  ) {
    return browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
  }

  async function createLoggedInBrowser(
    options: { mustChangePassword?: boolean } = {},
  ) {
    const account = await createUser(options)
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await login(
      browser,
      account.user.username,
      account.password,
    )
    return { account, browser, loginResponse }
  }

  async function requireRegion(code: string) {
    return prisma.region.findUniqueOrThrow({ where: { code } })
  }

  it('rejects anonymous and forced-password Sessions on all three endpoints', async () => {
    const taiwan = await requireRegion('TW-TAIWAN')
    const kaohsiung = await requireRegion('TW-64000')
    const endpoints = [
      '/api/region-selection/options',
      `/api/region-selection/options?parentId=${taiwan.id}`,
      '/api/region-selection/search?query=%E9%AB%98%E9%9B%84',
      `/api/region-selection/paths/${kaohsiung.id}`,
    ]

    for (const endpoint of endpoints) {
      await request(application.getHttpServer())
        .get(endpoint)
        .expect(401)
        .expect((response) => {
          expect(response.headers['cache-control']).toBe(
            'private, no-store',
          )
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'AUTHENTICATION_REQUIRED',
          )
        })
    }

    const { browser, loginResponse } = await createLoggedInBrowser({
      mustChangePassword: true,
    })
    expect(
      readResponseBody<AuthContextBody>(loginResponse).user
        .mustChangePassword,
    ).toBe(true)

    for (const endpoint of endpoints) {
      await browser
        .get(endpoint)
        .expect(403)
        .expect((response) => {
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'PASSWORD_CHANGE_REQUIRED',
          )
        })
    }
  })

  it('lets a normal user without regions permissions load roots, lazy options, search and the Taiwan path', async () => {
    const { browser, loginResponse } = await createLoggedInBrowser()
    expect(
      readResponseBody<AuthContextBody>(loginResponse).permissions,
    ).toEqual([])

    const rootsResponse = await browser
      .get('/api/region-selection/options')
      .expect(200)
    expect(rootsResponse.headers['cache-control']).toBe(
      'private, no-store',
    )
    const roots = readResponseBody<RegionNodeBody[]>(rootsResponse)
    expect(roots.map(({ code }) => code)).toEqual(['CN', 'TW', 'MY'])
    expect(roots.every(({ effectiveEnabled }) => effectiveEnabled)).toBe(
      true,
    )

    const taiwanRoot = roots.find(({ code }) => code === 'TW')
    if (!taiwanRoot) {
      throw new Error('Missing TW root')
    }
    const provinceResponse = await browser
      .get('/api/region-selection/options')
      .query({ parentId: taiwanRoot.id })
      .expect(200)
    const provinces = readResponseBody<RegionNodeBody[]>(
      provinceResponse,
    )
    expect(provinces).toEqual([
      expect.objectContaining({
        code: 'TW-TAIWAN',
        name: '台湾',
        level: 'PROVINCE_STATE',
        effectiveEnabled: true,
        hasChildren: true,
      }),
    ])

    const citiesResponse = await browser
      .get('/api/region-selection/options')
      .query({ parentId: provinces[0]?.id })
      .expect(200)
    const cities = readResponseBody<RegionNodeBody[]>(citiesResponse)
    const kaohsiung = cities.find(({ code }) => code === 'TW-64000')
    expect(kaohsiung).toMatchObject({
      name: '高雄市',
      level: 'CITY',
      effectiveEnabled: true,
      hasChildren: false,
    })
    if (!kaohsiung) {
      throw new Error('Missing Kaohsiung city')
    }

    const pathResponse = await browser
      .get(`/api/region-selection/paths/${kaohsiung.id}`)
      .expect(200)
    const path = readResponseBody<RegionPathBody>(pathResponse)
    expect(path.cityId).toBe(kaohsiung.id)
    expect(path.path.map(({ name }) => name)).toEqual([
      '中国台湾',
      '台湾',
      '高雄市',
    ])
    expect(path.path.map(({ effectiveEnabled }) =>
      effectiveEnabled,
    )).toEqual([true, true, true])

    const searchResponse = await browser
      .get('/api/region-selection/search')
      .query({ query: '  高雄  ' })
      .expect(200)
    const search = readResponseBody<RegionSearchBody>(searchResponse)
    expect(search).toMatchObject({
      limit: 20,
      hasMore: false,
    })
    expect(search.items).toHaveLength(1)
    expect(search.items[0]?.cityId).toBe(kaohsiung.id)
    expect(search.items[0]?.path).toHaveLength(3)
    expect(search.items[0]?.path.map(({ name }) => name)).toEqual([
      '中国台湾',
      '台湾',
      '高雄市',
    ])
  })

  it('applies exact/prefix ranking before complete stable path order and computes hasMore after limit + 1', async () => {
    const { browser } = await createLoggedInBrowser()

    const exactResponse = await browser
      .get('/api/region-selection/search')
      .query({ query: ' my-01-01 ', limit: 10 })
      .expect(200)
    const exact = readResponseBody<RegionSearchBody>(exactResponse)
    expect(exact.items[0]?.path[2]).toMatchObject({
      code: 'MY-01-01',
      name: 'Batu Pahat',
    })

    const provinceResponse = await browser
      .get('/api/region-selection/search')
      .query({ query: 'MY-01', limit: 50 })
      .expect(200)
    const province = readResponseBody<RegionSearchBody>(
      provinceResponse,
    )
    expect(province.items.map(({ path }) => path[2].code)).toEqual(
      Array.from(
        { length: 10 },
        (_value, index) =>
          `MY-01-${String(index + 1).padStart(2, '0')}`,
      ),
    )

    for (const query of ['Batu', 'Pahat']) {
      const response = await browser
        .get('/api/region-selection/search')
        .query({ query, limit: 10 })
        .expect(200)
      expect(
        readResponseBody<RegionSearchBody>(response).items.some(
          ({ path }) => path[2].code === 'MY-01-01',
        ),
      ).toBe(true)
    }

    await browser
      .get('/api/region-selection/search')
      .query({ query: '%_', limit: 10 })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionSearchBody>(response).items).toEqual(
          [],
        )
      })

    const boundedResponse = await browser
      .get('/api/region-selection/search')
      .query({ query: 'MY', limit: 1 })
      .expect(200)
    const bounded = readResponseBody<RegionSearchBody>(boundedResponse)
    expect(bounded.items).toHaveLength(1)
    expect(bounded.items[0]?.path[2].code).toBe('MY-01-01')
    expect(bounded.limit).toBe(1)
    expect(bounded.hasMore).toBe(true)
  })

  it('filters disabled ancestry from options/search while preserving historical path status', async () => {
    const { browser } = await createLoggedInBrowser()
    const taiwanRoot = await requireRegion('TW')
    const taiwanProvince = await requireRegion('TW-TAIWAN')
    const kaohsiung = await requireRegion('TW-64000')

    await prisma.region.updateMany({
      where: { id: { in: [taiwanProvince.id, kaohsiung.id] } },
      data: { enabled: false },
    })

    await browser
      .get('/api/region-selection/options')
      .query({ parentId: taiwanRoot.id })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionNodeBody[]>(response)).toEqual([])
      })
    await browser
      .get('/api/region-selection/options')
      .query({ parentId: taiwanProvince.id })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionNodeBody[]>(response)).toEqual([])
      })
    await browser
      .get('/api/region-selection/search')
      .query({ query: '高雄' })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionSearchBody>(response).items).toEqual(
          [],
        )
      })

    const pathResponse = await browser
      .get(`/api/region-selection/paths/${kaohsiung.id}`)
      .expect(200)
    const path = readResponseBody<RegionPathBody>(pathResponse)
    expect(path.path.map(({ enabled }) => enabled)).toEqual([
      true,
      false,
      false,
    ])
    expect(path.path.map(({ effectiveEnabled }) =>
      effectiveEnabled,
    )).toEqual([true, false, false])
  })

  it('returns stable 404/422 errors for UUID, hierarchy, missing values and non-CITY paths', async () => {
    const { browser } = await createLoggedInBrowser()
    const taiwanProvince = await requireRegion('TW-TAIWAN')
    const kaohsiung = await requireRegion('TW-64000')
    const missingId = randomUUID()

    for (const response of [
      await browser
        .get('/api/region-selection/options')
        .query({ parentId: 'not-a-uuid' })
        .expect(422),
      await browser
        .get('/api/region-selection/paths/not-a-uuid')
        .expect(422),
      await browser
        .get('/api/region-selection/search')
        .query({ query: '   ' })
        .expect(422),
      await browser
        .get('/api/region-selection/search')
        .query({ query: '高雄', limit: 51 })
        .expect(422),
    ]) {
      expect(readResponseBody<ApiErrorBody>(response).code).toBe(
        'VALIDATION_FAILED',
      )
    }

    await browser
      .get('/api/region-selection/options')
      .query({ parentId: kaohsiung.id })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_HIERARCHY_INVALID',
        )
      })
    await browser
      .get('/api/region-selection/options')
      .query({ parentId: missingId })
      .expect(404)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_PARENT_NOT_FOUND',
        )
      })
    await browser
      .get(`/api/region-selection/paths/${taiwanProvince.id}`)
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_VALUE_NOT_CITY',
        )
      })
    const missingResponse = await browser
      .get(`/api/region-selection/paths/${missingId}`)
      .expect(404)
    const missing = readResponseBody<ApiErrorBody>(missingResponse)
    expect(missing.code).toBe('REGION_NOT_FOUND')
    expect(missing.requestId).toMatch(/^req_[0-9a-f-]{36}$/u)
    expect(missingResponse.headers['x-request-id']).toBe(
      missing.requestId,
    )
  })

  it('maps unexpected query failures to a request-correlated safe 500', async () => {
    const { browser } = await createLoggedInBrowser()
    serviceSpy = jest
      .spyOn(regions, 'options')
      .mockRejectedValueOnce(
        new Error('secret database connection and SQL details'),
      )

    const response = await browser
      .get('/api/region-selection/options')
      .expect(500)
    const body = readResponseBody<ApiErrorBody>(response)

    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    })
    expect(Object.keys(body).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ])
    expect(body.requestId).toMatch(/^req_[0-9a-f-]{36}$/u)
    expect(response.headers['x-request-id']).toBe(body.requestId)
    expect(response.text).not.toContain('secret database')
    expect(response.headers['cache-control']).toBe('private, no-store')
  })
})
