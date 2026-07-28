import { randomUUID } from 'node:crypto'

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
const USERNAME_PREFIX = 'regions-management-api-e2e-'
const ROLE_CODE_PREFIX = 'regions_management_e2e_'

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

interface RegionBody {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  sourceName: string | null
  sourceCode: string | null
  administrativeType: string
  level: 'CITY' | 'COUNTRY_REGION' | 'PROVINCE_STATE'
  enabled: boolean
  effectiveEnabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface RegionPageBody {
  items: RegionBody[]
  page: number
  pageSize: number
  total: number
}

interface RegionNavigationNodeBody {
  id: string
  parentId: string | null
  code: string
  name: string
  englishName: string | null
  level: 'COUNTRY_REGION' | 'PROVINCE_STATE'
  enabled: boolean
  effectiveEnabled: boolean
  children: RegionNavigationNodeBody[]
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

describe('Regions management read API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let regions: RegionQueryService
  let serviceSpy: jest.SpyInstance | undefined
  const createdUserIds = new Set<string>()
  const createdRoleIds = new Set<string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    passwords = application.get(PasswordProvider)
    regions = application.get(RegionQueryService)
  })

  afterEach(async () => {
    serviceSpy?.mockRestore()
    serviceSpy = undefined

    // 状态类场景直接修改固定种子节点；每例后恢复，避免污染选择器或其他管理测试。
    await prisma.region.updateMany({
      where: { code: { in: ['TW-TAIWAN', 'TW-64000'] } },
      data: { enabled: true },
    })
    await prisma.authRateLimit.deleteMany()

    const [prefixedUsers, prefixedRoles] = await Promise.all([
      prisma.user.findMany({
        where: { usernameNormalized: { startsWith: USERNAME_PREFIX } },
        select: { id: true },
      }),
      prisma.role.findMany({
        where: { code: { startsWith: ROLE_CODE_PREFIX } },
        select: { id: true },
      }),
    ])
    prefixedUsers.forEach(({ id }) => createdUserIds.add(id))
    prefixedRoles.forEach(({ id }) => createdRoleIds.add(id))

    const userIds = [...createdUserIds]
    if (userIds.length > 0) {
      // Audit actor 使用 RESTRICT；User 自关联状态也必须先恢复为合法 ACTIVE 形态。
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

    const roleIds = [...createdRoleIds]
    if (roleIds.length > 0) {
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } })
    }

