import { HttpStatus } from '@nestjs/common'

import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { AuditService } from '../audit/audit.service'
import { UserProfileService } from './user-profile.service'

const USER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const REQUEST_ID = 'req-profile-1'
const CREATED_AT = new Date('2026-07-20T01:00:00.000Z')
const UPDATED_AT = new Date('2026-07-20T02:00:00.000Z')

interface ProfileRow {
  userId: string
  email: string | null
  mobileE164: string | null
  avatarUrl: string | null
  createdAt: Date
  updatedAt: Date
}

type AsyncMock = jest.Mock<Promise<unknown>, [unknown]>

interface TransactionFixture {
  $queryRaw: AsyncMock
  userProfile: {
    update: AsyncMock
  }
}

interface PrismaFixture {
  userProfile: {
    findUnique: AsyncMock
  }
  $transaction: jest.Mock<
    Promise<unknown>,
    [(transaction: TransactionFixture) => Promise<unknown>]
  >
}

interface AuditFixture {
  record: jest.Mock<Promise<unknown>, [unknown, unknown]>
}

function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    userId: USER_ID,
    email: 'User@Example.COM',
    mobileE164: '+8613812345678',
    avatarUrl: 'https://cdn.example.com/avatar.png',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

function createFixture() {
  const asyncMock = (): AsyncMock =>
    jest.fn<Promise<unknown>, [unknown]>()
  const transaction: TransactionFixture = {
    $queryRaw: asyncMock(),
    userProfile: { update: asyncMock() },
  }
  transaction.$queryRaw.mockResolvedValue([])
  const prisma: PrismaFixture = {
    userProfile: { findUnique: asyncMock() },
    $transaction: jest.fn<
      Promise<unknown>,
      [(transaction: TransactionFixture) => Promise<unknown>]
    >((callback) => callback(transaction)),
  }
  const audit: AuditFixture = {
    record: jest.fn<Promise<unknown>, [unknown, unknown]>().mockResolvedValue({}),
  }

  return {
    audit,
    prisma,
    service: new UserProfileService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    transaction,
  }
}

async function expectApiException(
  operation: Promise<unknown>,
  status: number,
  code: string,
): Promise<ApiException> {
  const error = await operation.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiException)
  expect(error).toMatchObject({ code })
  expect((error as ApiException).getStatus()).toBe(status)
  return error as ApiException
}

