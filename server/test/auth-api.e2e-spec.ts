import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const MANAGEMENT_PERMISSION_CODES = [
  'audit:read',
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
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

describe('Auth API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
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
    passwordProvider = application.get(PasswordProvider)
  })

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      const userIds = createdUserIds.splice(0)
      // Audit actor 外键使用 RESTRICT 保留身份完整性；测试清理必须先删除本套件事件。
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: userIds } },
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
    const password = `Initial secure password ${suffix}`
    const user = await prisma.user.create({
      data: {
        username: `auth-e2e-${suffix}`,
        usernameNormalized: `auth-e2e-${suffix}`,
        displayName: 'Auth E2E',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
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

  it('logs in, restores /me, rejects a second login and logs out idempotently', async () => {
    const { password, user } = await createUser()
    const browser = request.agent(application.getHttpServer())

    const login = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)

    const loginBody = readResponseBody<AuthContextBody>(login)
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

    await browser
      .post('/api/auth/logout')
      .set(CSRF_HEADERS)
      .send({})
      .expect(204)
    await browser.get('/api/auth/me').expect(401)
    await browser
      .post('/api/auth/logout')
      .set(CSRF_HEADERS)
      .send({})
      .expect(204)
  })

  it('rotates a forced-change Session without requiring the administrator-set password again', async () => {
    const { password, user } = await createUser({ mustChangePassword: true })
    const browser = request.agent(application.getHttpServer())
    const newPassword = `Replacement secure password ${randomUUID()}`

    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password })
      .expect(200)
      .expect((response) => {
        expect(
          readResponseBody<AuthContextBody>(response).user.mustChangePassword,
        ).toBe(true)
      })

    const changed = await browser
      .post('/api/auth/password/change')
      .set(CSRF_HEADERS)
      .send({ newPassword })
      .expect(200)
    expect(
      readResponseBody<AuthContextBody>(changed).user.mustChangePassword,
    ).toBe(false)

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

    await browser.get('/api/auth/me').expect(200)
  })

  it('uses fixed credential and CSRF failures without setting a Session Cookie', async () => {
    const { password, user } = await createUser()

    const invalidCredentials = await request(application.getHttpServer())
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: user.username, password: `${password} wrong` })
      .expect(401)
    expect(readResponseBody<ApiErrorBody>(invalidCredentials).code).toBe(
      'INVALID_CREDENTIALS',
    )
    expect(invalidCredentials.headers['set-cookie']).toBeUndefined()

    await request(application.getHttpServer())
      .post('/api/auth/login')
      .send({ username: user.username, password })
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'CSRF_REJECTED',
        )
      })
  })
})
