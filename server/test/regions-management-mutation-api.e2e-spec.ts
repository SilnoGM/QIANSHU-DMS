import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { Prisma } from '../src/generated/prisma/client'
import {
  AuditEventType,
  RegionLevel,
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
const USERNAME_PREFIX = 'regions-mutation-api-e2e-'
const ROLE_CODE_PREFIX = 'regions_mutation_e2e_'
const REGION_CODE_PREFIX = 'E2E-REGION-'
const ALL_REGION_PERMISSIONS = [
  'regions:create',
  'regions:disable',
  'regions:enable',
  'regions:read',
  'regions:update',
] as const

jest.setTimeout(30_000)

interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}

interface AuthContextBody {
  permissions: string[]
  user: {
    id: string
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

interface RegionMutationBody {
  region: RegionBody
  affectedCount: number
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function readResponseRequestId(response: {
  headers: Record<string, string | string[] | undefined>
}): string {
  const requestId = response.headers['x-request-id']
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Expected response X-Request-Id')
  }
  return requestId
}

function createDeferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolver: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolver = resolve
  })
  return {
    promise,
    resolve: () => {
      if (!resolver) {
        throw new Error('Deferred resolver is unavailable')
      }
      resolver()
    },
  }
}

describe('Regions management mutation API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let audit: AuditService
  let auditSpy: jest.SpyInstance | undefined
  const createdUserIds = new Set<string>()
  const createdRoleIds = new Set<string>()
  const createdRegionIds = new Set<string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    passwords = application.get(PasswordProvider)
    audit = application.get(AuditService)
  })

  afterEach(async () => {
    auditSpy?.mockRestore()
    auditSpy = undefined
    await prisma.authRateLimit.deleteMany()

    const prefixedRegions = await prisma.region.findMany({
      where: { code: { startsWith: REGION_CODE_PREFIX } },
      select: { id: true },
    })
    prefixedRegions.forEach(({ id }) => createdRegionIds.add(id))
    const regionIds = [...createdRegionIds]
    if (regionIds.length > 0) {
      // 自关联外键为 RESTRICT，按叶到根删除，不能依赖批量删除的执行顺序。
      for (const level of [
        RegionLevel.CITY,
        RegionLevel.PROVINCE_STATE,
        RegionLevel.COUNTRY_REGION,
      ]) {
        await prisma.region.deleteMany({
          where: {
            id: { in: regionIds },
            level,
          },
        })
      }
    }

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

    createdRegionIds.clear()
    createdUserIds.clear()
    createdRoleIds.clear()
  })

  afterAll(async () => {
    await application.close()
  })

  async function createUser(permissionCodes: readonly string[]) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = `Region-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: 'Regions Mutation API E2E',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (permissionCodes.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...permissionCodes] } },
        select: { id: true },
      })
      expect(permissions).toHaveLength(permissionCodes.length)
      const role = await prisma.role.create({
        data: {
          code: `${ROLE_CODE_PREFIX}${suffix.replaceAll('-', '')}`,
          name: '地区维护 E2E',
          permissions: {
            create: permissions.map(permission => ({
              permissionId: permission.id,
            })),
          },
        },
      })
      createdRoleIds.add(role.id)
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

  async function createBrowser(permissionCodes: readonly string[]) {
    const account = await createUser(permissionCodes)
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await login(
      browser,
      account.user.username,
      account.password,
    )
    expect(
      [...readResponseBody<AuthContextBody>(
        loginResponse,
      ).permissions].sort(),
    ).toEqual([...permissionCodes].sort())
    return { account, browser }
  }

  function createRegion(
    browser: ReturnType<typeof request.agent>,
    input: {
      parentId: string | null
      code: string
      name: string
      englishName?: string
      sortOrder?: number
      enabled?: boolean
    },
  ) {
    return browser
      .post('/api/regions')
      .set(CSRF_HEADERS)
      .send({
        sortOrder: 10,
        enabled: true,
        ...input,
      })
  }

  function trackRegion(response: { body: unknown }): RegionBody {
    const region = readResponseBody<RegionBody>(response)
    createdRegionIds.add(region.id)
    return region
  }

  it('keeps partial write permissions independent, enforces CSRF and exposes no DELETE route', async () => {
    const { browser } = await createBrowser(['regions:create'])
    const code = `${REGION_CODE_PREFIX}${randomUUID()}`

    await createRegion(browser, {
      parentId: null,
      code,
      name: `独立创建权限 ${randomUUID()}`,
    })
      .expect(201)
      .expect((response) => {
        trackRegion(response)
      })

    await browser.get('/api/regions').expect(403)
    await browser
      .post('/api/regions')
      .send({
        parentId: null,
        code: `${code}-NO-CSRF`,
        name: '无 CSRF',
        sortOrder: 10,
        enabled: true,
      })
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'CSRF_REJECTED',
        )
      })
    await expect(
      prisma.region.findUnique({
        where: { code: `${code}-NO-CSRF`.toUpperCase() },
      }),
    ).resolves.toBeNull()

    const target = [...createdRegionIds][0]
    if (!target) {
      throw new Error('Expected created region')
    }
    await browser
      .patch(`/api/regions/${target}`)
      .set(CSRF_HEADERS)
      .send({ name: '不可编辑' })
      .expect(403)
    await browser
      .post(`/api/regions/${target}/enable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(403)
    await browser
      .post(`/api/regions/${target}/disable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(403)
    await browser
      .delete(`/api/regions/${target}`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(404)
  })

  it('creates three levels, updates editable fields and audits idempotent effective status changes', async () => {
    const { account, browser } = await createBrowser(
      ALL_REGION_PERMISSIONS,
    )
    const suffix = randomUUID()
    const mutationRequestIds: string[] = []
    const rootResponse = await createRegion(browser, {
      parentId: null,
      code: `${REGION_CODE_PREFIX}ROOT-${suffix}`,
      name: `测试国家 ${suffix}`,
      englishName: 'Test Country',
      sortOrder: 1,
    }).expect(201)
    mutationRequestIds.push(readResponseRequestId(rootResponse))
    const root = trackRegion(rootResponse)
    const provinceResponse = await createRegion(browser, {
      parentId: root.id,
      code: `${REGION_CODE_PREFIX}STATE-${suffix}`,
      name: `测试省州 ${suffix}`,
      sortOrder: 2,
    }).expect(201)
    mutationRequestIds.push(readResponseRequestId(provinceResponse))
    const province = trackRegion(provinceResponse)
    const cityResponse = await createRegion(browser, {
      parentId: province.id,
      code: `${REGION_CODE_PREFIX}CITY-${suffix}`,
      name: `测试城市 ${suffix}`,
      sortOrder: 3,
    }).expect(201)
    mutationRequestIds.push(readResponseRequestId(cityResponse))
    const city = trackRegion(cityResponse)

    expect([
      root.level,
      province.level,
      city.level,
    ]).toEqual([
      RegionLevel.COUNTRY_REGION,
      RegionLevel.PROVINCE_STATE,
      RegionLevel.CITY,
    ])
    expect(city).toMatchObject({
      administrativeType: RegionLevel.CITY,
      sourceName: null,
      sourceCode: null,
      effectiveEnabled: true,
    })

    const updateResponse = await browser
      .patch(`/api/regions/${city.id}`)
      .set(CSRF_HEADERS)
      .send({
        name: `更新城市 ${suffix}`,
        englishName: 'Updated City',
        sortOrder: 9,
      })
      .expect(200)
    mutationRequestIds.push(readResponseRequestId(updateResponse))
    const updated = readResponseBody<RegionBody>(updateResponse)
    expect(updated).toMatchObject({
      id: city.id,
      name: `更新城市 ${suffix}`,
      englishName: 'Updated City',
      sortOrder: 9,
    })

    const disableResponse = await browser
      .post(`/api/regions/${province.id}/disable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
    mutationRequestIds.push(readResponseRequestId(disableResponse))
    const disabled = readResponseBody<RegionMutationBody>(disableResponse)
    expect(disabled).toMatchObject({
      affectedCount: 2,
      region: {
        id: province.id,
        enabled: false,
        effectiveEnabled: false,
      },
    })
    const storedCity = await prisma.region.findUniqueOrThrow({
      where: { id: city.id },
    })
    expect(storedCity.enabled).toBe(true)

    await browser
      .post(`/api/regions/${province.id}/disable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<RegionMutationBody>(response).affectedCount,
        ).toBe(0)
      })
    const enableResponse = await browser
      .post(`/api/regions/${province.id}/enable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<RegionMutationBody>(response).affectedCount,
        ).toBe(2)
      })
    mutationRequestIds.push(readResponseRequestId(enableResponse))

    const events = await prisma.auditEvent.findMany({
      where: {
        actorUserId: account.user.id,
        targetType: 'Region',
        targetId: { in: [root.id, province.id, city.id] },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: {
        eventType: true,
        metadata: true,
        requestId: true,
        targetId: true,
      },
    })
    expect(events.map(event => event.eventType)).toEqual([
      AuditEventType.REGION_CREATED,
      AuditEventType.REGION_CREATED,
      AuditEventType.REGION_CREATED,
      AuditEventType.REGION_UPDATED,
      AuditEventType.REGION_DISABLED,
      AuditEventType.REGION_ENABLED,
    ])
    expect(events.map(event => event.requestId)).toEqual(
      mutationRequestIds,
    )
    expect(events[0]?.metadata).toEqual({
      changedFields: 'code,enabled,englishName,name,parentId,sortOrder',
      level: RegionLevel.COUNTRY_REGION,
      affectedCount: 1,
    })
    expect(events[3]?.metadata).toEqual({
      changedFields: 'englishName,name,sortOrder',
      level: RegionLevel.CITY,
      affectedCount: 1,
    })
    expect(events[4]?.metadata).toEqual({
      changedFields: 'enabled',
      level: RegionLevel.PROVINCE_STATE,
      affectedCount: 2,
    })
  })

  it('returns stable 400/404/409/422 errors for malformed, invalid and conflicting commands', async () => {
    const { browser } = await createBrowser(
      ALL_REGION_PERMISSIONS,
    )
    const suffix = randomUUID()
    const root = trackRegion(await createRegion(browser, {
      parentId: null,
      code: `${REGION_CODE_PREFIX}VALID-${suffix}`,
      name: `唯一根 ${suffix}`,
    }).expect(201))
    const province = trackRegion(await createRegion(browser, {
      parentId: root.id,
      code: `${REGION_CODE_PREFIX}PROVINCE-${suffix}`,
      name: `唯一省 ${suffix}`,
    }).expect(201))
    const city = trackRegion(await createRegion(browser, {
      parentId: province.id,
      code: `${REGION_CODE_PREFIX}CITY-${suffix}`,
      name: `唯一市 ${suffix}`,
    }).expect(201))
    const otherProvince = trackRegion(await createRegion(browser, {
      parentId: root.id,
      code: `${REGION_CODE_PREFIX}PROVINCE-OTHER-${suffix}`,
      name: `另一个省 ${suffix}`,
    }).expect(201))

    await browser
      .post('/api/regions')
      .set(CSRF_HEADERS)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'BAD_REQUEST',
        )
      })
    await createRegion(browser, {
      parentId: randomUUID(),
      code: `${REGION_CODE_PREFIX}MISSING-${suffix}`,
      name: '上级不存在',
    })
      .expect(404)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_PARENT_NOT_FOUND',
        )
      })
    await createRegion(browser, {
      parentId: city.id,
      code: `${REGION_CODE_PREFIX}FOURTH-${suffix}`,
      name: '第四层',
    })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_HIERARCHY_INVALID',
        )
      })
    await createRegion(browser, {
      parentId: root.id,
      code: province.code,
      name: '重复编码',
    })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_CODE_ALREADY_EXISTS',
        )
      })
    await createRegion(browser, {
      parentId: root.id,
      code: `${REGION_CODE_PREFIX}OTHER-${suffix}`,
      name: `  唯一省   ${suffix} `,
    })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_NAME_ALREADY_EXISTS',
        )
      })
    await browser
      .patch(`/api/regions/${city.id}`)
      .set(CSRF_HEADERS)
      .send({ enabled: false })
      .expect(422)
    await browser
      .patch(`/api/regions/${otherProvince.id}`)
      .set(CSRF_HEADERS)
      .send({ name: province.name })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_NAME_ALREADY_EXISTS',
        )
      })
    await browser
      .patch('/api/regions/not-a-uuid')
      .set(CSRF_HEADERS)
      .send({ name: '非法路径' })
      .expect(422)
    await browser
      .post(`/api/regions/${randomUUID()}/enable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(404)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'REGION_NOT_FOUND',
        )
      })
  })

  it('rolls back Region when Audit fails and exposes only a safe request-correlated 500', async () => {
    const { browser } = await createBrowser(['regions:create'])
    const suffix = randomUUID()
    const code = `${REGION_CODE_PREFIX}ROLLBACK-${suffix}`
    const clientRequestId = `region-audit-rollback-${suffix}`
    auditSpy = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('sensitive audit storage detail'))

    await browser
      .post('/api/regions')
      .set(CSRF_HEADERS)
      .set('X-Request-Id', clientRequestId)
      .send({
        parentId: null,
        code,
        name: `回滚地区 ${suffix}`,
        sortOrder: 1,
        enabled: true,
      })
      .expect(500)
      .expect((response) => {
        const responseRequestId = readResponseRequestId(response)
        expect(readResponseBody<ApiErrorBody>(response)).toEqual({
          code: 'INTERNAL_ERROR',
          message: '服务器内部错误',
          requestId: responseRequestId,
        })
        expect(responseRequestId).not.toBe(clientRequestId)
      })

    await expect(
      prisma.region.findUnique({ where: { code } }),
    ).resolves.toBeNull()
  })

  it('maps a real PostgreSQL lock timeout to REGION_STATE_CHANGED without mutating', async () => {
    const { browser } = await createBrowser(
      ALL_REGION_PERMISSIONS,
    )
    const suffix = randomUUID()
    const target = trackRegion(await createRegion(browser, {
      parentId: null,
      code: `${REGION_CODE_PREFIX}LOCK-TIMEOUT-${suffix}`,
      name: `锁超时 ${suffix}`,
    }).expect(201))
    const acquired = createDeferred()
    const release = createDeferred()
    const lockTransaction = prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`
            SELECT "id"
            FROM "regions"
            WHERE "id" = CAST(${target.id} AS uuid)
            FOR UPDATE
          `,
        )
        acquired.resolve()
        await release.promise
      },
      { timeout: 10_000 },
    )
    await acquired.promise

    try {
      await browser
        .post(`/api/regions/${target.id}/disable`)
        .set(CSRF_HEADERS)
        .send({})
        .expect(409)
        .expect((response) => {
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'REGION_STATE_CHANGED',
          )
        })
    }
    finally {
      release.resolve()
      await lockTransaction
    }

    await expect(
      prisma.region.findUniqueOrThrow({
        where: { id: target.id },
        select: { enabled: true },
      }),
    ).resolves.toEqual({ enabled: true })
    await expect(
      prisma.auditEvent.count({
        where: {
          eventType: AuditEventType.REGION_DISABLED,
          targetType: 'Region',
          targetId: target.id,
        },
      }),
    ).resolves.toBe(0)
  })

  it('converges concurrent unique writes and overlapping status locks without deadlock', async () => {
    const account = await createUser(ALL_REGION_PERMISSIONS)
    const first = request.agent(application.getHttpServer())
    const second = request.agent(application.getHttpServer())
    await Promise.all([
      login(first, account.user.username, account.password),
      login(second, account.user.username, account.password),
    ])
    const suffix = randomUUID()
    const sharedCode = `${REGION_CODE_PREFIX}RACE-${suffix}`
    const codeRace = await Promise.all([
      createRegion(first, {
        parentId: null,
        code: sharedCode,
        name: `并发编码一 ${suffix}`,
      }),
      createRegion(second, {
        parentId: null,
        code: sharedCode,
        name: `并发编码二 ${suffix}`,
      }),
    ])
    expect(codeRace.map(response => response.status).sort()).toEqual([
      201,
      409,
    ])
    const codeConflict = codeRace.find(response => response.status === 409)
    if (!codeConflict) {
      throw new Error('Expected concurrent code conflict')
    }
    expect(readResponseBody<ApiErrorBody>(codeConflict).code).toBe(
      'REGION_CODE_ALREADY_EXISTS',
    )
    codeRace
      .filter(response => response.status === 201)
      .forEach(trackRegion)

    const sharedRootName = `并发根名称 ${suffix}`
    const nameRace = await Promise.all([
      createRegion(first, {
        parentId: null,
        code: `${REGION_CODE_PREFIX}NAME-A-${suffix}`,
        name: sharedRootName,
      }),
      createRegion(second, {
        parentId: null,
        code: `${REGION_CODE_PREFIX}NAME-B-${suffix}`,
        name: `  并发根名称   ${suffix}  `,
      }),
    ])
    expect(nameRace.map(response => response.status).sort()).toEqual([
      201,
      409,
    ])
    const rootNameConflict = nameRace.find(
      response => response.status === 409,
    )
    if (!rootNameConflict) {
      throw new Error('Expected concurrent root-name conflict')
    }
    expect(readResponseBody<ApiErrorBody>(rootNameConflict).code).toBe(
      'REGION_NAME_ALREADY_EXISTS',
    )
    nameRace
      .filter(response => response.status === 201)
      .forEach(trackRegion)

    const root = trackRegion(await createRegion(first, {
      parentId: null,
      code: `${REGION_CODE_PREFIX}LOCK-ROOT-${suffix}`,
      name: `锁根 ${suffix}`,
    }).expect(201))
    const siblingName = `并发同级省 ${suffix}`
    const siblingRace = await Promise.all([
      createRegion(first, {
        parentId: root.id,
        code: `${REGION_CODE_PREFIX}SIBLING-A-${suffix}`,
        name: siblingName,
      }),
      createRegion(second, {
        parentId: root.id,
        code: `${REGION_CODE_PREFIX}SIBLING-B-${suffix}`,
        name: ` 并发同级省   ${suffix} `,
      }),
    ])
    expect(siblingRace.map(response => response.status).sort()).toEqual([
      201,
      409,
    ])
    const siblingConflict = siblingRace.find(
      response => response.status === 409,
    )
    if (!siblingConflict) {
      throw new Error('Expected concurrent sibling-name conflict')
    }
    expect(readResponseBody<ApiErrorBody>(siblingConflict).code).toBe(
      'REGION_NAME_ALREADY_EXISTS',
    )
    siblingRace
      .filter(response => response.status === 201)
      .forEach(trackRegion)

    const province = trackRegion(await createRegion(first, {
      parentId: root.id,
      code: `${REGION_CODE_PREFIX}LOCK-STATE-${suffix}`,
      name: `锁省 ${suffix}`,
    }).expect(201))
    const city = trackRegion(await createRegion(first, {
      parentId: province.id,
      code: `${REGION_CODE_PREFIX}LOCK-CITY-${suffix}`,
      name: `锁市 ${suffix}`,
    }).expect(201))

    const statusRace = await Promise.all([
      first
        .post(`/api/regions/${province.id}/disable`)
        .set(CSRF_HEADERS)
        .send({}),
      second
        .post(`/api/regions/${city.id}/disable`)
        .set(CSRF_HEADERS)
        .send({}),
    ])
    expect(statusRace.map(response => response.status)).toEqual([200, 200])
    expect(
      statusRace.reduce(
        (total, response) =>
          total
          + readResponseBody<RegionMutationBody>(response).affectedCount,
        0,
      ),
    ).toBe(2)
    const stored = await prisma.region.findMany({
      where: { id: { in: [province.id, city.id] } },
      orderBy: { id: 'asc' },
      select: { enabled: true },
    })
    expect(stored).toEqual([{ enabled: false }, { enabled: false }])
    await first
      .get(`/api/regions/${city.id}`)
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RegionBody>(response)).toMatchObject({
          enabled: false,
          effectiveEnabled: false,
        })
      })
  })
})
