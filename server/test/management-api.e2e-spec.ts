import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  UserStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { ApiException } from '../src/infrastructure/http/api.exception'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { MANAGEMENT_PERMISSION_CODES } from '../src/modules/access-control/permission.constants'
import {
  UsersService,
  type UsersCommandContext,
} from '../src/modules/users/users.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'management-api-e2e-'
const ROLE_CODE_PREFIX = 'management_e2e_'
const PERMISSION_CODE_PREFIX = 'management-e2e:'
// 权限目录常量已覆盖全部业务迁移结果；HTTP 目录返回全部迁移结果，须保留精确集合断言。
const SEEDED_PERMISSION_CODES = [...MANAGEMENT_PERMISSION_CODES] as const

interface ApiErrorBody {
  code: string
}

interface AuthContextBody {
  user: {
    id: string
    username: string
    displayName: string
    mustChangePassword: boolean
  }
  permissions: string[]
}

interface UserBody {
  id: string
  username: string
  displayName: string
  status: 'ACTIVE' | 'DISABLED'
  mustChangePassword: boolean
  roleIds: string[]
  profile: {
    email: string | null
    mobileE164: string | null
    avatarUrl: string | null
    remark: string | null
    createdAt: string
    updatedAt: string
  }
}

interface UserPageBody {
  items: UserBody[]
  page: number
  pageSize: number
  total: number
}

interface RoleBody {
  id: string
  code: string
  name: string
  description: string | null
  isSystem: boolean
  permissionIds: string[]
}

interface PermissionBody {
  id: string
  code: string
  name: string
  description: string | null
  systemOnly: boolean
}

interface AuditEventBody {
  id: string
  eventType: string
  outcome: string
  occurredAt: string
  actorType: string
  actorUserId: string | null
  actorDisplayName: string | null
  targetType: string | null
  targetId: string | null
  requestId: string
  correlationId: string | null
  reasonCode: string | null
  metadata: Record<string, string | number | boolean | null>
}

interface AuditPageBody {
  items: AuditEventBody[]
  page: number
  pageSize: number
  total: number
}

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve() {
      resolvePromise?.()
    },
  }
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function readSessionCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie']
  if (!Array.isArray(setCookie) || typeof setCookie[0] !== 'string') {
    throw new Error('Expected a Session Set-Cookie header')
  }

  return setCookie
    .filter((cookie): cookie is string => typeof cookie === 'string')
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ')
}

