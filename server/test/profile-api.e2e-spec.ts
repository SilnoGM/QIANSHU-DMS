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
import {
  AuditService,
  type RecordAuditEventInput,
} from '../src/modules/audit/audit.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'profile-api-e2e-'

interface ApiErrorBody {
  code: string
  fieldErrors?: Record<string, string[]>
}

interface AuthContextBody {
  permissions: string[]
  user: {
    id: string
    mustChangePassword: boolean
  }
}

interface ProfileBody {
  userId: string
  email: string | null
  mobileE164: string | null
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function createTestPassword(): string {
  return `Profile-${randomUUID().slice(0, 8)}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

describe('Profile API with Cookie Session and PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let audit: AuditService
  const createdUserIds = new Set<string>()
  let auditSpy: jest.SpyInstance | undefined

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

  async function createUser(options: { mustChangePassword?: boolean } = {}) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = createTestPassword()
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: 'Profile API E2E',
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

  it('requires Session but no management permission, and supports exact GET/PATCH/null-clear with PII-free Audit', async () => {
    await request(application.getHttpServer())
      .get('/api/profile')
      .expect(401)
      .expect((response) => {
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'AUTHENTICATION_REQUIRED',
        )
      })
    await request(application.getHttpServer())
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: null })
      .expect(401)

    const { password, user } = await createUser()
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await login(browser, user.username, password)
    expect(readResponseBody<AuthContextBody>(loginResponse).permissions).toEqual(
      [],
    )
    await browser.get('/api/users').expect(403)

    const initialResponse = await browser.get('/api/profile').expect(200)
    const initial = readResponseBody<ProfileBody>(initialResponse)
    expect(Object.keys(initial).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'mobileE164',
      'updatedAt',
      'userId',
    ])
    expect(initial).toMatchObject({
      userId: user.id,
      email: null,
      mobileE164: null,
      avatarUrl: null,
    })
    expect(initial).not.toHaveProperty('remark')
    expect(initial).not.toHaveProperty('emailNormalized')

    const patchResponse = await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({
        mobileE164: '+8613812345678',
        email: ' E2E.User@Example.COM ',
        avatarUrl: 'https://cdn.example.com/profile-e2e.png',
      })
      .expect(200)
    const updated = readResponseBody<ProfileBody>(patchResponse)
    expect(Object.keys(updated).sort()).toEqual(Object.keys(initial).sort())
    expect(updated).toMatchObject({
      userId: user.id,
      email: 'E2E.User@Example.COM',
      mobileE164: '+8613812345678',
      avatarUrl: 'https://cdn.example.com/profile-e2e.png',
    })

    const stored = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: user.id },
    })
    expect(stored.emailNormalized).toBe('e2e.user@example.com')
    const auditEvent = await prisma.auditEvent.findFirstOrThrow({
      where: {
        actorUserId: user.id,
        targetId: user.id,
        eventType: AuditEventType.USER_UPDATED,
      },
      orderBy: { occurredAt: 'desc' },
    })
    expect(auditEvent.metadata).toEqual({
      changedFields: 'avatarUrl,email,mobileE164',
    })
    const serializedAudit = JSON.stringify(auditEvent.metadata)
    expect(serializedAudit).not.toContain('E2E.User')
    expect(serializedAudit).not.toContain('+8613812345678')
    expect(serializedAudit).not.toContain('cdn.example.com')

    await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ email: null, mobileE164: null, avatarUrl: null })
      .expect(200)
      .expect((response) => {
        expect(readResponseBody<ProfileBody>(response)).toMatchObject({
          email: null,
          mobileE164: null,
          avatarUrl: null,
        })
      })
  })

  it('enforces CSRF and DTO allowlists before changing persisted Profile data', async () => {
    const { password, user } = await createUser()
    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { avatarUrl: 'https://cdn.example.com/baseline.png' },
    })
    const browser = request.agent(application.getHttpServer())
    await login(browser, user.username, password)

    await browser
      .patch('/api/profile')
      .send({ avatarUrl: 'https://cdn.example.com/rejected.png' })
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'CSRF_REJECTED',
        )
      })
    await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ email: 'user@example.com', remark: 'forbidden' })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'VALIDATION_FAILED',
        )
      })
    await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({})
      .expect(422)

    await expect(
      prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } }),
    ).resolves.toMatchObject({
      email: null,
      avatarUrl: 'https://cdn.example.com/baseline.png',
      remark: null,
    })
    await expect(
      prisma.auditEvent.count({
        where: {
          actorUserId: user.id,
          eventType: AuditEventType.USER_UPDATED,
        },
      }),
    ).resolves.toBe(0)
  })

  it('keeps forced-password-change Sessions outside both Profile operations', async () => {
    const { password, user } = await createUser({ mustChangePassword: true })
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await login(browser, user.username, password)
    expect(
      readResponseBody<AuthContextBody>(loginResponse).user.mustChangePassword,
    ).toBe(true)

    for (const response of [
      await browser.get('/api/profile').expect(403),
      await browser
        .patch('/api/profile')
        .set(CSRF_HEADERS)
        .send({ avatarUrl: null })
        .expect(403),
    ]) {
      expect(readResponseBody<ApiErrorBody>(response).code).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      )
    }
  })

  it('maps real Prisma 7 PostgreSQL P2002 field metadata and rolls back every conflicting field', async () => {
    const owner = await createUser()
    const target = await createUser()
    await prisma.userProfile.update({
      where: { userId: owner.user.id },
      data: {
        email: 'owner@example.com',
        emailNormalized: 'owner@example.com',
        mobileE164: '+8613800000000',
      },
    })
    await prisma.userProfile.update({
      where: { userId: target.user.id },
      data: { avatarUrl: 'https://cdn.example.com/baseline.png' },
    })

    const rawConflict = await prisma.userProfile
      .update({
        where: { userId: target.user.id },
        data: {
          email: 'owner@example.com',
          emailNormalized: 'owner@example.com',
        },
      })
      .catch((error: unknown) => error)
    const rawRecord = asRecord(rawConflict)
    const meta = asRecord(rawRecord?.meta)
    const adapterError = asRecord(meta?.driverAdapterError)
    const cause = asRecord(adapterError?.cause)
    const constraint = asRecord(cause?.constraint)
    expect(rawRecord?.code).toBe('P2002')
    expect(cause?.kind).toBe('UniqueConstraintViolation')
    expect(constraint?.fields).toEqual(['email_normalized'])

    const browser = request.agent(application.getHttpServer())
    await login(browser, target.user.username, target.password)
    await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({
        email: 'owner@example.com',
        avatarUrl: 'https://cdn.example.com/must-roll-back.png',
      })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'EMAIL_ALREADY_EXISTS',
        )
      })
    await browser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({
        mobileE164: '+8613800000000',
        avatarUrl: 'https://cdn.example.com/must-also-roll-back.png',
      })
      .expect(409)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'MOBILE_ALREADY_EXISTS',
        )
      })

    await expect(
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: target.user.id },
      }),
    ).resolves.toMatchObject({
      email: null,
      emailNormalized: null,
      mobileE164: null,
      avatarUrl: 'https://cdn.example.com/baseline.png',
    })
    await expect(
      prisma.auditEvent.count({
        where: {
          actorUserId: target.user.id,
          eventType: AuditEventType.USER_UPDATED,
        },
      }),
    ).resolves.toBe(0)
  })

  it('rolls back Profile when Audit fails and treats missing Profile as invariant damage', async () => {
    const auditFailureUser = await createUser()
    await prisma.userProfile.update({
      where: { userId: auditFailureUser.user.id },
      data: { avatarUrl: 'https://cdn.example.com/baseline.png' },
    })
    const auditFailureBrowser = request.agent(application.getHttpServer())
    await login(
      auditFailureBrowser,
      auditFailureUser.user.username,
      auditFailureUser.password,
    )

    const originalRecord = audit.record.bind(audit)
    auditSpy = jest.spyOn(audit, 'record').mockImplementation(
      (transaction, input: RecordAuditEventInput) => {
        if (
          input.eventType === AuditEventType.USER_UPDATED
          && input.targetId === auditFailureUser.user.id
        ) {
          return Promise.reject(new Error('injected audit failure'))
        }
        return originalRecord(transaction, input)
      },
    )
    await auditFailureBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: 'https://cdn.example.com/must-roll-back.png' })
      .expect(500)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'INTERNAL_ERROR',
        )
      })
    auditSpy.mockRestore()
    auditSpy = undefined
    await expect(
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: auditFailureUser.user.id },
      }),
    ).resolves.toMatchObject({
      avatarUrl: 'https://cdn.example.com/baseline.png',
    })

    const missingProfileUser = await createUser()
    const missingProfileBrowser = request.agent(application.getHttpServer())
    await login(
      missingProfileBrowser,
      missingProfileUser.user.username,
      missingProfileUser.password,
    )
    await prisma.userProfile.delete({
      where: { userId: missingProfileUser.user.id },
    })
    for (const response of [
      await missingProfileBrowser.get('/api/profile').expect(500),
      await missingProfileBrowser
        .patch('/api/profile')
        .set(CSRF_HEADERS)
        .send({ avatarUrl: null })
        .expect(500),
    ]) {
      expect(readResponseBody<ApiErrorBody>(response).code).toBe(
        'INTERNAL_ERROR',
      )
    }
  })
})
