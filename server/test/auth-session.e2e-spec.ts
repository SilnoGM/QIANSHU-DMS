import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import { SessionRevokedReason } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { SessionTokenProvider } from '../src/modules/auth/providers/session-token.provider'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

describe('AuthSessionService against PostgreSQL', () => {
  let prisma: PrismaService
  let service: AuthSessionService
  const createdUserIds: string[] = []

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    await prisma.onModuleInit()
    service = new AuthSessionService(prisma, new SessionTokenProvider())
  })

  afterEach(async () => {
    if (createdUserIds.length === 0) {
      return
    }

    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds.splice(0) } },
    })
  })

  afterAll(async () => {
    await prisma.onModuleDestroy()
  })

  async function createUser() {
    const suffix = randomUUID()
    const user = await prisma.user.create({
      data: {
        username: `session-e2e-${suffix}`,
        usernameNormalized: `session-e2e-${suffix}`,
        displayName: 'Session E2E',
        passwordHash: 'e2e-only-not-a-real-password-hash',
        passwordChangedAt: new Date(),
      },
    })
    createdUserIds.push(user.id)
    return user
  }

  it('creates, authenticates and revokes an opaque session', async () => {
    const user = await createUser()
    const issued = await prisma.$transaction((transaction) =>
      service.createInTransaction(transaction, user),
    )

    expect(issued.tokenValue).not.toContain(user.id)
    expect(
      issued.session.idleExpiresAt.getTime() -
        issued.session.createdAt.getTime(),
    ).toBe(48 * 60 * 60 * 1_000)
    expect(
      issued.session.absoluteExpiresAt.getTime() -
        issued.session.createdAt.getTime(),
    ).toBe(30 * 24 * 60 * 60 * 1_000)

    await expect(service.authenticate(issued.tokenValue)).resolves.toMatchObject({
      id: issued.session.id,
      userId: user.id,
      username: user.username,
    })

    await expect(
      service.revokeSession(
        issued.session.id,
        SessionRevokedReason.LOGOUT,
      ),
    ).resolves.toBe(true)
    await expect(service.authenticate(issued.tokenValue)).resolves.toBeNull()
    await expect(
      service.revokeSession(
        issued.session.id,
        SessionRevokedReason.LOGOUT,
      ),
    ).resolves.toBe(false)
  })

  it('serializes concurrent activity touch and respects a no-touch validation', async () => {
    const user = await createUser()
    const issued = await prisma.$transaction((transaction) =>
      service.createInTransaction(transaction, user),
    )
    const oldActivity = new Date(
      issued.session.createdAt.getTime() - 6 * 60 * 1_000,
    )

    await prisma.authSession.update({
      where: { id: issued.session.id },
      data: { lastActivityAt: oldActivity },
    })

    await service.validateWithoutTouch(issued.tokenValue)
    const beforeConcurrentAuthentication = await prisma.authSession.findUniqueOrThrow({
      where: { id: issued.session.id },
    })
    expect(beforeConcurrentAuthentication.lastActivityAt).toEqual(oldActivity)

    const [first, second] = await Promise.all([
      service.authenticate(issued.tokenValue),
      service.authenticate(issued.tokenValue),
    ])

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first?.lastActivityAt.getTime()).toBeGreaterThan(
      oldActivity.getTime(),
    )
    // 第二个事务取得行锁后会读取第一个事务已写入的活动时间，因此不会再次 touch。
    expect(second?.lastActivityAt).toEqual(first?.lastActivityAt)
  })

  it('invalidates existing sessions when authVersion or user status changes', async () => {
    const user = await createUser()
    const issued = await prisma.$transaction((transaction) =>
      service.createInTransaction(transaction, user),
    )

    await prisma.user.update({
      where: { id: user.id },
      data: { authVersion: { increment: 1 } },
    })
    await expect(service.authenticate(issued.tokenValue)).resolves.toBeNull()
  })
})