/** 生成落在 8..20 边界内且每次运行不同的测试密码，保证 E2E 测试的是目标业务分支。 */
function createTestPassword(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`
}

function createTestMobileE164(): string {
  const digits = randomUUID().replace(/\D/gu, '').padEnd(10, '1').slice(0, 10)
  return `+861${digits}`
}

describe('Management API with PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwordProvider: PasswordProvider
  let usersService: UsersService
  const createdUserIds = new Set<string>()
  const createdRoleIds = new Set<string>()
  const createdPermissionIds = new Set<string>()

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    passwordProvider = application.get(PasswordProvider)
    usersService = application.get(UsersService)
  })

  afterEach(async () => {
    // 即使断言在记录 response id 之前失败，也按本套件专用前缀找回残留数据。
    const [prefixedUsers, prefixedRoles, prefixedPermissions] =
      await Promise.all([
        prisma.user.findMany({
          where: { usernameNormalized: { startsWith: USERNAME_PREFIX } },
          select: { id: true },
        }),
        prisma.role.findMany({
          where: { code: { startsWith: ROLE_CODE_PREFIX } },
          select: { id: true },
        }),
        prisma.permission.findMany({
          where: { code: { startsWith: PERMISSION_CODE_PREFIX } },
          select: { id: true },
        }),
      ])

    prefixedUsers.forEach(({ id }) => createdUserIds.add(id))
    prefixedRoles.forEach(({ id }) => createdRoleIds.add(id))
    prefixedPermissions.forEach(({ id }) => createdPermissionIds.add(id))

    const userIds = [...createdUserIds]
    if (userIds.length > 0) {
      // Audit actor 使用 RESTRICT；User 还存在 createdBy/disabledBy 自关联，必须按序清理。
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: userIds } },
      })
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        // DISABLED 行的 disabledAt/disabledByUserId 受数据库一致性约束保护；
        // 清理时先整体恢复为合法 ACTIVE 状态，再解除测试内 User 自关联。
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

    const permissionIds = [...createdPermissionIds]
    if (permissionIds.length > 0) {
      await prisma.permission.deleteMany({
        where: { id: { in: permissionIds } },
      })
    }

    createdUserIds.clear()
    createdRoleIds.clear()
    createdPermissionIds.clear()
  })

  afterAll(async () => {
    await application.close()
  })

  async function createDirectUser(options: { systemAdmin?: boolean } = {}) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = createTestPassword('Manage')
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username.toLowerCase(),
        displayName: 'Management API E2E',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (options.systemAdmin === true) {
      const systemAdminRole = await prisma.role.findUniqueOrThrow({
        where: { code: 'system_admin' },
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: systemAdminRole.id },
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

  it('requires authentication and management permissions before allowing a system_admin request', async () => {
    await request(application.getHttpServer())
      .get('/api/users')
      .expect(401)
      .expect((response) => {
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'AUTHENTICATION_REQUIRED',
        )
      })

    const ordinary = await createDirectUser()
    const ordinaryBrowser = request.agent(application.getHttpServer())
    await login(ordinaryBrowser, ordinary.user.username, ordinary.password)
    await ordinaryBrowser
      .get('/api/users')
      .expect(403)
      .expect((response) => {
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(readResponseBody<ApiErrorBody>(response).code).toBe('FORBIDDEN')
      })

    const administrator = await createDirectUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    const loginResponse = await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )
    expect(readResponseBody<AuthContextBody>(loginResponse).permissions).toContain(
      'users:read',
    )
    await adminBrowser.get('/api/users').expect(200)
  })

  it('rejects user creation, password reset and RBAC writes without CSRF proof', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const target = await createDirectUser()
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )

    const role = await prisma.role.create({
      data: {
        code: `${ROLE_CODE_PREFIX}${randomUUID().replaceAll('-', '')}`,
        name: 'CSRF E2E Role',
      },
    })
    createdRoleIds.add(role.id)

    const rejectedUsername = `${USERNAME_PREFIX}csrf-${randomUUID()}`
    const createUserResponse = await adminBrowser
      .post('/api/users')
      .send({
        username: rejectedUsername,
        displayName: '不得创建的用户',
        password: createTestPassword('Reject'),
        mustChangePassword: false,
      })
      .expect(403)
    expect(readResponseBody<ApiErrorBody>(createUserResponse).code).toBe(
      'CSRF_REJECTED',
    )

    const resetResponse = await adminBrowser
      .post(`/api/users/${target.user.id}/password-reset`)
      .send({
        newPassword: createTestPassword('Reject'),
        mustChangePassword: true,
      })
      .expect(403)
    expect(readResponseBody<ApiErrorBody>(resetResponse).code).toBe(
      'CSRF_REJECTED',
    )

    const replacePermissionsResponse = await adminBrowser
      .put(`/api/roles/${role.id}/permissions`)
      .send({ permissionIds: [] })
      .expect(403)
    expect(
      readResponseBody<ApiErrorBody>(replacePermissionsResponse).code,
    ).toBe('CSRF_REJECTED')

    // CSRF Guard 必须先于业务服务执行，三个请求都不能留下业务写入。
    await expect(
      prisma.user.count({
        where: { usernameNormalized: rejectedUsername.toLowerCase() },
      }),
    ).resolves.toBe(0)
    const persistedTarget = await prisma.user.findUniqueOrThrow({
      where: { id: target.user.id },
    })
    expect(persistedTarget.authVersion).toBe(0)
    expect(persistedTarget.mustChangePassword).toBe(false)
    await expect(
      passwordProvider.verify(target.password, persistedTarget.passwordHash),
    ).resolves.toBe(true)
    await expect(
      prisma.rolePermission.count({ where: { roleId: role.id } }),
    ).resolves.toBe(0)
  })

  it('supports the complete user lifecycle with exact pagination and invalidates old Sessions after reset', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )

    const roleCode = `${ROLE_CODE_PREFIX}${randomUUID().replaceAll('-', '')}`
    const roleResponse = await adminBrowser
      .post('/api/roles')
      .set(CSRF_HEADERS)
      .send({ code: roleCode, name: '仓库资料员' })
      .expect(201)
    const role = readResponseBody<RoleBody>(roleResponse)
    createdRoleIds.add(role.id)

    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}created-${suffix}`
    const originalPassword = createTestPassword('Create')

    const rejectedProfileUsername = `${USERNAME_PREFIX}profile-input-${suffix}`
    await adminBrowser
      .post('/api/users')
      .set(CSRF_HEADERS)
      .send({
        username: rejectedProfileUsername,
        displayName: '不得带资料创建',
        password: originalPassword,
        mustChangePassword: false,
        email: 'must-not-be-created@example.com',
      })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'VALIDATION_FAILED',
        )
      })
    await expect(
      prisma.user.count({
        where: { usernameNormalized: rejectedProfileUsername.toLowerCase() },
      }),
    ).resolves.toBe(0)

    const createResponse = await adminBrowser
      .post('/api/users')
      .set(CSRF_HEADERS)
      .send({
        username,
        displayName: '待维护用户',
        password: originalPassword,
        mustChangePassword: false,
      })
      .expect(201)
    const created = readResponseBody<UserBody>(createResponse)
    createdUserIds.add(created.id)
    expect(created).toMatchObject({
      username,
      displayName: '待维护用户',
      status: 'ACTIVE',
      mustChangePassword: false,
      roleIds: [],
      profile: {
        email: null,
        mobileE164: null,
        avatarUrl: null,
        remark: null,
      },
    })
    expect(created).not.toHaveProperty('password')
    expect(created).not.toHaveProperty('passwordHash')
    expect(typeof created.profile.createdAt).toBe('string')
    expect(typeof created.profile.updatedAt).toBe('string')
    await expect(
      prisma.userProfile.count({ where: { userId: created.id } }),
    ).resolves.toBe(1)

    const firstPage = await adminBrowser
      .get('/api/users')
      .query({ page: 1, pageSize: 1, username: username.toUpperCase() })
      .expect(200)
    expect(readResponseBody<UserPageBody>(firstPage)).toMatchObject({
      items: [{ id: created.id, username }],
      page: 1,
      pageSize: 1,
      total: 1,
    })

    const emptySecondPage = await adminBrowser
      .get('/api/users')
      .query({ page: 2, pageSize: 1, username })
      .expect(200)
    expect(readResponseBody<UserPageBody>(emptySecondPage)).toMatchObject({
      items: [],
      page: 2,
      pageSize: 1,
      total: 1,
    })

    await adminBrowser
      .get(`/api/users/${created.id}`)
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response).id).toBe(created.id)
      })

    const profileEmail = `Operator-${suffix}@Example.com`
    const profileMobile = createTestMobileE164()
    const profileAvatar = `https://example.com/avatar/${suffix}.png`
    const updateAuditCountBefore = await prisma.auditEvent.count({
      where: {
        eventType: AuditEventType.USER_UPDATED,
        targetId: created.id,
      },
    })
    await adminBrowser
      .patch(`/api/users/${created.id}`)
      .set(CSRF_HEADERS)
      .send({
        displayName: '已改名用户',
        email: `  ${profileEmail}  `,
        mobileE164: profileMobile,
        avatarUrl: profileAvatar,
        remark: ' 仅管理员可见 ',
      })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response)).toMatchObject({
          displayName: '已改名用户',
          profile: {
            email: profileEmail,
            mobileE164: profileMobile,
            avatarUrl: profileAvatar,
            remark: '仅管理员可见',
          },
        })
      })

    const storedProfile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: created.id },
    })
    expect(storedProfile).toMatchObject({
      email: profileEmail,
      emailNormalized: profileEmail.toLowerCase(),
      mobileE164: profileMobile,
      avatarUrl: profileAvatar,
      remark: '仅管理员可见',
    })
    const updateAudits = await prisma.auditEvent.findMany({
      where: {
        eventType: AuditEventType.USER_UPDATED,
        targetId: created.id,
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    })
    expect(updateAudits).toHaveLength(updateAuditCountBefore + 1)
    expect(updateAudits[0]?.metadata).toEqual({
      changedFields: 'avatarUrl,displayName,email,mobileE164,remark',
    })
    const serializedUpdateAudit = JSON.stringify(updateAudits[0]?.metadata)
    for (const sensitiveValue of [
      profileEmail,
      profileMobile,
      profileAvatar,
      '仅管理员可见',
    ]) {
      expect(serializedUpdateAudit).not.toContain(sensitiveValue)
    }

    await adminBrowser
      .put(`/api/users/${created.id}/roles`)
      .set(CSRF_HEADERS)
      .send({ roleIds: [role.id] })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response).roleIds).toEqual([role.id])
      })

    const targetBeforeDisable = request.agent(application.getHttpServer())
    await login(targetBeforeDisable, username, originalPassword)
    await adminBrowser
      .post(`/api/users/${created.id}/disable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response).status).toBe('DISABLED')
      })
    await targetBeforeDisable.get('/api/auth/me').expect(401)

    await adminBrowser
      .post(`/api/users/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response).status).toBe('ACTIVE')
      })

    const targetBeforeReset = request.agent(application.getHttpServer())
    await login(targetBeforeReset, username, originalPassword)
    const newPassword = createTestPassword('Reset')
    await adminBrowser
      .post(`/api/users/${created.id}/password-reset`)
      .set(CSRF_HEADERS)
      .send({ newPassword, mustChangePassword: true })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<UserBody>(response).mustChangePassword).toBe(
          true,
        )
      })

    await targetBeforeReset.get('/api/auth/me').expect(401)
    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(storedUser.authVersion).toBe(2)
    await expect(
      passwordProvider.verify(newPassword, storedUser.passwordHash),
    ).resolves.toBe(true)
    await expect(
      passwordProvider.verify(originalPassword, storedUser.passwordHash),
    ).resolves.toBe(false)

    const resetSessions = await prisma.authSession.findMany({
      where: { userId: created.id, revokedReason: 'PASSWORD_RESET' },
    })
    expect(resetSessions).toHaveLength(1)

    const targetAfterReset = request.agent(application.getHttpServer())
    const relogin = await login(targetAfterReset, username, newPassword)
    expect(
      readResponseBody<AuthContextBody>(relogin).user.mustChangePassword,
    ).toBe(true)
  })

  it('maps Email/Mobile conflicts to stable 409 without partial User or Audit writes', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const target = await createDirectUser()
    const conflicting = await createDirectUser()
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )

    const conflictingEmail = `Conflict-${randomUUID()}@Example.com`
    const conflictingMobile = createTestMobileE164()
    await prisma.userProfile.update({
      where: { userId: conflicting.user.id },
      data: {
        email: conflictingEmail,
        emailNormalized: conflictingEmail.toLowerCase(),
        mobileE164: conflictingMobile,
      },
    })
    const auditCountBefore = await prisma.auditEvent.count({
      where: {
        eventType: AuditEventType.USER_UPDATED,
        targetId: target.user.id,
      },
    })

    await adminBrowser
      .patch(`/api/users/${target.user.id}`)
      .set(CSRF_HEADERS)
      .send({
        displayName: '不得部分提交 Email',
        email: conflictingEmail.toLowerCase(),
      })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'EMAIL_ALREADY_EXISTS',
        )
      })
    await adminBrowser
      .patch(`/api/users/${target.user.id}`)
      .set(CSRF_HEADERS)
      .send({
        displayName: '不得部分提交 Mobile',
        mobileE164: conflictingMobile,
      })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'MOBILE_ALREADY_EXISTS',
        )
      })

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: target.user.id },
      include: { profile: true },
    })
    expect(unchanged.displayName).toBe('Management API E2E')
    expect(unchanged.profile).toMatchObject({
      email: null,
      emailNormalized: null,
      mobileE164: null,
    })
    await expect(
      prisma.auditEvent.count({
        where: {
          eventType: AuditEventType.USER_UPDATED,
          targetId: target.user.id,
        },
      }),
    ).resolves.toBe(auditCountBefore)
  })

  it('manages ordinary roles while atomically rejecting systemOnly and missing permissions, then paginates safe audit data', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )

    const roleCode = `${ROLE_CODE_PREFIX}${randomUUID().replaceAll('-', '')}`
    const createdRoleResponse = await adminBrowser
      .post('/api/roles')
      .set(CSRF_HEADERS)
      .send({
        code: roleCode,
        name: '初始角色',
        description: '初始说明',
      })
      .expect(201)
    const role = readResponseBody<RoleBody>(createdRoleResponse)
    createdRoleIds.add(role.id)
    expect(role).toMatchObject({
      code: roleCode,
      name: '初始角色',
      isSystem: false,
      permissionIds: [],
    })

    await adminBrowser
      .patch(`/api/roles/${role.id}`)
      .set(CSRF_HEADERS)
      .send({ name: '已编辑角色', description: '已编辑说明' })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RoleBody>(response)).toMatchObject({
          id: role.id,
          name: '已编辑角色',
          description: '已编辑说明',
        })
      })

    const permissionsResponse = await adminBrowser
      .get('/api/permissions')
      .expect(200)
    const permissionCatalog = readResponseBody<PermissionBody[]>(
      permissionsResponse,
    )
    expect(permissionCatalog).toHaveLength(SEEDED_PERMISSION_CODES.length)
    expect(permissionCatalog.map(({ code }) => code)).toEqual(
      [...SEEDED_PERMISSION_CODES].sort(),
    )
    const systemOnlyPermission = permissionCatalog.find(
      ({ systemOnly }) => systemOnly,
    )
    expect(systemOnlyPermission).toBeDefined()

    const businessPermission = await prisma.permission.create({
      data: {
        code: `${PERMISSION_CODE_PREFIX}${randomUUID()}`,
        name: 'E2E 业务读取',
        systemOnly: false,
      },
    })
    createdPermissionIds.add(businessPermission.id)

    await adminBrowser
      .put(`/api/roles/${role.id}/permissions`)
      .set(CSRF_HEADERS)
      .send({ permissionIds: [businessPermission.id] })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RoleBody>(response).permissionIds).toEqual([
          businessPermission.id,
        ])
      })

    await adminBrowser
      .put(`/api/roles/${role.id}/permissions`)
      .set(CSRF_HEADERS)
      .send({
        permissionIds: [businessPermission.id, systemOnlyPermission?.id],
      })
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe('FORBIDDEN')
      })

    await adminBrowser
      .get(`/api/roles/${role.id}`)
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<RoleBody>(response).permissionIds).toEqual([
          businessPermission.id,
        ])
      })

    await adminBrowser
      .put(`/api/roles/${role.id}/permissions`)
      .set(CSRF_HEADERS)
      .send({ permissionIds: [businessPermission.id, randomUUID()] })
      .expect(404)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'PERMISSION_NOT_FOUND',
        )
      })

    const persistedRelations = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    })
    expect(persistedRelations).toEqual([
      { permissionId: businessPermission.id },
    ])

    const sourceAudit = await prisma.auditEvent.create({
      data: {
        eventType: AuditEventType.USER_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        occurredAt: new Date(Date.now() + 60_000),
        actorType: AuditActorType.USER,
        actorUserId: administrator.user.id,
        targetType: 'User',
        targetId: administrator.user.id,
        requestId: `management-e2e-${randomUUID()}`,
        sourceIpHash: Buffer.alloc(32, 1),
        metadata: {
          visible: 'yes',
          nested: { mustNotEscape: true },
        },
      },
    })

    const auditFirstPageResponse = await adminBrowser
      .get('/api/audit-events')
      .query({ page: 1, pageSize: 1 })
      .expect(200)
    const auditFirstPage = readResponseBody<AuditPageBody>(
      auditFirstPageResponse,
    )
    expect(auditFirstPage).toMatchObject({ page: 1, pageSize: 1 })
    expect(auditFirstPage.total).toBeGreaterThanOrEqual(5)
    expect(auditFirstPage.items).toHaveLength(1)
    expect(auditFirstPage.items[0]).toMatchObject({
      id: sourceAudit.id,
      actorUserId: administrator.user.id,
      actorDisplayName: administrator.user.displayName,
      metadata: { visible: 'yes' },
    })
    expect(Object.keys(auditFirstPage.items[0] ?? {}).sort()).toEqual([
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
    expect(auditFirstPage.items[0]).not.toHaveProperty('sourceIpHash')
    expect(auditFirstPage.items[0]).not.toHaveProperty('actorUser')

    const auditSecondPage = readResponseBody<AuditPageBody>(
      await adminBrowser
        .get('/api/audit-events')
        .query({ page: 2, pageSize: 1 })
        .expect(200),
    )
    expect(auditSecondPage).toMatchObject({ page: 2, pageSize: 1 })
    expect(auditSecondPage.items).toHaveLength(1)
    expect(auditSecondPage.items[0]?.id).not.toBe(sourceAudit.id)
  })

  it('rejects administrator self-reset and preserves the last active system_admin', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const adminBrowser = request.agent(application.getHttpServer())
    await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )

    await adminBrowser
      .post(`/api/users/${administrator.user.id}/password-reset`)
      .set(CSRF_HEADERS)
      .send({
        newPassword: createTestPassword('Self'),
        mustChangePassword: false,
      })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'SELF_PASSWORD_RESET_NOT_ALLOWED',
        )
      })

    await adminBrowser
      .put(`/api/users/${administrator.user.id}/roles`)
      .set(CSRF_HEADERS)
      .send({ roleIds: [] })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'LAST_SYSTEM_ADMIN_REQUIRED',
        )
      })

    const systemRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await expect(
      prisma.userRole.findUnique({
        where: {
          userId_roleId: {
            userId: administrator.user.id,
            roleId: systemRole.id,
          },
        },
      }),
    ).resolves.not.toBeNull()
    await adminBrowser.get('/api/users').expect(200)
  })

  it('serializes mutually disabling system_admin users so exactly one remains active', async () => {
    const firstAdministrator = await createDirectUser({ systemAdmin: true })
    const secondAdministrator = await createDirectUser({ systemAdmin: true })
    const createCommandContext = (actorUserId: string): UsersCommandContext => ({
      actorUserId,
      // disable 不读取 Session，但命令上下文仍必须使用合法 UUID，确保走真实归一化路径。
      actorSessionId: randomUUID(),
      requestId: randomUUID(),
    })

    const results = await Promise.allSettled([
      usersService.disable(
        createCommandContext(firstAdministrator.user.id),
        secondAdministrator.user.id,
      ),
      usersService.disable(
        createCommandContext(secondAdministrator.user.id),
        firstAdministrator.user.id,
      ),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    expect(rejection).toBeDefined()
    if (!(rejection?.reason instanceof ApiException)) {
      throw new Error('Expected the losing transaction to return ApiException')
    }
    expect(rejection.reason.getStatus()).toBe(409)
    expect(rejection.reason.code).toBe('LAST_SYSTEM_ADMIN_REQUIRED')

    const systemRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await expect(
      prisma.userRole.count({
        where: {
          roleId: systemRole.id,
          userId: {
            in: [
              firstAdministrator.user.id,
              secondAdministrator.user.id,
            ],
          },
          user: { status: UserStatus.ACTIVE },
        },
      }),
    ).resolves.toBe(1)
  })

  it('serializes concurrent password resets so only one snapshot can commit', async () => {
    const administrator = await createDirectUser({ systemAdmin: true })
    const target = await createDirectUser()
    const adminBrowser = request.agent(application.getHttpServer())
    const adminLogin = await login(
      adminBrowser,
      administrator.user.username,
      administrator.password,
    )
    const adminCookie = readSessionCookie(adminLogin)

    const targetBrowser = request.agent(application.getHttpServer())
    await login(targetBrowser, target.user.username, target.password)

    const candidatePasswords = Array.from(
      { length: 4 },
      () => createTestPassword('Concurrent'),
    )
    const candidatePasswordSet = new Set(candidatePasswords)
    const arrivedPasswords = new Set<string>()
    const allCandidatesAtHash = createDeferred()
    const releaseCandidateHashes = createDeferred()
    const originalHash = passwordProvider.hash.bind(passwordProvider)
    const hashSpy = jest
      .spyOn(passwordProvider, 'hash')
      .mockImplementation(async (password) => {
        if (!candidatePasswordSet.has(password)) {
          return originalHash(password)
        }

        arrivedPasswords.add(password)
        if (arrivedPasswords.size === candidatePasswordSet.size) {
          allCandidatesAtHash.resolve()
        }

        // resetPassword 在调用 hash 前已读取快照。四个候选全部停在这里后再
        // 放行，才能确定性验证同一代快照只有一个事务可以提交。
        await releaseCandidateHashes.promise
        return originalHash(password)
      })
    const pendingResponses = candidatePasswords.map((newPassword) =>
      request(application.getHttpServer())
        .post(`/api/users/${target.user.id}/password-reset`)
        .set(CSRF_HEADERS)
        .set('Cookie', adminCookie)
        .send({ newPassword, mustChangePassword: false })
        .then((response) => response),
    )
    const responses = await (async () => {
      try {
        const barrierResult = await Promise.race([
          allCandidatesAtHash.promise.then(() => 'all-candidates-at-hash'),
          Promise.race(pendingResponses).then(() => 'response-completed'),
        ])
        expect(barrierResult).toBe('all-candidates-at-hash')
        expect(arrivedPasswords).toEqual(candidatePasswordSet)
        releaseCandidateHashes.resolve()
        return await Promise.all(pendingResponses)
      }
      finally {
        // 断言失败时也必须释放并收割全部请求，避免悬挂 HTTP/Argon2 任务污染
        // afterEach 或后续 E2E。
        releaseCandidateHashes.resolve()
        await Promise.allSettled(pendingResponses)
        hashSpy.mockRestore()
      }
    })()

    const successfulIndexes = responses
      .map((response, index) => ({ index, status: response.status }))
      .filter(({ status }) => status === 200)
      .map(({ index }) => index)
    expect(successfulIndexes).toHaveLength(1)
    for (const response of responses.filter(({ status }) => status !== 200)) {
      expect(response.status).toBe(409)
      expect(readResponseBody<ApiErrorBody>(response).code).toBe(
        'AUTH_STATE_CHANGED',
      )
    }

    const winningPassword = candidatePasswords[successfulIndexes[0] ?? -1]
    expect(winningPassword).toBeDefined()
    const storedTarget = await prisma.user.findUniqueOrThrow({
      where: { id: target.user.id },
    })
    expect(storedTarget.authVersion).toBe(1)
    await expect(
      passwordProvider.verify(winningPassword ?? '', storedTarget.passwordHash),
    ).resolves.toBe(true)
    await targetBrowser.get('/api/auth/me').expect(401)

    const resetRevocations = await prisma.authSession.count({
      where: {
        userId: target.user.id,
        revokedReason: 'PASSWORD_RESET',
      },
    })
    expect(resetRevocations).toBe(1)
  })
})