describe('UserProfileService reads', () => {
  it('reads and returns only the public self-service projection', async () => {
    const { prisma, service } = createFixture()
    prisma.userProfile.findUnique.mockResolvedValue(profileRow())

    await expect(service.getCurrent(USER_ID.toUpperCase())).resolves.toEqual({
      userId: USER_ID,
      email: 'User@Example.COM',
      mobileE164: '+8613812345678',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
    })
    expect(prisma.userProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: {
        userId: true,
        email: true,
        mobileE164: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    expect(
      JSON.stringify(prisma.userProfile.findUnique.mock.calls[0]?.[0]),
    ).not.toContain('remark')
    expect(
      JSON.stringify(prisma.userProfile.findUnique.mock.calls[0]?.[0]),
    ).not.toContain('emailNormalized')
  })

  it('treats a missing Profile as an internal invariant failure', async () => {
    const { prisma, service } = createFixture()
    prisma.userProfile.findUnique.mockResolvedValue(null)

    await expectApiException(
      service.getCurrent(USER_ID),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it('collapses database read errors without exposing unsafe details', async () => {
    const { prisma, service } = createFixture()
    prisma.userProfile.findUnique.mockRejectedValue(
      new Error('unsafe database connection details'),
    )

    const error = await expectApiException(
      service.getCurrent(USER_ID),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
    expect(JSON.stringify(error)).not.toContain('unsafe database')
  })
})

describe('UserProfileService updates', () => {
  it('normalizes fields, applies transaction timeouts and writes one PII-free Audit in the same transaction', async () => {
    const { audit, service, transaction } = createFixture()
    transaction.userProfile.update.mockResolvedValue(profileRow())

    await expect(
      service.updateCurrent(
        { actorUserId: USER_ID.toUpperCase(), requestId: REQUEST_ID },
        {
          mobileE164: '+8613812345678',
          email: ' User@Example.COM ',
          avatarUrl: 'https://cdn.example.com/avatar.png',
        },
      ),
    ).resolves.toMatchObject({ userId: USER_ID })

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1)
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.userProfile.update.mock.invocationCallOrder[0] ?? 0,
    )
    expect(transaction.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        data: {
          email: 'User@Example.COM',
          emailNormalized: 'user@example.com',
          mobileE164: '+8613812345678',
          avatarUrl: 'https://cdn.example.com/avatar.png',
        },
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(transaction, {
      eventType: 'USER_UPDATED',
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: USER_ID,
      targetType: 'User',
      targetId: USER_ID,
      requestId: REQUEST_ID,
      metadata: {
        changedFields: 'avatarUrl,email,mobileE164',
      },
    })
    const serializedAudit = JSON.stringify(audit.record.mock.calls[0]?.[1])
    expect(serializedAudit).not.toContain('User@Example.COM')
    expect(serializedAudit).not.toContain('+8613812345678')
    expect(serializedAudit).not.toContain('cdn.example.com')
  })

  it('uses explicit null to clear Email pair, Mobile and Avatar fields', async () => {
    const { service, transaction } = createFixture()
    transaction.userProfile.update.mockResolvedValue(profileRow({
      email: null,
      mobileE164: null,
      avatarUrl: null,
    }))

    await service.updateCurrent(
      { actorUserId: USER_ID, requestId: REQUEST_ID },
      { email: null, mobileE164: null, avatarUrl: null },
    )

    expect(transaction.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          email: null,
          emailNormalized: null,
          mobileE164: null,
          avatarUrl: null,
        },
      }),
    )
  })

  it('validates before opening a transaction', async () => {
    const { prisma, service } = createFixture()

    await expectApiException(
      service.updateCurrent(
        { actorUserId: USER_ID, requestId: REQUEST_ID },
        {},
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lets an administrator reuse the write primitive without opening a nested transaction or writing Audit', async () => {
    const { audit, prisma, service, transaction } = createFixture()
    transaction.userProfile.update.mockResolvedValue(profileRow())

    await expect(
      service.updateInTransaction(
        transaction as never,
        USER_ID,
        { remark: ' internal note ' },
        { allowRemark: true },
      ),
    ).resolves.toEqual({
      profile: {
        userId: USER_ID,
        email: 'User@Example.COM',
        mobileE164: '+8613812345678',
        avatarUrl: 'https://cdn.example.com/avatar.png',
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
      },
      changedFields: 'remark',
    })
    expect(transaction.userProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { remark: 'internal note' } }),
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('maps a missing Profile update to a fixed internal invariant error', async () => {
    const { service, transaction } = createFixture()
    transaction.userProfile.update.mockRejectedValue({ code: 'P2025' })

    await expectApiException(
      service.updateCurrent(
        { actorUserId: USER_ID, requestId: REQUEST_ID },
        { avatarUrl: null },
      ),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })

  it.each([
    [
      'Prisma field name',
      { code: 'P2002', meta: { target: ['emailNormalized'] } },
      'EMAIL_ALREADY_EXISTS',
    ],
    [
      'database field name',
      { code: 'P2002', meta: { target: 'email_normalized' } },
      'EMAIL_ALREADY_EXISTS',
    ],
    [
      'database index name',
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { index: 'user_profiles_email_normalized_key' },
            },
          },
        },
      },
      'EMAIL_ALREADY_EXISTS',
    ],
    [
      'Prisma 7 PostgreSQL adapter field metadata',
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { fields: ['mobile_e164'] },
            },
          },
        },
      },
      'MOBILE_ALREADY_EXISTS',
    ],
  ])('maps a known P2002 %s to %s', async (_label, databaseError, code) => {
    const { service, transaction } = createFixture()
    transaction.userProfile.update.mockRejectedValue(databaseError)

    await expectApiException(
      service.updateCurrent(
        { actorUserId: USER_ID, requestId: REQUEST_ID },
        { email: 'another@example.com' },
      ),
      HttpStatus.CONFLICT,
      code,
    )
  })

  it('fails safely for unknown or unstructured P2002 targets', async () => {
    for (const databaseError of [
      { code: 'P2002', meta: { target: ['unknown_unique_field'] } },
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: {
              kind: 'UniqueConstraintViolation',
              originalMessage: 'user_profiles_email_normalized_key',
            },
          },
        },
      },
    ]) {
      const { service, transaction } = createFixture()
      transaction.userProfile.update.mockRejectedValue(databaseError)

      await expectApiException(
        service.updateCurrent(
          { actorUserId: USER_ID, requestId: REQUEST_ID },
          { email: 'another@example.com' },
        ),
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
      )
    }
  })

  it('converts Audit failure to INTERNAL_ERROR so the transaction callback rejects', async () => {
    const { audit, service, transaction } = createFixture()
    transaction.userProfile.update.mockResolvedValue(profileRow())
    audit.record.mockRejectedValue(new Error('unsafe audit failure detail'))

    const error = await expectApiException(
      service.updateCurrent(
        { actorUserId: USER_ID, requestId: REQUEST_ID },
        { avatarUrl: null },
      ),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error)).not.toContain('unsafe audit')
  })
})
