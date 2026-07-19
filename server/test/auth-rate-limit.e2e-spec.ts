import { randomBytes } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import { AuthRateLimitScope } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { ApiException } from '../src/infrastructure/http/api.exception'
import {
  type AuthRateLimitReservation,
  AuthRateLimitService,
} from '../src/modules/auth/providers/auth-rate-limit.service'

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

  it('atomically admits only five concurrent username attempts without leaving a partial IP reservation', async () => {
    const usernameHash = createSubjectHash()
    const ipHash = createSubjectHash()
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.reserveAttempts([
          {
            scope: AuthRateLimitScope.LOGIN_USERNAME,
            subjectKeyHash: usernameHash,
          },
          {
            scope: AuthRateLimitScope.LOGIN_IP,
            subjectKeyHash: ipHash,
          },
        ]),
      ),
    )

    const admitted = results
      .filter(
        (result): result is PromiseFulfilledResult<AuthRateLimitReservation> =>
          result.status === 'fulfilled',
      )
      .map(result => result.value)
    const rejected = results.filter(result => result.status === 'rejected')
    expect(admitted).toHaveLength(5)
    expect(rejected).toHaveLength(5)
    for (const result of rejected) {
      expect(result.status === 'rejected' ? result.reason : undefined)
        .toBeInstanceOf(ApiException)
      expect(result.status === 'rejected' ? result.reason : undefined)
        .toMatchObject({ code: 'AUTH_RATE_LIMITED' })
    }

    const usernameBucket = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(usernameHash),
        },
      },
    })
    const ipBucket = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_IP,
          subjectKeyHash: Uint8Array.from(ipHash),
        },
      },
    })
    expect(usernameBucket.attemptCount).toBe(5)
    expect(usernameBucket.blockedUntil).not.toBeNull()
    // 五个被拒事务若留下部分写入，这里会大于五。
    expect(ipBucket.attemptCount).toBe(5)

    await service.releaseReservation(admitted[0])

    const releasedUsernameBucket = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(usernameHash),
        },
      },
    })
    const releasedIpBucket = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_IP,
          subjectKeyHash: Uint8Array.from(ipHash),
        },
      },
    })
    expect(releasedUsernameBucket.attemptCount).toBe(4)
    expect(releasedUsernameBucket.blockedUntil).toBeNull()
    expect(releasedIpBucket.attemptCount).toBe(4)
  })

  it('resets an expired fixed window and a release only removes its own reservation', async () => {
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

    const reservation = await service.reserveAttempts([
      {
        scope: AuthRateLimitScope.LOGIN_USERNAME,
        subjectKeyHash: subjectHash,
      },
    ])

    const reserved = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(subjectHash),
        },
      },
    })
    expect(reserved.attemptCount).toBe(1)
    expect(reserved.blockedUntil).toBeNull()

    await service.releaseReservation(reservation)

    const released = await prisma.authRateLimit.findUniqueOrThrow({
      where: {
        scope_subjectKeyHash: {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: Uint8Array.from(subjectHash),
        },
      },
    })
    expect(released.attemptCount).toBe(0)
    expect(released.blockedUntil).toBeNull()
  })
})
