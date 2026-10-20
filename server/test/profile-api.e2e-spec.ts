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
import { MediaContentValidator } from '../src/modules/media/media-content-validator'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const USERNAME_PREFIX = 'profile-api-e2e-'
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVQokWOoIBEwjGogAjAQowgZjGogBtA+lABjWWgQrlQ/lQAAAABJRU5ErkJggg==',
  'base64',
)

interface ApiErrorBody {
  code: string
  fieldErrors?: Record<string, string[]>
}

interface AvatarUploadBody {
  avatarUrl: string
  mediaAssetId: string
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
    // file-type@21 是 ESM-only；Jest 29 的 resolver 无法通过 createRequire 加载真实实现。
    // 生产构建走 Node 24 require(esm)；E2E 用固定 PNG 识别器，sharp 仍会验证真实图片内容。
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MediaContentValidator)
      .useValue(new MediaContentValidator(
        { ffprobePath: 'ffprobe', qpdfPath: 'qpdf' },
        {
          detectFileType: () => Promise.resolve({ ext: 'png', mime: 'image/png' }),
        },
      ))
      .compile()
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
      // 头像资产被资料引用时不能直接删 User：先在同一事务里解除引用并置 TRASHED，
      // 再删除测试用户创建的媒体资产，最后才删 User。
      const avatarProfiles = await prisma.userProfile.findMany({
        where: {
          userId: { in: userIds },
          avatarMediaAssetId: { not: null },
        },
        select: { avatarMediaAssetId: true, userId: true },
      })
      if (avatarProfiles.length > 0) {
        await prisma.$transaction(async (transaction) => {
          for (const profile of avatarProfiles) {
            await transaction.userProfile.update({
              where: { userId: profile.userId },
              data: { avatarMediaAssetId: null, avatarUrl: null },
            })
            if (profile.avatarMediaAssetId !== null) {
              await transaction.mediaAsset.updateMany({
                where: {
                  id: profile.avatarMediaAssetId,
                  status: 'READY',
                },
                data: {
                  deletedAt: new Date(),
                  retentionUntil: new Date(Date.now() + 30 * 86_400_000),
                  status: 'TRASHED',
                },
              })
            }
          }
        })
      }
      await prisma.mediaAsset.deleteMany({
        where: { createdByUserId: { in: userIds } },
      })
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

  async function uploadAvatar(
    browser: ReturnType<typeof request.agent>,
    options: {
      content?: Buffer
      contentType?: string
      mediaType?: string
    } = {},
  ) {
    return await browser
      .post('/api/profile/avatar-uploads')
      .set(CSRF_HEADERS)
      .field('mediaType', options.mediaType ?? 'IMAGE')
      .attach('file', options.content ?? AVATAR_PNG, {
        contentType: options.contentType ?? 'image/png',
        filename: 'avatar.png',
      })
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

  it('stages, binds, serves, replaces and clears a managed avatar', async () => {
    const owner = await createUser()
    const ownerBrowser = request.agent(application.getHttpServer())
    await login(ownerBrowser, owner.user.username, owner.password)

    const firstUploadResponse = await uploadAvatar(ownerBrowser)
    expect(firstUploadResponse.status).toBe(201)
    const firstUpload = readResponseBody<AvatarUploadBody>(firstUploadResponse)
    expect(firstUpload.avatarUrl).toBe(
      `${APP_ORIGIN}/api/profile/avatars/${firstUpload.mediaAssetId}/content`,
    )
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: firstUpload.mediaAssetId },
      }),
    ).resolves.toMatchObject({
      status: 'UPLOADING',
      uploadPurpose: 'USER_AVATAR',
    })

    const other = await createUser()
    const otherBrowser = request.agent(application.getHttpServer())
    await login(otherBrowser, other.user.username, other.password)
    const firstPath = new URL(firstUpload.avatarUrl).pathname
    await otherBrowser.get(firstPath).expect(404)

    await ownerBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: firstUpload.avatarUrl })
      .expect(200)
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: firstUpload.mediaAssetId },
      }),
    ).resolves.toMatchObject({ status: 'READY' })
    await expect(
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: owner.user.id },
      }),
    ).resolves.toMatchObject({
      avatarMediaAssetId: firstUpload.mediaAssetId,
      avatarUrl: firstUpload.avatarUrl,
    })
    await otherBrowser
      .get(firstPath)
      .expect(200)
      .expect('Content-Type', /image\/png/u)

    const secondUploadResponse = await uploadAvatar(ownerBrowser)
    expect(secondUploadResponse.status).toBe(201)
    const secondUpload = readResponseBody<AvatarUploadBody>(secondUploadResponse)
    await ownerBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: secondUpload.avatarUrl })
      .expect(200)
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: firstUpload.mediaAssetId },
      }),
    ).resolves.toMatchObject({ status: 'TRASHED' })
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: secondUpload.mediaAssetId },
      }),
    ).resolves.toMatchObject({ status: 'READY' })

    await ownerBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: null })
      .expect(200)
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: secondUpload.mediaAssetId },
      }),
    ).resolves.toMatchObject({ status: 'TRASHED' })
    await expect(
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: owner.user.id },
      }),
    ).resolves.toMatchObject({
      avatarMediaAssetId: null,
      avatarUrl: null,
    })
  })

  it('rejects invalid, foreign and expired avatar uploads', async () => {
    const owner = await createUser()
    const ownerBrowser = request.agent(application.getHttpServer())
    await login(ownerBrowser, owner.user.username, owner.password)

    const documentResponse = await uploadAvatar(ownerBrowser, { mediaType: 'DOCUMENT' })
    expect(documentResponse.status).toBe(422)
    expect(readResponseBody<ApiErrorBody>(documentResponse).code).toBe(
      'PROFILE_AVATAR_INVALID',
    )
    const invalidContentResponse = await uploadAvatar(ownerBrowser, {
      content: Buffer.from('not an image'),
    })
    expect(invalidContentResponse.status).toBe(422)
    expect(readResponseBody<ApiErrorBody>(invalidContentResponse).code).toBe(
      'PROFILE_AVATAR_INVALID',
    )

    const uploadedResponse = await uploadAvatar(ownerBrowser)
    expect(uploadedResponse.status).toBe(201)
    const uploaded = readResponseBody<AvatarUploadBody>(uploadedResponse)
    const other = await createUser()
    const otherBrowser = request.agent(application.getHttpServer())
    await login(otherBrowser, other.user.username, other.password)
    await otherBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: uploaded.avatarUrl })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'PROFILE_AVATAR_UNAVAILABLE',
        )
      })

    await prisma.mediaAsset.update({
      where: { id: uploaded.mediaAssetId },
      data: { uploadExpiresAt: new Date(Date.now() - 1_000) },
    })
    await ownerBrowser
      .patch('/api/profile')
      .set(CSRF_HEADERS)
      .send({ avatarUrl: uploaded.avatarUrl })
      .expect(422)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'PROFILE_AVATAR_EXPIRED',
        )
      })
  })

  it('lets an administrator bind an avatar uploaded while editing another user', async () => {
    const target = await createUser()
    const admin = await createUser()
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await prisma.userRole.create({
      data: { roleId: adminRole.id, userId: admin.user.id },
    })

    const adminBrowser = request.agent(application.getHttpServer())
    await login(adminBrowser, admin.user.username, admin.password)
    const uploadedResponse = await uploadAvatar(adminBrowser)
    expect(uploadedResponse.status).toBe(201)
    const uploaded = readResponseBody<AvatarUploadBody>(uploadedResponse)

    await adminBrowser
      .patch(`/api/users/${target.user.id}`)
      .set(CSRF_HEADERS)
      .send({ avatarUrl: uploaded.avatarUrl })
      .expect(200)

    await expect(
      prisma.userProfile.findUniqueOrThrow({
        where: { userId: target.user.id },
      }),
    ).resolves.toMatchObject({
      avatarMediaAssetId: uploaded.mediaAssetId,
      avatarUrl: uploaded.avatarUrl,
    })
    await expect(
      prisma.mediaAsset.findUniqueOrThrow({
        where: { id: uploaded.mediaAssetId },
      }),
    ).resolves.toMatchObject({ status: 'READY' })
  })
})
