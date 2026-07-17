import { randomBytes } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import { AuthRateLimitScope } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { ApiException } from '../src/infrastructure/http/api.exception'
import { AuthRateLimitService } from '../src/modules/auth/providers/auth-rate-limit.service'

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL

  if (!value) {
    throw new Error('DATABASE_URL is required for E2E tests')
  }

  return value
}

describe('AuthRateLimitService against PostgreSQL', () => {
  let prisma: PrismaService
  let service: AuthRateLimitService
  const subjectHashes: Uint8Array<ArrayBuffer>[] = []

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    await prisma.onModuleInit()
    service = new AuthRateLimitService(prisma)
  })

  afterEach(async () => {
    if (subjectHashes.length === 0) {
      return
    }

    await prisma.authRateLimit.deleteMany({
      where: { subjectKeyHash: { in: subjectHashes.splice(0) } },
    })
  })

  afterAll(async () => {
    await prisma.onModuleDestroy()
  })

  function createSubjectHash(): Buffer {
    const subjectHash = randomBytes(32)
    subjectHashes.push(Uint8Array.from(subjectHash))
    return subjectHash
  }

  it('atomically blocks a username after five concurrent failures and clears it', async () => {
    const subjectHash = createSubjectHash()

    await service.assertAllowed(
      AuthRateLimitScope.LOGIN_USERNAME,
      subjectHash,
    )
    await Promise.all(
      Array.from({ length: 5 }, () =>
        service.recordFailure(
          AuthRateLimitScope.LOGIN_USERNAME,
          subjectHash,
        ),
      ),
    )

    const stored = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(subjectHash),
        },
      },
    })
    expect(stored.attemptCount).toBe(5)
    expect(stored.blockedUntil).not.toBeNull()

    const blocked = await service
      .assertAllowed(AuthRateLimitScope.LOGIN_USERNAME, subjectHash)
      .catch((error: unknown) => error)
    expect(blocked).toBeInstanceOf(ApiException)
    expect(blocked).toMatchObject({ code: 'AUTH_RATE_LIMITED' })

    await service.clear(AuthRateLimitScope.LOGIN_USERNAME, subjectHash)
    await expect(
      service.assertAllowed(
        AuthRateLimitScope.LOGIN_USERNAME,
        subjectHash,
      ),
    ).resolves.toBeUndefined()
  })

  it('resets an expired fixed window instead of carrying old attempts forward', async () => {
    const subjectHash = createSubjectHash()
    await prisma.$executeRaw`
      INSERT INTO auth_rate_limits (
        scope,
        subject_key_hash,
        bucket_started_at,
        attempt_count,
        updated_at
      )
      VALUES (
        'LOGIN_USERNAME',
        ${subjectHash},
        clock_timestamp() - INTERVAL '16 minutes',
        4,
        clock_timestamp() - INTERVAL '16 minutes'
      )
    `

    await service.recordFailure(
      AuthRateLimitScope.LOGIN_USERNAME,
      subjectHash,
    )

    const stored = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(subjectHash),
        },
      },
    })
    expect(stored.attemptCount).toBe(1)
    expect(stored.blockedUntil).toBeNull()
    await expect(
      service.assertAllowed(
        AuthRateLimitScope.LOGIN_USERNAME,
        subjectHash,
      ),
    ).resolves.toBeUndefined()
  })
})
