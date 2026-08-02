import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import {
  AuthRateLimitScope,
  SessionRevokedReason,
  UserStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { AuthSubjectHasher } from '../src/modules/auth/providers/auth-subject-hasher'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const MANAGEMENT_PERMISSION_CODES = [
  'audit:read',
  'currencies:create',
  'currencies:disable',
  'currencies:enable',
  'currencies:read',
  'currencies:update',
  'exchange-rates:create',
  'exchange-rates:read',
  'exchange-rates:update',
  'numbering-rules:create',
  'numbering-rules:disable',
  'numbering-rules:enable',
  'numbering-rules:publish',
  'numbering-rules:read',
  'numbering-rules:read-issuances',
  'numbering-rules:update',
  'regions:create',
  'regions:disable',
  'regions:enable',
  'regions:read',
  'regions:update',
  'roles:assign-permissions',
  'roles:create',
  'roles:read',
  'roles:update',
  'users:assign-roles',
  'users:create',
  'users:disable',
  'users:enable',
  'users:read',
  'users:reset-password',
  'users:update',
] as const

interface AuthContextBody {
  user: {
    id: string
    username: string
    displayName: string
    mustChangePassword: boolean
  }
  permissions: string[]
  session: {
    createdAt: string
    lastActivityAt: string
    idleExpiresAt: string
    absoluteExpiresAt: string
  }
}

interface ApiErrorBody {
  code: string
  fieldErrors?: Record<string, string[]>
  message: string
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function readSetCookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie']
  if (!Array.isArray(setCookie)) {
    throw new Error('Expected a Session Set-Cookie header')
  }

  return setCookie
    .filter((value): value is string => typeof value === 'string')
    .join(';')
}

function readSessionId(response: { headers: Record<string, unknown> }): string {
  const cookie = readSetCookie(response)
  const match = /^qianshu_session_dev=([0-9a-f-]{36})\./u.exec(cookie)
  if (match?.[1] === undefined) {
    throw new Error('Expected a Session identifier in Set-Cookie')
  }

  return match[1]
}

function readSessionCookiePair(
  response: { headers: Record<string, unknown> },
): string {
  const pair = readSetCookie(response).split(';', 1)[0]
  if (!pair?.startsWith('qianshu_session_dev=')) {
    throw new Error('Expected a Session cookie pair')
  }

  return pair
}

function createSessionCookie(tokenValue: string): string {
  return `qianshu_session_dev=${tokenValue}`
}

/** 生成落在 8..20 边界内且每次运行不同的测试密码，避免用超长 UUID 破坏场景前置条件。 */
function createTestPassword(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`
}

describe('Auth API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let sessionService: AuthSessionService
  let subjectHasher: AuthSubjectHasher
  let passwordProvider: PasswordProvider
  const createdUserIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    sessionService = application.get(AuthSessionService)
    subjectHasher = application.get(AuthSubjectHasher)
    passwordProvider = application.get(PasswordProvider)
  })

  afterEach(async () => {
    // 登录失败和改密失败都会写限流桶；隔离每个 HTTP 场景，避免同一测试来源 IP
    // 在后续用例中继承前一个用例的失败计数。
    await prisma.authRateLimit.deleteMany()

    if (createdUserIds.length > 0) {
      const userIds = createdUserIds.splice(0)
      // Audit actor 外键使用 RESTRICT 保留身份完整性；测试清理必须先删除本套件事件。
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: userIds } },
      })
      // 禁用场景包含 User 自关联；先恢复为合法 ACTIVE 状态并清空关联，才能稳定清理。
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          status: UserStatus.ACTIVE,
          disabledAt: null,
          disabledByUserId: null,
        },
      })
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      })
    }
  })

  afterAll(async () => {
    await application.close()
  })

  async function createUser(options: { mustChangePassword?: boolean } = {}) {
    const suffix = randomUUID()
    const password = createTestPassword('Init')
    const user = await prisma.user.create({
      data: {
        username: `auth-e2e-${suffix}`,
        usernameNormalized: `auth-e2e-${suffix}`,
        displayName: 'Auth E2E',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    const systemRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await prisma.userRole.create({
      data: { userId: user.id, roleId: systemRole.id },
    })
    createdUserIds.push(user.id)
    return { password, user }
  }

  async function createSessionOnlyUser() {
    const suffix = randomUUID()
    const user = await prisma.user.create({
      data: {
        username: `auth-session-e2e-${suffix}`,
        usernameNormalized: `auth-session-e2e-${suffix}`,
        displayName: 'Auth Session E2E',
        // Guard 用例不走密码登录；使用明确的测试占位值避免无意义 Argon2 成本。
        passwordHash: 'e2e-only-not-a-real-password-hash',
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    createdUserIds.push(user.id)
    return user
  }

  async function issueSession(
    user: Awaited<ReturnType<typeof createSessionOnlyUser>>,
  ) {
    return prisma.$transaction((transaction) =>
      sessionService.createInTransaction(transaction, {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        mustChangePassword: user.mustChangePassword,
        authVersion: user.authVersion,
      }),
    )
  }

  it('logs in, restores /me, rejects a second login and logs out idempotently', async () => {
    const { password, user } = await createUser()
    const browser = request.agent(application.getHttpServer())

    const login = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)

    const loginBody = readResponseBody<AuthContextBody>(login)
    expect(login.headers['cache-control']).toBe('private, no-store')
    expect(loginBody.user).toEqual({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: false,
    })
    expect(loginBody.permissions).toEqual([
      ...MANAGEMENT_PERMISSION_CODES,
    ])
    expect(Object.keys(loginBody).sort()).toEqual([
      'permissions',
      'session',
      'user',
    ])
    expect(Object.keys(loginBody.session).sort()).toEqual([
      'absoluteExpiresAt',
      'createdAt',
      'idleExpiresAt',
      'lastActivityAt',
    ])
    expect(Object.values(loginBody.session).every(
      (value) => typeof value === 'string',
    )).toBe(true)
    expect(Object.keys(loginBody.user)).not.toEqual(
      expect.arrayContaining(['password', 'passwordHash', 'token', 'cookie']),
    )

    const setCookie = login.headers['set-cookie'] as unknown
    expect(Array.isArray(setCookie)).toBe(true)
    const cookieText = Array.isArray(setCookie) ? setCookie.join(';') : ''
    expect(cookieText).toContain('qianshu_session_dev=')
    expect(cookieText).toContain('HttpOnly')
    expect(cookieText).toContain('SameSite=Strict')
    expect(cookieText).toContain('Path=/')
    expect(cookieText).toContain('Max-Age=')
    expect(cookieText).toContain('Expires=')
    expect(cookieText).not.toContain('Domain=')
    expect(cookieText).not.toContain('Secure')
    const sessionId = readSessionId(login)

    const createdAt = Date.parse(loginBody.session.createdAt)
    const idleExpiresAt = Date.parse(loginBody.session.idleExpiresAt)
    const absoluteExpiresAt = Date.parse(
      loginBody.session.absoluteExpiresAt,
    )
    expect(idleExpiresAt - createdAt).toBe(48 * 60 * 60 * 1_000)
    expect(absoluteExpiresAt - createdAt).toBe(30 * 24 * 60 * 60 * 1_000)

    await browser
      .get('/api/auth/me')
      .expect(200)
      .expect((response) => {
        const body = readResponseBody<AuthContextBody>(response)
        expect(body.user.id).toBe(user.id)
        expect(body.permissions).toEqual([
          ...MANAGEMENT_PERMISSION_CODES,
        ])
      })

    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'ALREADY_AUTHENTICATED',
        )
      })

    const logout = await browser
      .post('/api/auth/logout')
      .set(CSRF_HEADERS)
      .send({})
      .expect(204)
    const clearedCookie = readSetCookie(logout)
    expect(clearedCookie).toContain('qianshu_session_dev=')
    expect(clearedCookie).toContain('Max-Age=0')
    const expiresText = /Expires=([^;]+)/u.exec(clearedCookie)?.[1]
    expect(expiresText).toBeDefined()
    // Express 会把 maxAge=0 的 Expires 规范化为响应时刻；关键删除语义是
    // Max-Age=0 且 Expires 不在未来，而不是固定使用某个历史日期。
    expect(Date.parse(expiresText ?? '')).toBeLessThanOrEqual(Date.now())
    expect(clearedCookie).toContain('HttpOnly')
    expect(clearedCookie).toContain('SameSite=Strict')
    expect(clearedCookie).toContain('Path=/')

    const revokedSession = await prisma.authSession.findUniqueOrThrow({
      where: { id: sessionId },
    })
    expect(revokedSession.revokedAt).toBeInstanceOf(Date)
    expect(revokedSession.revokedReason).toBe(SessionRevokedReason.LOGOUT)

    await browser.get('/api/auth/me').expect(401)
    const repeatedLogout = await browser
      .post('/api/auth/logout')
      .set(CSRF_HEADERS)
      .send({})
      .expect(204)
    expect(readSetCookie(repeatedLogout)).toContain('Max-Age=0')

    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).resolves.toMatchObject({
      revokedReason: SessionRevokedReason.LOGOUT,
    })
  })

  it('logs out all Sessions, clears the Cookie and preserves an earlier revoke reason', async () => {
    const { password, user } = await createUser()
    const currentBrowser = request.agent(application.getHttpServer())
    const otherBrowser = request.agent(application.getHttpServer())
    const currentLogin = await currentBrowser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)
    const otherLogin = await otherBrowser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)
    const currentSessionId = readSessionId(currentLogin)
    const otherSessionId = readSessionId(otherLogin)

    await prisma.authSession.update({
      where: { id: otherSessionId },
      data: {
        revokedAt: new Date(),
        revokedReason: SessionRevokedReason.PASSWORD_CHANGED,
      },
    })

    const logoutAll = await currentBrowser
      .post('/api/auth/logout-all')
      .set(CSRF_HEADERS)
      .send({})
      .expect(204)
    expect(readSetCookie(logoutAll)).toContain('Max-Age=0')

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ authVersion: 1 })
    const [currentSession, otherSession] = await Promise.all([
      prisma.authSession.findUniqueOrThrow({
        where: { id: currentSessionId },
      }),
      prisma.authSession.findUniqueOrThrow({ where: { id: otherSessionId } }),
    ])
    expect(currentSession.revokedAt).toBeInstanceOf(Date)
    expect(currentSession.revokedReason).toBe(SessionRevokedReason.LOGOUT_ALL)
    expect(otherSession.revokedAt).toBeInstanceOf(Date)
    expect(otherSession.revokedReason).toBe(
      SessionRevokedReason.PASSWORD_CHANGED,
    )

    await currentBrowser.get('/api/auth/me').expect(401)
    await otherBrowser.get('/api/auth/me').expect(401)
  })

  const invalidSessionScenarios = [
    {
      label: 'an idle-expired Session',
      mutate: async (_userId: string, sessionId: string) => {
        await prisma.authSession.update({
          where: { id: sessionId },
          data: { idleExpiresAt: new Date(Date.now() - 60_000) },
        })
      },
    },
    {
      label: 'an absolutely expired Session',
      mutate: async (_userId: string, sessionId: string) => {
        const expiredAt = new Date(Date.now() - 60_000)
        await prisma.authSession.update({
          where: { id: sessionId },
          data: {
            idleExpiresAt: expiredAt,
            absoluteExpiresAt: expiredAt,
          },
        })
      },
    },
    {
      label: 'a revoked Session',
      mutate: async (_userId: string, sessionId: string) => {
        await prisma.authSession.update({
          where: { id: sessionId },
          data: {
            revokedAt: new Date(),
            revokedReason: SessionRevokedReason.LOGOUT,
          },
        })
      },
    },
    {
      label: 'a disabled User',
      mutate: async (userId: string) => {
        await prisma.user.update({
          where: { id: userId },
          data: {
            status: UserStatus.DISABLED,
            disabledAt: new Date(),
            disabledByUserId: userId,
          },
        })
      },
    },
    {
      label: 'an authVersion mismatch',
      mutate: async (userId: string) => {
        await prisma.user.update({
          where: { id: userId },
          data: { authVersion: { increment: 1 } },
        })
      },
    },
  ] satisfies ReadonlyArray<{
    label: string
    mutate: (userId: string, sessionId: string) => Promise<void>
  }>

  it.each(invalidSessionScenarios)(
    'rejects $label through the HTTP Session Guard',
    async ({ mutate }) => {
      const user = await createSessionOnlyUser()
      const issued = await issueSession(user)
      await mutate(user.id, issued.session.id)

      await request(application.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', createSessionCookie(issued.tokenValue))
        .expect(401)
        .expect((response) => {
          expect(response.headers['cache-control']).toBe('private, no-store')
          expect(readResponseBody<ApiErrorBody>(response)).toMatchObject({
            code: 'AUTHENTICATION_REQUIRED',
            message: '需要登录',
          })
        })
    },
  )

  it('touches activity after five minutes and caps idle expiry at the absolute deadline', async () => {
    const user = await createSessionOnlyUser()
    const issued = await issueSession(user)
    const clockRows = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `
    const databaseNow = clockRows[0]?.now
    if (!(databaseNow instanceof Date)) {
      throw new Error('Expected the PostgreSQL clock')
    }

    const oldActivity = new Date(databaseNow.getTime() - 6 * 60 * 1_000)
    const oldIdleExpiry = new Date(databaseNow.getTime() + 60 * 1_000)
    const absoluteExpiry = new Date(databaseNow.getTime() + 10 * 60 * 1_000)
    await prisma.authSession.update({
      where: { id: issued.session.id },
      data: {
        lastActivityAt: oldActivity,
        idleExpiresAt: oldIdleExpiry,
        absoluteExpiresAt: absoluteExpiry,
      },
    })

    await request(application.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', createSessionCookie(issued.tokenValue))
      .expect(200)

    const touched = await prisma.authSession.findUniqueOrThrow({
      where: { id: issued.session.id },
    })
    expect(touched.lastActivityAt.getTime()).toBeGreaterThan(
      oldActivity.getTime(),
    )
    expect(touched.idleExpiresAt).toEqual(absoluteExpiry)
  })

  it('requires the current password and atomically rotates a normal Session', async () => {
    const { password, user } = await createUser()
    const browser = request.agent(application.getHttpServer())
    const login = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)
    const oldSessionId = readSessionId(login)
    const oldCookie = readSessionCookiePair(login)
    const newPassword = createTestPassword('Normal')

    const wrongCurrent = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ currentPassword: createTestPassword('Wrong'), newPassword })
      .expect(422)
    expect(readResponseBody<ApiErrorBody>(wrongCurrent)).toMatchObject({
      code: 'CURRENT_PASSWORD_INVALID',
      message: '当前密码错误',
      fieldErrors: { currentPassword: ['当前密码错误'] },
    })
    expect(wrongCurrent.headers['set-cookie']).toBeUndefined()

    const samePassword = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ currentPassword: password, newPassword: password })
      .expect(422)
    expect(readResponseBody<ApiErrorBody>(samePassword)).toMatchObject({
      code: 'PASSWORD_MUST_DIFFER',
      message: '新密码必须与当前密码不同',
      fieldErrors: { newPassword: ['新密码必须与当前密码不同'] },
    })

    const weakPassword = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ currentPassword: password, newPassword: '1234567' })
      .expect(422)
    expect(readResponseBody<ApiErrorBody>(weakPassword)).toMatchObject({
      code: 'PASSWORD_POLICY_VIOLATION',
      message: '密码不符合要求',
      fieldErrors: { newPassword: ['密码不符合要求'] },
    })

    const changed = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ currentPassword: password, newPassword })
      .expect(200)
    const newSessionId = readSessionId(changed)
    expect(newSessionId).not.toBe(oldSessionId)
    expect(
      readResponseBody<AuthContextBody>(changed).user.mustChangePassword,
    ).toBe(false)

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ authVersion: 1, mustChangePassword: false })
    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    })
    await expect(
      passwordProvider.verify(newPassword, storedUser.passwordHash),
    ).resolves.toBe(true)
    const revokedOldSession = await prisma.authSession.findUniqueOrThrow({
      where: { id: oldSessionId },
    })
    expect(revokedOldSession.revokedAt).toBeInstanceOf(Date)
    expect(revokedOldSession.revokedReason).toBe(
      SessionRevokedReason.PASSWORD_CHANGED,
    )
    await expect(
      prisma.authSession.findUniqueOrThrow({ where: { id: newSessionId } }),
    ).resolves.toMatchObject({
      authVersion: 1,
      revokedAt: null,
      revokedReason: null,
    })

    await request(application.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(401)
    await browser.get('/api/auth/me').expect(200)
  })

  it('rotates a forced-change Session without requiring the administrator-set password again', async () => {
    const { password, user } = await createUser({ mustChangePassword: true })
    const browser = request.agent(application.getHttpServer())
    const newPassword = createTestPassword('Forced')

    const login = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<AuthContextBody>(response).user.mustChangePassword,
        ).toBe(true)
      })
    const oldSessionId = readSessionId(login)
    const oldCookie = readSessionCookiePair(login)

    const changed = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ newPassword })
      .expect(200)
    expect(
      readResponseBody<AuthContextBody>(changed).user.mustChangePassword,
    ).toBe(false)
    const newSessionId = readSessionId(changed)
    expect(newSessionId).not.toBe(oldSessionId)

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    })
    expect(storedUser.authVersion).toBe(1)
    expect(storedUser.mustChangePassword).toBe(false)
    await expect(
      passwordProvider.verify(newPassword, storedUser.passwordHash),
    ).resolves.toBe(true)

    const activeSessions = await prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null },
    })
    const revokedSessions = await prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: { not: null } },
    })
    expect(activeSessions).toHaveLength(1)
    expect(revokedSessions).toHaveLength(1)
    expect(revokedSessions[0]?.revokedReason).toBe('PASSWORD_CHANGED')
    expect(activeSessions[0]?.id).toBe(newSessionId)
    expect(revokedSessions[0]?.id).toBe(oldSessionId)

    await request(application.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(401)
    await browser.get('/api/auth/me').expect(200)
  })

  it('uses one fixed failure for unknown, wrong-password and disabled accounts', async () => {
    const { password, user } = await createUser()

    const wrongPassword = await request(application.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({
        username: user.username,
        password: createTestPassword('Wrong'),
      })
      .expect(401)
    const unknownAccount = await request(application.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: `unknown-${randomUUID()}`, password })
      .expect(401)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.DISABLED,
        disabledAt: new Date(),
        disabledByUserId: user.id,
      },
    })
    const disabledAccount = await request(application.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(401)

    for (const response of [wrongPassword, unknownAccount, disabledAccount]) {
      expect(readResponseBody<ApiErrorBody>(response)).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: '用户名或密码错误',
      })
      expect(response.headers['set-cookie']).toBeUndefined()
    }
  })

  it('returns the fixed login rate-limit response before creating a Session', async () => {
    const blockedUsername = `blocked-${randomUUID()}`
    const databaseNow = new Date()
    await prisma.authRateLimit.create({
      data: {
        scope: AuthRateLimitScope.LOGIN_USERNAME,
        subjectKeyHash: Uint8Array.from(
          subjectHasher.hashUsername(blockedUsername),
        ),
        bucketStartedAt: databaseNow,
        attemptCount: 5,
        blockedUntil: new Date(databaseNow.getTime() + 15 * 60 * 1_000),
      },
    })

    const blocked = await request(application.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({
        username: blockedUsername,
        password: createTestPassword('Any'),
      })
      .expect(429)
    expect(readResponseBody<ApiErrorBody>(blocked)).toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      message: '操作过于频繁，请稍后重试',
    })
    expect(blocked.headers['set-cookie']).toBeUndefined()
    await expect(
      prisma.authSession.count({
        where: { user: { usernameNormalized: blockedUsername } },
      }),
    ).resolves.toBe(0)
  })

  it('admits only five concurrent wrong-password requests into Argon2 and rolls back the rejected IP reservations', async () => {
    const { user } = await createUser()
    const verifySpy = jest.spyOn(passwordProvider, 'verify')

    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(application.getHttpServer())
            .post('/api/auth/login')
            .set(CSRF_HEADERS)
            .send({
              username: user.username,
              password: createTestPassword('Wrong'),
            }),
        ),
      )

      expect(responses.filter(response => response.status === 401)).toHaveLength(5)
      expect(responses.filter(response => response.status === 429)).toHaveLength(5)
      expect(verifySpy).toHaveBeenCalledTimes(5)

      const buckets = await prisma.authRateLimit.findMany()
      expect(buckets).toHaveLength(2)
      expect(
        buckets.find(
          bucket => bucket.scope === AuthRateLimitScope.LOGIN_USERNAME,
        ),
      ).toMatchObject({ attemptCount: 5 })
      // 被 username 桶拒绝的五个事务不得只留下 LOGIN_IP 的半次预占。
      expect(
        buckets.find(bucket => bucket.scope === AuthRateLimitScope.LOGIN_IP),
      ).toMatchObject({ attemptCount: 5 })
    } finally {
      verifySpy.mockRestore()
    }
  })

  it('rejects a login without CSRF proof and does not set a Session Cookie', async () => {
    const { password, user } = await createUser()

    const rejected = await request(application.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password })
      .expect(403)
    expect(readResponseBody<ApiErrorBody>(rejected).code).toBe('CSRF_REJECTED')
    expect(rejected.headers['set-cookie']).toBeUndefined()
  })

  it('rejects every authenticated auth mutation without CSRF proof before changing state', async () => {
    const { password, user } = await createUser()
    const browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)

    const passwordChange = await browser
      .post('/api/auth/password/change')
      .send({
        currentPassword: password,
        newPassword: createTestPassword('Reject'),
      })
      .expect(403)
    expect(readResponseBody<ApiErrorBody>(passwordChange).code).toBe(
      'CSRF_REJECTED',
    )

    for (const endpoint of ['/api/auth/logout', '/api/auth/logout-all']) {
      const rejected = await browser.post(endpoint).send({}).expect(403)
      expect(readResponseBody<ApiErrorBody>(rejected).code).toBe('CSRF_REJECTED')
    }

    // 三个拒绝请求都不得改密、推进版本或撤销当前 Session。
    const persistedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    })
    expect(persistedUser.authVersion).toBe(0)
    await expect(
      passwordProvider.verify(password, persistedUser.passwordHash),
    ).resolves.toBe(true)
    await expect(
      prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).resolves.toBe(1)
    await browser.get('/api/auth/me').expect(200)
  })
})
