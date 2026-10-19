import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { AuditEventType, UserStatus } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'user-fund-account-e2e-'

interface ApiErrorBody {
  code: string
}

interface UserBody {
  id: string
  username: string
  status: 'ACTIVE' | 'DISABLED'
}

function readResponseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function createTestPassword(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`
}

/**
 * 成功开户会在 fund_accounts 留下受数据库触发器保护的不可删除事实。
 * 本 spec 与 management-api 套件分开，清理时只针对本次创建的账户临时禁用
 * 删除触发器，确保全量 e2e 不会污染其他需要“空用户账户”的断言。
 */
describe('User creation with optional fund account', () => {
  let application: INestApplication
  let prisma: PrismaService
  let passwordProvider: PasswordProvider
  const createdUserIds = new Set<string>()
  const createdAccountIds = new Set<string>()

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

  afterAll(async () => {
    try {
      if (createdAccountIds.size > 0) {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "fund_accounts" DISABLE TRIGGER "fund_accounts_identity_immutable_trigger"',
        )
        try {
          await prisma.fundAccount.deleteMany({
            where: { id: { in: [...createdAccountIds] } },
          })
        }
        finally {
          await prisma.$executeRawUnsafe(
            'ALTER TABLE "fund_accounts" ENABLE TRIGGER "fund_accounts_identity_immutable_trigger"',
          )
        }
      }

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
    }
    finally {
      await application.close()
    }
  })

  async function createAdministrator(): Promise<{
    password: string
    userId: string
  }> {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}admin-${suffix}`
    const password = createTestPassword('Admin')
    const admin = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username.toLowerCase(),
        displayName: 'User fund account E2E Admin',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
      select: { id: true },
    })
    createdUserIds.add(admin.id)
    const systemAdminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: systemAdminRole.id },
    })

    return { password, userId: admin.id }
  }

  async function login(username: string, password: string) {
    const browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
    return browser
  }

  it('creates the user, account and both audits in one request', async () => {
    const administrator = await createAdministrator()
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { id: administrator.userId },
      select: { username: true },
    })
    const browser = await login(adminUser.username, administrator.password)

    const suffix = randomUUID()
    const response = await browser
      .post('/api/users')
      .set(CSRF_HEADERS)
      .send({
        username: `${USERNAME_PREFIX}created-${suffix}`,
        displayName: '带资金账户的用户',
        password: createTestPassword('Created'),
        mustChangePassword: false,
        fundAccount: { userShareRate: '30.5' },
      })
      .expect(201)
    const created = readResponseBody<UserBody>(response)
    createdUserIds.add(created.id)

    const account = await prisma.fundAccount.findUniqueOrThrow({
      where: { userId: created.id },
    })
    createdAccountIds.add(account.id)
    expect(account.ownerType).toBe('USER')
    expect(account.currency).toBe('CNY')
    expect(account.balance.toFixed(2)).toBe('0.00')
    expect(account.userShareRate?.toFixed(2)).toBe('30.50')
    expect(account.nextSequence).toBe(1n)
    expect(account.version).toBe(1)
    expect(account.shareRateUpdatedAt).not.toBeNull()

    const accountAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        eventType: AuditEventType.FUND_ACCOUNT_CREATED,
        targetId: account.id,
      },
    })
    expect(accountAudit.metadata).toEqual({
      userId: created.id,
      userShareRate: '30.50',
    })
    const userAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        eventType: AuditEventType.USER_CREATED,
        targetId: created.id,
      },
    })
    expect(userAudit.actorUserId).toBe(administrator.userId)
  })

  it('rejects an invalid share rate without creating the user', async () => {
    const administrator = await createAdministrator()
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { id: administrator.userId },
      select: { username: true },
    })
    const browser = await login(adminUser.username, administrator.password)

    const username = `${USERNAME_PREFIX}invalid-${randomUUID()}`
    await browser
      .post('/api/users')
      .set(CSRF_HEADERS)
      .send({
        username,
        displayName: '比例非法的用户',
        password: createTestPassword('Invalid'),
        mustChangePassword: false,
        fundAccount: { userShareRate: '30.555' },
      })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'VALIDATION_FAILED',
        )
      })

    await expect(
      prisma.user.count({
        where: { usernameNormalized: username.toLowerCase() },
      }),
    ).resolves.toBe(0)
  })

  it('creates only the user when the optional account is omitted', async () => {
    const administrator = await createAdministrator()
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { id: administrator.userId },
      select: { username: true },
    })
    const browser = await login(adminUser.username, administrator.password)

    const response = await browser
      .post('/api/users')
      .set(CSRF_HEADERS)
      .send({
        username: `${USERNAME_PREFIX}plain-${randomUUID()}`,
        displayName: '不带资金账户的用户',
        password: createTestPassword('Plain'),
        mustChangePassword: false,
      })
      .expect(201)
    const created = readResponseBody<UserBody>(response)
    createdUserIds.add(created.id)

    await expect(
      prisma.fundAccount.findUnique({ where: { userId: created.id } }),
    ).resolves.toBeNull()
  })
})
