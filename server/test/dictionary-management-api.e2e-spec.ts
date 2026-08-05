import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import {
  AuditEventType,
  DictionaryTone,
  UserStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
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
const USERNAME_PREFIX = 'dictionary-management-api-e2e-'
const ROLE_CODE_PREFIX = 'dictionary_management_api_e2e_'
const ALL_DICTIONARY_PERMISSIONS = [
  'dictionaries:create',
  'dictionaries:disable',
  'dictionaries:enable',
  'dictionaries:read',
  'dictionaries:update',
] as const

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

interface DictionaryTypeBody {
  id: string
  code: string
  name: string
  description: string | null
  enabled: boolean
  sortOrder: number
  itemCount: number
  enabledItemCount: number
  version: number
  createdAt: string
  updatedAt: string
}

interface DictionaryItemBody {
  id: string
  dictionaryTypeId: string
  value: string
  label: string
  description: string | null
  tone: keyof typeof DictionaryTone
  enabled: boolean
  effectiveEnabled: boolean
  sortOrder: number
  version: number
  createdAt: string
  updatedAt: string
}

interface DictionaryPageBody<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

interface ResponseLike {
  body: unknown
  headers: Record<string, string | string[] | undefined>
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function readResponseRequestId(response: ResponseLike): string {
  const requestId = response.headers['x-request-id']
  if (typeof requestId !== 'string') {
    throw new Error('Expected response X-Request-Id')
  }
  expect(requestId).toMatch(
    /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  )
  return requestId
}

/** 所有已注册字典路由的成功与失败响应都必须保持私有且不可缓存。 */
function expectPrivateResponse(response: ResponseLike): string {
  expect(response.headers['cache-control']).toBe('private, no-store')
  return readResponseRequestId(response)
}

function expectApiError(
  response: ResponseLike,
  expectedCode: string,
): ApiErrorBody {
  const requestId = expectPrivateResponse(response)
  const body = readResponseBody<ApiErrorBody>(response)
  expect(body.code).toBe(expectedCode)
  expect(body.requestId).toBe(requestId)
  return body
}

function randomDictionaryCode(scope: string): string {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  return `e2e.${scope}_${suffix}`
}

function randomDictionaryValue(scope: string): string {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
  return `${scope}_${suffix}`
}

function sortedStatuses(
  responses: ReadonlyArray<{ status: number }>,
): number[] {
  return responses
    .map(response => response.status)
    .sort((left, right) => left - right)
}

describe('Dictionary management API with Cookie Session and PostgreSQL', () => {
  jest.setTimeout(120_000)

  let application: INestApplication
  let audit: AuditService
  let database: IsolatedDictionaryDatabase
  let originalDatabaseUrl: string | undefined
  let passwords: PasswordProvider
  let prisma: PrismaService
  const createdRoleIds = new Set<string>()
  const createdUserIds = new Set<string>()

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL
    database = await createIsolatedDictionaryDatabase()
    process.env.DATABASE_URL = database.databaseUrl
    const isolatedPrisma = new IsolatedDictionaryPrismaService(database)

    /*
     * AppModule 必须在隔离 URL 生效后动态加载；Prisma provider 再显式绑定
     * adapter schema，确保 ORM 查询与领域 raw SQL 始终落在同一个临时 schema。
     */
    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import('../src/app.module'),
      import('../src/app.setup'),
    ])
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(isolatedPrisma)
      .compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    audit = application.get(AuditService)
    passwords = application.get(PasswordProvider)
    prisma = application.get(PrismaService)
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await prisma.authRateLimit.deleteMany()

    const userIds = [...createdUserIds]
    if (userIds.length > 0) {
      /*
       * Audit actor 外键为 RESTRICT，必须先清 Audit，再恢复 User 自关联字段。
       * 字典业务行受 Trigger 永久保护，刻意不在逐例清理中尝试物理删除。
       */
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

    createdRoleIds.clear()
    createdUserIds.clear()
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
      // 仅删除经过 helper 严格校验且由本 spec 创建的隔离 schema。
      await database?.dispose()
    }
  })

  async function createUser(permissionCodes: readonly string[]) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = `Dict-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: 'Dictionary Management API E2E',
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
          name: '系统字典 E2E 细粒度角色',
          permissions: {
            create: permissions.map(permission => ({
              permissionId: permission.id,
            })),
          },
        },
      })
      createdRoleIds.add(role.id)
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
  ) {
    const response = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
    expectPrivateResponse(response)
    return response
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
      [...readResponseBody<AuthContextBody>(loginResponse).permissions]
        .sort(),
    ).toEqual([...permissionCodes].sort())
    return { account, browser }
  }

  function createType(
    browser: ReturnType<typeof request.agent>,
    input: {
      code: string
      name: string
      description?: string | null
      sortOrder?: number
    },
  ) {
    return browser
      .post('/api/dictionary-types')
      .set(CSRF_HEADERS)
      .send({ sortOrder: 10, ...input })
  }

  function createItem(
    browser: ReturnType<typeof request.agent>,
    typeId: string,
    input: {
      value: string
      label: string
      description?: string | null
      tone?: keyof typeof DictionaryTone
      sortOrder?: number
    },
  ) {
    return browser
      .post(`/api/dictionary-types/${typeId}/items`)
      .set(CSRF_HEADERS)
      .send({ sortOrder: 10, ...input })
  }

  it('enforces Session, independent permissions, CSRF and the absence of DELETE routes', async () => {
    const anonymousRead = await request(application.getHttpServer())
      .get('/api/dictionary-types')
      .expect(401)
    expectApiError(anonymousRead, 'AUTHENTICATION_REQUIRED')

    const anonymousCode = randomDictionaryCode('anonymous')
    const anonymousWrite = await request(application.getHttpServer())
      .post('/api/dictionary-types')
      .set(CSRF_HEADERS)
      .send({ code: anonymousCode, name: '匿名写入', sortOrder: 1 })
      .expect(401)
    expectApiError(anonymousWrite, 'AUTHENTICATION_REQUIRED')
    await expect(
      prisma.dictionaryType.count({ where: { code: anonymousCode } }),
    ).resolves.toBe(0)

    const ordinary = await createBrowser([])
    const ordinaryRead = await ordinary.browser
      .get('/api/dictionary-types')
      .expect(403)
    expectApiError(ordinaryRead, 'FORBIDDEN')

    const administrator = await createBrowser(ALL_DICTIONARY_PERMISSIONS)
    const seedTypeResponse = await createType(administrator.browser, {
      code: randomDictionaryCode('permissions'),
      name: '权限矩阵字典',
    }).expect(201)
    expectPrivateResponse(seedTypeResponse)
    const seedType = readResponseBody<DictionaryTypeBody>(seedTypeResponse)
    const firstItemResponse = await createItem(
      administrator.browser,
      seedType.id,
      { value: randomDictionaryValue('FIRST'), label: '首项' },
    ).expect(201)
    expectPrivateResponse(firstItemResponse)
    const firstItem = readResponseBody<DictionaryItemBody>(firstItemResponse)

    const reader = await createBrowser(['dictionaries:read'])
    const typeRead = await reader.browser
      .get(`/api/dictionary-types/${seedType.id}`)
      .expect(200)
    expectPrivateResponse(typeRead)
    const itemRead = await reader.browser
      .get(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}`)
      .expect(200)
    expectPrivateResponse(itemRead)
    const readerWrite = await createType(reader.browser, {
      code: randomDictionaryCode('reader_forbidden'),
      name: '只读用户不可创建',
    }).expect(403)
    expectApiError(readerWrite, 'FORBIDDEN')

    const creator = await createBrowser(['dictionaries:create'])
    const creatorType = await createType(creator.browser, {
      code: randomDictionaryCode('creator'),
      name: '独立创建权限',
    }).expect(201)
    expectPrivateResponse(creatorType)
    const creatorItem = await createItem(creator.browser, seedType.id, {
      value: randomDictionaryValue('CREATOR'),
      label: '创建权限条目',
    }).expect(201)
    expectPrivateResponse(creatorItem)
    const creatorRead = await creator.browser
      .get('/api/dictionary-types')
      .expect(403)
    expectApiError(creatorRead, 'FORBIDDEN')

    const updater = await createBrowser(['dictionaries:update'])
    const updatedTypeResponse = await updater.browser
      .patch(`/api/dictionary-types/${seedType.id}`)
      .set(CSRF_HEADERS)
      .send({ name: '权限矩阵字典已编辑', expectedVersion: 1 })
      .expect(200)
    expectPrivateResponse(updatedTypeResponse)
    const updatedItemResponse = await updater.browser
      .patch(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .send({ label: '首项已编辑', expectedVersion: 1 })
      .expect(200)
    expectPrivateResponse(updatedItemResponse)
    const updaterEnable = await updater.browser
      .post(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(403)
    expectApiError(updaterEnable, 'FORBIDDEN')

    const enabler = await createBrowser(['dictionaries:enable'])
    const enabledItemResponse = await enabler.browser
      .post(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
    expectPrivateResponse(enabledItemResponse)
    const enabledTypeResponse = await enabler.browser
      .post(`/api/dictionary-types/${seedType.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
    expectPrivateResponse(enabledTypeResponse)
    const enablerDisable = await enabler.browser
      .post(`/api/dictionary-types/${seedType.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(403)
    expectApiError(enablerDisable, 'FORBIDDEN')

    const disabler = await createBrowser(['dictionaries:disable'])
    const disabledTypeResponse = await disabler.browser
      .post(`/api/dictionary-types/${seedType.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(disabledTypeResponse)
    const disabledItemResponse = await disabler.browser
      .post(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(disabledItemResponse)
    const disablerUpdate = await disabler.browser
      .patch(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .send({ label: '不可编辑', expectedVersion: 4 })
      .expect(403)
    expectApiError(disablerUpdate, 'FORBIDDEN')

    /*
     * 八个管理 Mutation 分别由正确权限的 Session 调用，但全部缺少 CSRF。
     * 这样能证明 CSRF 是共同硬边界，同时保证请求不会因权限不足而误绿。
     */
    const noCsrfCode = randomDictionaryCode('no_csrf')
    const noCsrfMutations = [
      () => creator.browser
        .post('/api/dictionary-types')
        .send({ code: noCsrfCode, name: '无 CSRF 类型', sortOrder: 1 }),
      () => creator.browser
        .post(`/api/dictionary-types/${seedType.id}/items`)
        .send({ value: randomDictionaryValue('NO_CSRF'), label: '无 CSRF 条目', sortOrder: 1 }),
      () => updater.browser
        .patch(`/api/dictionary-types/${seedType.id}`)
        .send({ name: '无 CSRF 编辑', expectedVersion: 4 }),
      () => updater.browser
        .patch(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}`)
        .send({ label: '无 CSRF 编辑', expectedVersion: 4 }),
      () => enabler.browser
        .post(`/api/dictionary-types/${seedType.id}/enable`)
        .send({ expectedVersion: 4 }),
      () => enabler.browser
        .post(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}/enable`)
        .send({ expectedVersion: 4 }),
      () => disabler.browser
        .post(`/api/dictionary-types/${seedType.id}/disable`)
        .send({ expectedVersion: 4 }),
      () => disabler.browser
        .post(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}/disable`)
        .send({ expectedVersion: 4 }),
    ]
    for (const createMutation of noCsrfMutations) {
      /*
       * SuperTest 会为尚未监听的 Nest server 临时绑定 HTTP 端口。按 factory
       * 顺序创建并消费请求，避免预先构造多个 Test 时复用已经关闭的临时端口。
       */
      const response = await createMutation().expect(403)
      expectApiError(response, 'CSRF_REJECTED')
    }
    await expect(
      prisma.dictionaryType.count({ where: { code: noCsrfCode } }),
    ).resolves.toBe(0)

    // 物理删除既无公开路由，直接请求也不能命中其他通用 endpoint。
    const deleteItemResponse = await administrator.browser
      .delete(`/api/dictionary-types/${seedType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .expect(404)
    expectPrivateResponse(deleteItemResponse)
    const deleteTypeResponse = await administrator.browser
      .delete(`/api/dictionary-types/${seedType.id}`)
      .set(CSRF_HEADERS)
      .expect(404)
    expectPrivateResponse(deleteTypeResponse)
  })

  it('completes the Type and Item lifecycle with no-op, version and Audit semantics', async () => {
    const { account, browser } = await createBrowser(
      ALL_DICTIONARY_PERMISSIONS,
    )
    const code = randomDictionaryCode('lifecycle')
    const itemValueA = randomDictionaryValue('ONLINE')
    const itemValueB = randomDictionaryValue('OFFLINE')
    const mutationRequestIds: string[] = []

    const createdTypeResponse = await createType(browser, {
      code: `\u2003${code.toUpperCase()}\u2003`,
      name: '  生命周期   字典  ',
      description: '  初始   说明  ',
      sortOrder: 20,
    }).expect(201)
    mutationRequestIds.push(expectPrivateResponse(createdTypeResponse))
    const createdType = readResponseBody<DictionaryTypeBody>(
      createdTypeResponse,
    )
    expect(createdType).toMatchObject({
      code,
      name: '生命周期 字典',
      description: '初始 说明',
      enabled: false,
      sortOrder: 20,
      itemCount: 0,
      enabledItemCount: 0,
      version: 1,
    })

    const firstItemResponse = await createItem(browser, createdType.id, {
      value: ` ${itemValueA.toLowerCase()} `,
      label: '  线上   渠道  ',
      description: '  第一项  ',
      tone: DictionaryTone.PRIMARY,
      sortOrder: 20,
    }).expect(201)
    mutationRequestIds.push(expectPrivateResponse(firstItemResponse))
    const firstItem = readResponseBody<DictionaryItemBody>(firstItemResponse)
    expect(firstItem).toMatchObject({
      dictionaryTypeId: createdType.id,
      value: itemValueA,
      label: '线上 渠道',
      description: '第一项',
      tone: DictionaryTone.PRIMARY,
      enabled: false,
      effectiveEnabled: false,
      sortOrder: 20,
      version: 1,
    })

    const secondItemResponse = await createItem(browser, createdType.id, {
      value: itemValueB,
      label: '线下渠道',
      sortOrder: 10,
    }).expect(201)
    mutationRequestIds.push(expectPrivateResponse(secondItemResponse))
    const secondItem = readResponseBody<DictionaryItemBody>(
      secondItemResponse,
    )
    expect(secondItem).toMatchObject({
      value: itemValueB,
      tone: DictionaryTone.DEFAULT,
      enabled: false,
      version: 1,
    })

    const typePageResponse = await browser
      .get('/api/dictionary-types')
      .query({
        query: code.toUpperCase(),
        status: 'DISABLED',
        sortBy: 'code',
        sortOrder: 'asc',
        page: 1,
        pageSize: 5,
      })
      .expect(200)
    expectPrivateResponse(typePageResponse)
    expect(
      readResponseBody<DictionaryPageBody<DictionaryTypeBody>>(
        typePageResponse,
      ),
    ).toMatchObject({
      page: 1,
      pageSize: 5,
      total: 1,
      items: [{ id: createdType.id, itemCount: 2, enabledItemCount: 0 }],
    })
    const itemPageResponse = await browser
      .get(`/api/dictionary-types/${createdType.id}/items`)
      .query({ sortBy: 'sortOrder', sortOrder: 'asc' })
      .expect(200)
    expectPrivateResponse(itemPageResponse)
    expect(
      readResponseBody<DictionaryPageBody<DictionaryItemBody>>(
        itemPageResponse,
      ).items.map(item => item.id),
    ).toEqual([secondItem.id, firstItem.id])

    const prematureEnable = await browser
      .post(`/api/dictionary-types/${createdType.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(422)
    expectApiError(
      prematureEnable,
      'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
    )

    const enabledFirstResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(enabledFirstResponse))
    expect(readResponseBody<DictionaryItemBody>(enabledFirstResponse))
      .toMatchObject({ enabled: true, effectiveEnabled: false, version: 2 })

    const enabledTypeResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(enabledTypeResponse))
    expect(readResponseBody<DictionaryTypeBody>(enabledTypeResponse))
      .toMatchObject({ enabled: true, enabledItemCount: 1, version: 2 })

    const updatedTypeResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}`)
      .set(CSRF_HEADERS)
      .send({
        name: '  已启用   生命周期字典 ',
        description: null,
        sortOrder: 30,
        expectedVersion: 2,
      })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(updatedTypeResponse))
    const updatedType = readResponseBody<DictionaryTypeBody>(
      updatedTypeResponse,
    )
    expect(updatedType).toMatchObject({
      name: '已启用 生命周期字典',
      description: null,
      sortOrder: 30,
      version: 3,
    })

    const noOpTypeResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}`)
      .set(CSRF_HEADERS)
      .send({ name: ' 已启用   生命周期字典 ', expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(noOpTypeResponse)
    expect(readResponseBody<DictionaryTypeBody>(noOpTypeResponse).version)
      .toBe(3)
    const staleTypeResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}`)
      .set(CSRF_HEADERS)
      .send({ name: updatedType.name, expectedVersion: 2 })
      .expect(409)
    expectApiError(staleTypeResponse, 'DICTIONARY_TYPE_STATE_CHANGED')

    const updatedItemResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .send({
        label: '  在线   销售 ',
        description: '  已更新  ',
        tone: DictionaryTone.SUCCESS,
        sortOrder: 5,
        expectedVersion: 2,
      })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(updatedItemResponse))
    const updatedItem = readResponseBody<DictionaryItemBody>(
      updatedItemResponse,
    )
    expect(updatedItem).toMatchObject({
      value: itemValueA,
      label: '在线 销售',
      description: '已更新',
      tone: DictionaryTone.SUCCESS,
      sortOrder: 5,
      enabled: true,
      effectiveEnabled: true,
      version: 3,
    })

    const noOpItemResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .send({ label: ' 在线   销售 ', expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(noOpItemResponse)
    expect(readResponseBody<DictionaryItemBody>(noOpItemResponse).version)
      .toBe(3)
    const staleItemResponse = await browser
      .patch(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}`)
      .set(CSRF_HEADERS)
      .send({ label: updatedItem.label, expectedVersion: 2 })
      .expect(409)
    expectApiError(staleItemResponse, 'DICTIONARY_ITEM_STATE_CHANGED')

    // 状态 no-op 同样不得增版或写成功 Audit，但 stale version 仍已在上面先行拒绝。
    const noOpTypeStatus = await browser
      .post(`/api/dictionary-types/${createdType.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(noOpTypeStatus)
    expect(readResponseBody<DictionaryTypeBody>(noOpTypeStatus).version)
      .toBe(3)
    const noOpItemStatus = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    expectPrivateResponse(noOpItemStatus)
    expect(readResponseBody<DictionaryItemBody>(noOpItemStatus).version)
      .toBe(3)

    const lastItemFailure = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(422)
    expectApiError(
      lastItemFailure,
      'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
    )

    const enabledSecondResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${secondItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(enabledSecondResponse))
    const disabledFirstResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${firstItem.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(disabledFirstResponse))
    expect(readResponseBody<DictionaryItemBody>(disabledFirstResponse))
      .toMatchObject({ enabled: false, effectiveEnabled: false, version: 4 })

    const disabledTypeResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(disabledTypeResponse))
    expect(readResponseBody<DictionaryTypeBody>(disabledTypeResponse))
      .toMatchObject({ enabled: false, enabledItemCount: 1, version: 4 })
    const noOpDisableType = await browser
      .post(`/api/dictionary-types/${createdType.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 4 })
      .expect(200)
    expectPrivateResponse(noOpDisableType)
    expect(readResponseBody<DictionaryTypeBody>(noOpDisableType).version)
      .toBe(4)

    const disabledSecondResponse = await browser
      .post(`/api/dictionary-types/${createdType.id}/items/${secondItem.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
    mutationRequestIds.push(expectPrivateResponse(disabledSecondResponse))
    expect(readResponseBody<DictionaryItemBody>(disabledSecondResponse))
      .toMatchObject({ enabled: false, effectiveEnabled: false, version: 3 })

    const events = await prisma.auditEvent.findMany({
      where: {
        actorUserId: account.user.id,
        targetId: { in: [createdType.id, firstItem.id, secondItem.id] },
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
      AuditEventType.DICTIONARY_TYPE_CREATED,
      AuditEventType.DICTIONARY_ITEM_CREATED,
      AuditEventType.DICTIONARY_ITEM_CREATED,
      AuditEventType.DICTIONARY_ITEM_ENABLED,
      AuditEventType.DICTIONARY_TYPE_ENABLED,
      AuditEventType.DICTIONARY_TYPE_UPDATED,
      AuditEventType.DICTIONARY_ITEM_UPDATED,
      AuditEventType.DICTIONARY_ITEM_ENABLED,
      AuditEventType.DICTIONARY_ITEM_DISABLED,
      AuditEventType.DICTIONARY_TYPE_DISABLED,
      AuditEventType.DICTIONARY_ITEM_DISABLED,
    ])
    expect(events.map(event => event.requestId)).toEqual(mutationRequestIds)
    expect(events[0]?.metadata).toEqual({
      dictionaryCode: code,
      changedFields: 'code,description,enabled,name,sortOrder',
      version: 1,
    })
    expect(events[5]?.metadata).toEqual({
      dictionaryCode: code,
      changedFields: 'description,name,sortOrder',
      previousVersion: 2,
      version: 3,
    })
    expect(events[6]?.metadata).toEqual({
      dictionaryCode: code,
      itemValue: itemValueA,
      changedFields: 'description,label,sortOrder,tone',
      previousVersion: 2,
      version: 3,
    })
  })

  it('rolls back failed Audit writes and keeps database identity/delete Triggers effective', async () => {
    const { account, browser } = await createBrowser(
      ALL_DICTIONARY_PERMISSIONS,
    )
    const rollbackCode = randomDictionaryCode('audit_rollback')
    const eventCountBefore = await prisma.auditEvent.count({
      where: { actorUserId: account.user.id },
    })
    jest.spyOn(audit, 'record').mockRejectedValueOnce(
      new Error('sensitive audit storage detail'),
    )

    const rollbackResponse = await createType(browser, {
      code: rollbackCode,
      name: '不得提交的字典',
    }).expect(500)
    const rollbackError = expectApiError(rollbackResponse, 'INTERNAL_ERROR')
    expect(Object.keys(rollbackError).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ])
    expect(rollbackError.message).toBe('服务器内部错误')
    expect(JSON.stringify(rollbackError)).not.toContain(
      'sensitive audit storage detail',
    )
    await expect(
      prisma.dictionaryType.count({ where: { code: rollbackCode } }),
    ).resolves.toBe(0)
    await expect(
      prisma.auditEvent.count({ where: { actorUserId: account.user.id } }),
    ).resolves.toBe(eventCountBefore)

    const typeResponse = await createType(browser, {
      code: randomDictionaryCode('trigger'),
      name: 'Trigger 防线',
    }).expect(201)
    const dictionaryType = readResponseBody<DictionaryTypeBody>(typeResponse)
    const itemResponse = await createItem(browser, dictionaryType.id, {
      value: randomDictionaryValue('TRIGGER'),
      label: 'Trigger 条目',
    }).expect(201)
    const dictionaryItem = readResponseBody<DictionaryItemBody>(itemResponse)
    const emptyTypeResponse = await createType(browser, {
      code: randomDictionaryCode('empty_trigger'),
      name: '空 Type Trigger 防线',
    }).expect(201)
    const emptyDictionaryType = readResponseBody<DictionaryTypeBody>(
      emptyTypeResponse,
    )

    /*
     * API 不允许修改稳定身份；这里再直接走真实 Prisma/PostgreSQL，证明 Trigger
     * 能阻止绕过 Service 的 identity update、跨 Type 移动和物理删除。
     */
    await expect(prisma.dictionaryType.update({
      where: { id: dictionaryType.id },
      data: { code: randomDictionaryCode('changed') },
    })).rejects.toBeDefined()
    await expect(prisma.dictionaryItem.update({
      where: { id: dictionaryItem.id },
      data: { value: randomDictionaryValue('CHANGED') },
    })).rejects.toBeDefined()
    await expect(prisma.dictionaryItem.update({
      where: { id: dictionaryItem.id },
      data: { dictionaryTypeId: randomUUID() },
    })).rejects.toBeDefined()
    await expect(prisma.dictionaryItem.delete({
      where: { id: dictionaryItem.id },
    })).rejects.toBeDefined()
    /*
     * Type 删除使用无任何 Item 的独立记录，排除外键 RESTRICT 造成的误绿，
     * 让失败只能来自 dictionary_types_delete_check Trigger。
     */
    await expect(prisma.dictionaryType.delete({
      where: { id: emptyDictionaryType.id },
    })).rejects.toBeDefined()

    await expect(prisma.dictionaryType.findUniqueOrThrow({
      where: { id: dictionaryType.id },
      select: { code: true },
    })).resolves.toEqual({ code: dictionaryType.code })
    await expect(prisma.dictionaryItem.findUniqueOrThrow({
      where: { id: dictionaryItem.id },
      select: { dictionaryTypeId: true, value: true },
    })).resolves.toEqual({
      dictionaryTypeId: dictionaryType.id,
      value: dictionaryItem.value,
    })
    await expect(prisma.dictionaryType.findUniqueOrThrow({
      where: { id: emptyDictionaryType.id },
      select: { code: true },
    })).resolves.toEqual({ code: emptyDictionaryType.code })
  })

  it('serializes concurrent Type and Item writes with the same expectedVersion', async () => {
    const account = await createUser(ALL_DICTIONARY_PERMISSIONS)
    const first = request.agent(application.getHttpServer())
    const second = request.agent(application.getHttpServer())
    await Promise.all([
      login(first, account.user.username, account.password),
      login(second, account.user.username, account.password),
    ])

    const typeResponse = await createType(first, {
      code: randomDictionaryCode('version_race'),
      name: '版本并发字典',
    }).expect(201)
    const dictionaryType = readResponseBody<DictionaryTypeBody>(typeResponse)
    const itemResponse = await createItem(first, dictionaryType.id, {
      value: randomDictionaryValue('VERSION_RACE'),
      label: '版本并发条目',
    }).expect(201)
    const dictionaryItem = readResponseBody<DictionaryItemBody>(itemResponse)

    const typeRace = await Promise.all([
      first
        .patch(`/api/dictionary-types/${dictionaryType.id}`)
        .set(CSRF_HEADERS)
        .send({ name: '并发类型 A', expectedVersion: 1 }),
      second
        .patch(`/api/dictionary-types/${dictionaryType.id}`)
        .set(CSRF_HEADERS)
        .send({ name: '并发类型 B', expectedVersion: 1 }),
    ])
    expect(sortedStatuses(typeRace)).toEqual([200, 409])
    typeRace.forEach(expectPrivateResponse)
    const typeConflict = typeRace.find(response => response.status === 409)
    if (!typeConflict) {
      throw new Error('Expected Dictionary Type version conflict')
    }
    expectApiError(typeConflict, 'DICTIONARY_TYPE_STATE_CHANGED')

    const itemRace = await Promise.all([
      first
        .patch(`/api/dictionary-types/${dictionaryType.id}/items/${dictionaryItem.id}`)
        .set(CSRF_HEADERS)
        .send({ label: '并发条目 A', expectedVersion: 1 }),
      second
        .patch(`/api/dictionary-types/${dictionaryType.id}/items/${dictionaryItem.id}`)
        .set(CSRF_HEADERS)
        .send({ label: '并发条目 B', expectedVersion: 1 }),
    ])
    expect(sortedStatuses(itemRace)).toEqual([200, 409])
    itemRace.forEach(expectPrivateResponse)
    const itemConflict = itemRace.find(response => response.status === 409)
    if (!itemConflict) {
      throw new Error('Expected Dictionary Item version conflict')
    }
    expectApiError(itemConflict, 'DICTIONARY_ITEM_STATE_CHANGED')

    const storedType = readResponseBody<DictionaryTypeBody>(
      await first
        .get(`/api/dictionary-types/${dictionaryType.id}`)
        .expect(200),
    )
    expect(storedType.version).toBe(2)
    expect(['并发类型 A', '并发类型 B']).toContain(storedType.name)
    const storedItem = readResponseBody<DictionaryItemBody>(
      await first
        .get(`/api/dictionary-types/${dictionaryType.id}/items/${dictionaryItem.id}`)
        .expect(200),
    )
    expect(storedItem.version).toBe(2)
    expect(['并发条目 A', '并发条目 B']).toContain(storedItem.label)

    await expect(prisma.auditEvent.count({
      where: {
        actorUserId: account.user.id,
        eventType: AuditEventType.DICTIONARY_TYPE_UPDATED,
        targetId: dictionaryType.id,
      },
    })).resolves.toBe(1)
    await expect(prisma.auditEvent.count({
      where: {
        actorUserId: account.user.id,
        eventType: AuditEventType.DICTIONARY_ITEM_UPDATED,
        targetId: dictionaryItem.id,
      },
    })).resolves.toBe(1)
  })

  it('serializes Type enable against disabling its only enabled Item', async () => {
    const account = await createUser(ALL_DICTIONARY_PERMISSIONS)
    const first = request.agent(application.getHttpServer())
    const second = request.agent(application.getHttpServer())
    await Promise.all([
      login(first, account.user.username, account.password),
      login(second, account.user.username, account.password),
    ])

    const typeResponse = await createType(first, {
      code: randomDictionaryCode('enable_disable_race'),
      name: '启用停用互斥字典',
    }).expect(201)
    const dictionaryType = readResponseBody<DictionaryTypeBody>(typeResponse)
    const itemResponse = await createItem(first, dictionaryType.id, {
      value: randomDictionaryValue('ONLY'),
      label: '唯一启用候选',
    }).expect(201)
    const dictionaryItem = readResponseBody<DictionaryItemBody>(itemResponse)
    await first
      .post(`/api/dictionary-types/${dictionaryType.id}/items/${dictionaryItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)

    /*
     * 两条命令都先锁 Type：若 enable 先提交，Item disable 必须 422；若 disable
     * 先提交，Type enable 必须 422。最终只能是“全真”或“全假”，不能悬空。
     */
    const race = await Promise.all([
      first
        .post(`/api/dictionary-types/${dictionaryType.id}/enable`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 1 }),
      second
        .post(`/api/dictionary-types/${dictionaryType.id}/items/${dictionaryItem.id}/disable`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 2 }),
    ])
    expect(sortedStatuses(race)).toEqual([200, 422])
    race.forEach(expectPrivateResponse)
    const rejected = race.find(response => response.status === 422)
    if (!rejected) {
      throw new Error('Expected Type/Item invariant rejection')
    }
    expectApiError(rejected, 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED')

    const [storedType, storedItem] = await Promise.all([
      prisma.dictionaryType.findUniqueOrThrow({
        where: { id: dictionaryType.id },
        select: { enabled: true },
      }),
      prisma.dictionaryItem.findUniqueOrThrow({
        where: { id: dictionaryItem.id },
        select: { enabled: true },
      }),
    ])
    expect(storedType.enabled).toBe(storedItem.enabled)
  })

  it('allows only one of two last-candidate Item disables for an enabled Type', async () => {
    const account = await createUser(ALL_DICTIONARY_PERMISSIONS)
    const first = request.agent(application.getHttpServer())
    const second = request.agent(application.getHttpServer())
    await Promise.all([
      login(first, account.user.username, account.password),
      login(second, account.user.username, account.password),
    ])

    const typeResponse = await createType(first, {
      code: randomDictionaryCode('last_candidates'),
      name: '最后候选并发字典',
    }).expect(201)
    const dictionaryType = readResponseBody<DictionaryTypeBody>(typeResponse)
    const firstItem = readResponseBody<DictionaryItemBody>(
      await createItem(first, dictionaryType.id, {
        value: randomDictionaryValue('CANDIDATE_A'),
        label: '候选 A',
      }).expect(201),
    )
    const secondItem = readResponseBody<DictionaryItemBody>(
      await createItem(first, dictionaryType.id, {
        value: randomDictionaryValue('CANDIDATE_B'),
        label: '候选 B',
      }).expect(201),
    )
    await first
      .post(`/api/dictionary-types/${dictionaryType.id}/items/${firstItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    await first
      .post(`/api/dictionary-types/${dictionaryType.id}/items/${secondItem.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)
    await first
      .post(`/api/dictionary-types/${dictionaryType.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(200)

    const race = await Promise.all([
      first
        .post(`/api/dictionary-types/${dictionaryType.id}/items/${firstItem.id}/disable`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 2 }),
      second
        .post(`/api/dictionary-types/${dictionaryType.id}/items/${secondItem.id}/disable`)
        .set(CSRF_HEADERS)
        .send({ expectedVersion: 2 }),
    ])
    expect(sortedStatuses(race)).toEqual([200, 422])
    race.forEach(expectPrivateResponse)
    const rejected = race.find(response => response.status === 422)
    if (!rejected) {
      throw new Error('Expected last enabled Dictionary Item rejection')
    }
    expectApiError(rejected, 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED')

    const storedType = await prisma.dictionaryType.findUniqueOrThrow({
      where: { id: dictionaryType.id },
      select: { enabled: true },
    })
    expect(storedType.enabled).toBe(true)
    const storedItems = await prisma.dictionaryItem.findMany({
      where: { id: { in: [firstItem.id, secondItem.id] } },
      orderBy: { id: 'asc' },
      select: { enabled: true, version: true },
    })
    expect(storedItems.filter(item => item.enabled)).toHaveLength(1)
    expect(storedItems.map(item => item.version).sort()).toEqual([2, 3])
    await expect(prisma.auditEvent.count({
      where: {
        actorUserId: account.user.id,
        eventType: AuditEventType.DICTIONARY_ITEM_DISABLED,
        targetId: { in: [firstItem.id, secondItem.id] },
      },
    })).resolves.toBe(1)
  })
})