    createdUserIds.clear()
    createdRoleIds.clear()
  })

  afterAll(async () => {
    await application.close()
  })

  async function createUser(
    options: {
      mustChangePassword?: boolean
      regionsRead?: boolean
    } = {},
  ) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = `Region-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: 'Regions Management API E2E',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (options.regionsRead === true) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: 'regions:read' },
      })
      const role = await prisma.role.create({
        data: {
          code: `${ROLE_CODE_PREFIX}${suffix.replaceAll('-', '')}`,
          name: '地区只读 E2E',
        },
      })
      createdRoleIds.add(role.id)
      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: permission.id,
        },
      })
      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
        },
      })
    }

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
    options: {
      mustChangePassword?: boolean
      regionsRead?: boolean
    } = {},
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

  async function createReaderBrowser() {
    const context = await createLoggedInBrowser({ regionsRead: true })
    expect(
      readResponseBody<AuthContextBody>(
        context.loginResponse,
      ).permissions,
    ).toEqual(['regions:read'])
    return context.browser
  }

  async function requireRegion(code: string) {
    return prisma.region.findUniqueOrThrow({ where: { code } })
  }

  it('requires a normal Session with regions:read on every read endpoint', async () => {
    const kaohsiung = await requireRegion('TW-64000')
    const endpoints = [
      '/api/regions/navigation',
      '/api/regions',
      `/api/regions/${kaohsiung.id}`,
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

    const ordinary = await createLoggedInBrowser()
    expect(
      readResponseBody<AuthContextBody>(
        ordinary.loginResponse,
      ).permissions,
    ).toEqual([])
    for (const endpoint of endpoints) {
      await ordinary.browser
        .get(endpoint)
        .expect(403)
        .expect((response) => {
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'FORBIDDEN',
          )
        })
    }

    const forced = await createLoggedInBrowser({
      mustChangePassword: true,
      regionsRead: true,
    })
    for (const endpoint of endpoints) {
      await forced.browser
        .get(endpoint)
        .expect(403)
        .expect((response) => {
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'PASSWORD_CHANGE_REQUIRED',
          )
        })
    }

    const reader = await createReaderBrowser()
    for (const endpoint of endpoints) {
      await reader.get(endpoint).expect(200)
    }
  })

  it('returns two-level navigation and direct-child pages with bounded search and sorting', async () => {
    const browser = await createReaderBrowser()

    const navigationResponse = await browser
      .get('/api/regions/navigation')
      .expect(200)
    expect(navigationResponse.headers['cache-control']).toBe(
      'private, no-store',
    )
    const navigation = readResponseBody<RegionNavigationNodeBody[]>(
      navigationResponse,
    )
    expect(navigation.map(({ code }) => code)).toEqual(['CN', 'TW', 'MY'])
    expect(
      navigation.every(({ level }) => level === 'COUNTRY_REGION'),
    ).toBe(true)
    expect(
      navigation
        .flatMap(({ children }) => children)
        .every(
          ({ children, level }) =>
            level === 'PROVINCE_STATE' && children.length === 0,
        ),
    ).toBe(true)

    const rootsResponse = await browser
      .get('/api/regions')
      .expect(200)
    const roots = readResponseBody<RegionPageBody>(rootsResponse)
    expect(roots).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 3,
    })
    expect(roots.items.map(({ code }) => code)).toEqual(['CN', 'TW', 'MY'])
    expect(
      roots.items.every(
        ({ level, parentId }) =>
          level === 'COUNTRY_REGION' && parentId === null,
      ),
    ).toBe(true)

    const taiwanRoot = roots.items.find(({ code }) => code === 'TW')
    if (!taiwanRoot) {
      throw new Error('Missing TW root')
    }
    const provinceResponse = await browser
      .get('/api/regions')
      .query({ parentId: taiwanRoot.id, pageSize: 100 })
      .expect(200)
    const provinces = readResponseBody<RegionPageBody>(provinceResponse)
    expect(provinces.total).toBe(1)
    expect(provinces.items).toEqual([
      expect.objectContaining({
        parentId: taiwanRoot.id,
        code: 'TW-TAIWAN',
        level: 'PROVINCE_STATE',
      }),
    ])

    const taiwanProvince = provinces.items[0]
    if (!taiwanProvince) {
      throw new Error('Missing Taiwan province')
    }
    const cityResponse = await browser
      .get('/api/regions')
      .query({ parentId: taiwanProvince.id, pageSize: 100 })
      .expect(200)
    const cities = readResponseBody<RegionPageBody>(cityResponse)
    expect(cities).toMatchObject({
      page: 1,
      pageSize: 100,
      total: 22,
    })
    expect(cities.items).toHaveLength(22)
    expect(
      cities.items.every(
        ({ level, parentId }) =>
          level === 'CITY' && parentId === taiwanProvince.id,
      ),
    ).toBe(true)

    await browser
      .get('/api/regions')
      .query({ parentId: taiwanProvince.id, query: '  高雄  ' })
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<RegionPageBody>(response).items.map(
            ({ code }) => code,
          ),
        ).toEqual(['TW-64000'])
      })
    await browser
      .get('/api/regions')
      .query({ parentId: taiwanProvince.id, code: 'tw-64000' })
      .expect(200)
      .expect((response) => {
        const page = readResponseBody<RegionPageBody>(response)
        expect(page.total).toBe(1)
        expect(page.items[0]?.code).toBe('TW-64000')
      })

    const malaysiaRoot = roots.items.find(({ code }) => code === 'MY')
    if (!malaysiaRoot) {
      throw new Error('Missing MY root')
    }
    await browser
      .get('/api/regions')
      .query({ parentId: malaysiaRoot.id, query: '  JOHOR  ' })
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<RegionPageBody>(response).items.some(
            ({ code }) => code === 'MY-01',
          ),
        ).toBe(true)
      })

    const sortedResponse = await browser
      .get('/api/regions')
      .query({
        pageSize: 100,
        sortBy: 'code',
        sortOrder: 'desc',
      })
      .expect(200)
    const sorted = readResponseBody<RegionPageBody>(sortedResponse)
    expect(sorted.pageSize).toBe(100)
    expect(sorted.items.map(({ code }) => code)).toEqual([
      'TW',
      'MY',
      'CN',
    ])
  })

  it('separates effective, ancestor-disabled and own-disabled states and returns full detail', async () => {
    const browser = await createReaderBrowser()
    const taiwanProvince = await requireRegion('TW-TAIWAN')
    const kaohsiung = await requireRegion('TW-64000')

    await browser
      .get('/api/regions')
      .query({
        parentId: taiwanProvince.id,
        availability: 'EFFECTIVE',
        pageSize: 100,
      })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionPageBody>(response).total).toBe(22)
      })

    await prisma.region.updateMany({
      where: { id: { in: [taiwanProvince.id, kaohsiung.id] } },
      data: { enabled: false },
    })

    const navigationResponse = await browser
      .get('/api/regions/navigation')
      .expect(200)
    const navigation = readResponseBody<RegionNavigationNodeBody[]>(
      navigationResponse,
    )
    const taiwanNavigation = navigation
      .find(({ code }) => code === 'TW')
      ?.children.find(({ code }) => code === 'TW-TAIWAN')
    expect(taiwanNavigation).toMatchObject({
      enabled: false,
      effectiveEnabled: false,
    })

    await browser
      .get('/api/regions')
      .query({
        parentId: taiwanProvince.id,
        ownStatus: 'DISABLED',
        pageSize: 100,
      })
      .expect(200)
      .expect((response) => {
        const page = readResponseBody<RegionPageBody>(response)
        expect(page.total).toBe(1)
        expect(page.items).toEqual([
          expect.objectContaining({
            code: 'TW-64000',
            enabled: false,
            effectiveEnabled: false,
          }),
        ])
      })

    await browser
      .get('/api/regions')
      .query({
        parentId: taiwanProvince.id,
        availability: 'ANCESTOR_DISABLED',
        pageSize: 100,
      })
      .expect(200)
      .expect((response) => {
        const page = readResponseBody<RegionPageBody>(response)
        expect(page.total).toBe(21)
        expect(
          page.items.every(
            ({ effectiveEnabled, enabled }) =>
              enabled && !effectiveEnabled,
          ),
        ).toBe(true)
      })

    await browser
      .get('/api/regions')
      .query({
        parentId: taiwanProvince.id,
        availability: 'EFFECTIVE',
        pageSize: 100,
      })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionPageBody>(response)).toMatchObject({
          items: [],
          total: 0,
        })
      })

    const detailResponse = await browser
      .get(`/api/regions/${kaohsiung.id}`)
      .expect(200)
    const detail = readResponseBody<RegionBody>(detailResponse)
    expect(detail).toMatchObject({
      id: kaohsiung.id,
      parentId: taiwanProvince.id,
      code: 'TW-64000',
      name: '高雄市',
      sourceName: '高雄市',
      sourceCode: 'E/64000',
      administrativeType: 'COUNTY_CITY',
      level: 'CITY',
      enabled: false,
      effectiveEnabled: false,
    })
    expect(detail.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    expect(detail.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it('returns stable validation, parent, hierarchy and detail errors', async () => {
    const browser = await createReaderBrowser()
    const kaohsiung = await requireRegion('TW-64000')
    const missingId = randomUUID()

    for (const response of [
      await browser
        .get('/api/regions')
        .query({ parentId: 'not-a-uuid' })
        .expect(422),
      await browser
        .get('/api/regions')
        .query({ pageSize: 101 })
        .expect(422),
      await browser
        .get('/api/regions')
        .query({
          ownStatus: 'DISABLED',
          availability: 'EFFECTIVE',
        })
        .expect(422),
      await browser
        .get('/api/regions/not-a-uuid')
        .expect(422),
    ]) {
      expect(readResponseBody<ApiErrorBody>(response).code).toBe(
        'VALIDATION_FAILED',
      )
    }

    await browser
      .get('/api/regions')
      .query({ parentId: missingId })
      .expect(404)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_PARENT_NOT_FOUND',
        )
      })
    await browser
      .get('/api/regions')
      .query({ parentId: kaohsiung.id })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_HIERARCHY_INVALID',
        )
      })

    const missingResponse = await browser
      .get(`/api/regions/${missingId}`)
      .expect(404)
    const missing = readResponseBody<ApiErrorBody>(missingResponse)
    expect(missing.code).toBe('REGION_NOT_FOUND')
    expect(missing.requestId).toMatch(/^req_[0-9a-f-]{36}$/u)
    expect(missingResponse.headers['x-request-id']).toBe(
      missing.requestId,
    )
  })

  it('maps unexpected management query failures to a request-correlated safe 500', async () => {
    const browser = await createReaderBrowser()
    const managementRegions = regions as RegionQueryService & {
      list(): Promise<unknown>
    }
    serviceSpy = jest
      .spyOn(managementRegions, 'list')
      .mockRejectedValueOnce(
        new Error('secret database connection and SQL details'),
      )

    const response = await browser.get('/api/regions').expect(500)
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
