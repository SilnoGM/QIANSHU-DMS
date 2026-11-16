/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { Prisma } from '../src/generated/prisma/client'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { AssistantMediaUrlService } from '../src/modules/notifications/assistant-media-url'
import { SystemNotificationService } from '../src/modules/notifications/system-notification.service'
import { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'


describe('Notification media public route with PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let url: AssistantMediaUrlService
  let deliveryMediaId: string
  let deliveryId: string
  let notificationId: string
  let userId: string
  let assetId: string
  let uploadingAssetId: string
  let notifications: SystemNotificationService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // 取流只需要文件字节；用内存流替代真实媒体目录，其余链路仍走真实数据库与守卫。
      .overrideProvider(MediaContentDeliveryService)
      .useValue({
        mode: 'application',
        open: () => Promise.resolve({
          contentLength: 3n,
          modifiedAt: new Date(),
          sizeBytes: 3n,
          stream: Readable.from([Buffer.from('img')]),
        }),
        stat: () => Promise.resolve({ modifiedAt: new Date(), sizeBytes: 3n }),
      })
      .compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    url = application.get(AssistantMediaUrlService)
    notifications = application.get(SystemNotificationService)

    const passwordProvider = application.get(PasswordProvider)
    const suffix = randomUUID()
    const username = `notification-media-e2e-${suffix}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '通知附件 E2E',
        passwordHash: await passwordProvider.hash(`Media-${suffix.slice(0, 12)}`),
        passwordChangedAt: new Date(),
      },
    })
    userId = user.id

    notificationId = randomUUID()
    deliveryId = randomUUID()
    deliveryMediaId = randomUUID()
    assetId = randomUUID()
    await prisma.$transaction(async (tx) => {
      // 测试夹具直插 READY 资产，绕过「READY 必须已有业务引用」的延迟约束。
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "media_assets" (
          "id", "media_type", "status", "storage_driver", "object_key", "original_filename",
          "mime_type", "size_bytes", "checksum_sha256", "width", "height", "created_by_user_id"
        ) VALUES (
          ${assetId}::uuid, 'IMAGE', 'READY', 'local', ${`assets/sales/${assetId}.jpg`}, '收款凭证.jpg',
          'image/jpeg', 3, ${'ab'.repeat(32)}, 100, 100, ${userId}::uuid
        )`)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "notifications" (
          "id", "event_type", "source_type", "source_id", "dedupe_key", "template_key", "published_at"
        ) VALUES (
          ${notificationId}::uuid, 'SALES_RECEIPT_REVIEW_PENDING', 'SALES_RECEIPT_REQUEST',
          ${randomUUID()}, ${`notification-media-e2e:${notificationId}`}, 'sales.receipt.pending', now()
        )`)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "assistant_deliveries" (
          "id", "notification_id", "recipient_user_id", "status", "template_key",
          "template_version", "rendered_content"
        ) VALUES (
          ${deliveryId}::uuid, ${notificationId}::uuid, ${userId}::uuid, 'PENDING',
          'sales.receipt.pending', 1, '收款待审核'
        )`)
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "assistant_delivery_media" (
          "id", "delivery_id", "media_asset_id", "sort_order"
        ) VALUES (
          ${deliveryMediaId}::uuid, ${deliveryId}::uuid, ${assetId}::uuid, 0
        )`)

      // 第二条资产停在 UPLOADING：用于验证发布时按状态拦下附件。
      uploadingAssetId = randomUUID()
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "media_assets" (
          "id", "media_type", "status", "storage_driver", "object_key", "original_filename",
          "mime_type", "size_bytes", "upload_expires_at", "created_by_user_id"
        ) VALUES (
          ${uploadingAssetId}::uuid, 'IMAGE', 'UPLOADING', 'local', ${`assets/sales/${uploadingAssetId}.jpg`},
          '未激活.jpg', 'image/jpeg', 3, now() + interval '1 hour', ${userId}::uuid
        )`)
    })

    const account = await prisma.assistantAccount.create({
      data: {
        name: 'E2E 公司号',
        appId: `e2e-app-${randomUUID()}`,
        wxid: 'wxid-e2e',
        status: 'ONLINE',
      },
    })
    await prisma.assistantBinding.create({
      data: {
        userId,
        accountId: account.id,
        wxid: 'wxid-e2e-user',
        status: 'ACTIVE',
        boundByUserId: userId,
        verifiedAt: new Date(),
        verifiedByUserId: userId,
      },
    })
    await prisma.notificationChannelSettings.upsert({
      where: { channel: 'ASSISTANT' },
      create: { channel: 'ASSISTANT', enabled: true },
      update: { enabled: true },
    })
    await prisma.notificationTemplate.create({
      data: {
        key: 'sales.receipt.pending',
        channel: 'ASSISTANT',
        name: '收款审核（E2E）',
        domain: 'SALES',
        bodyTemplate: '收款 {{collectionNo}} 待审核',
        variables: [{ name: 'collectionNo', required: true }],
        mediaPolicy: { enabled: true, maxCount: 2, kinds: ['IMAGE'] },
      },
    })
    const policy = {
      targetMode: 'USERS' as const,
      targetConfig: { userIds: [userId] },
      allowSensitive: true,
      ttlSeconds: 3_600,
      enabled: true,
    }
    await prisma.notificationChannelPolicy.upsert({
      where: {
        eventType_channel: {
          eventType: 'SALES_RECEIPT_REVIEW_PENDING',
          channel: 'ASSISTANT',
        },
      },
      create: {
        eventType: 'SALES_RECEIPT_REVIEW_PENDING',
        channel: 'ASSISTANT',
        ...policy,
      },
      update: policy,
    })
  })

  afterAll(async () => {
    await application.close()
  })

  it('serves the signed image without any session cookie and records the first fetch', async () => {
    const signed = url.sign(deliveryMediaId)
    const path = new URL(signed).pathname

    const response = await request(application.getHttpServer())
      .get(path)
      .expect(200)

    expect(response.headers['content-type']).toBe('image/jpeg')
    expect(response.headers['content-length']).toBe('3')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cache-control']).toContain('no-store')
    const row = await prisma.assistantDeliveryMedia.findUniqueOrThrow({
      where: { id: deliveryMediaId },
      select: { fetchedAt: true },
    })
    expect(row.fetchedAt).not.toBeNull()
  })

  it('answers HEAD without a body', async () => {
    const signed = url.sign(deliveryMediaId)
    const path = new URL(signed).pathname

    const response = await request(application.getHttpServer())
      .head(path)
      .expect(200)

    expect(response.text ?? '').toBe('')
  })

  it('rejects a forged or expired token with a uniform 404', async () => {
    await request(application.getHttpServer())
      .get('/api/public/notification-media/not-a-token')
      .expect(404)

    const expired = url.sign(deliveryMediaId, Date.now() - 20 * 60 * 1_000)
    await request(application.getHttpServer())
      .get(new URL(expired).pathname)
      .expect(404)
  })

  it('rejects tokens whose attachment is no longer sendable', async () => {
    await prisma.assistantDeliveryMedia.update({
      where: { id: deliveryMediaId },
      data: { status: 'CANCELLED' },
    })
    const signed = url.sign(deliveryMediaId)

    await request(application.getHttpServer())
      .get(new URL(signed).pathname)
      .expect(404)
  })

  it('publishes only ready attachments and fans them out to each delivery', async () => {
    const sourceId = randomUUID()
    const result = await notifications.publish({
      eventType: 'SALES_RECEIPT_REVIEW_PENDING',
      source: { type: 'SALES_RECEIPT_REQUEST', id: sourceId },
      target: { kind: 'USERS', userIds: [userId] },
      templateKey: 'sales.receipt.pending',
      variables: { collectionNo: 'SK-E2E-1' },
      media: [{ assetId }, { assetId: uploadingAssetId }],
      dedupeKey: `notification-media-e2e:${sourceId}`,
    })

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MEDIA_ATTACHMENT_BLOCKED' }),
    ]))
    const media = await prisma.notificationMedia.findMany({
      where: { notificationId: result.notificationId },
      orderBy: { sortOrder: 'asc' },
      select: { mediaAssetId: true, sortOrder: true, blockedReason: true },
    })
    expect(media).toEqual([
      { mediaAssetId: assetId, sortOrder: 0, blockedReason: null },
      { mediaAssetId: uploadingAssetId, sortOrder: 1, blockedReason: 'ASSET_NOT_READY' },
    ])
    const deliveries = await prisma.assistantDelivery.findMany({
      where: { notificationId: result.notificationId },
      select: { id: true, status: true, media: { select: { mediaAssetId: true, sortOrder: true } } },
    })
    expect(deliveries).toEqual([{
      id: expect.any(String),
      status: 'PENDING',
      media: [{ mediaAssetId: assetId, sortOrder: 0 }],
    }])
  })

  it('blocks every attachment when the template policy is off', async () => {
    await prisma.notificationTemplate.updateMany({
      where: { key: 'sales.receipt.pending', channel: 'ASSISTANT' },
      data: { mediaPolicy: {} },
    })
    const sourceId = randomUUID()
    const result = await notifications.publish({
      eventType: 'SALES_RECEIPT_REVIEW_PENDING',
      source: { type: 'SALES_RECEIPT_REQUEST', id: sourceId },
      target: { kind: 'USERS', userIds: [userId] },
      templateKey: 'sales.receipt.pending',
      variables: { collectionNo: 'SK-E2E-2' },
      media: [{ assetId }],
      dedupeKey: `notification-media-e2e:${sourceId}`,
    })

    const media = await prisma.notificationMedia.findMany({
      where: { notificationId: result.notificationId },
      select: { blockedReason: true },
    })
    expect(media).toEqual([{ blockedReason: 'POLICY_DISABLED' }])
    const deliveryMedia = await prisma.assistantDeliveryMedia.count({
      where: { delivery: { notificationId: result.notificationId } },
    })
    expect(deliveryMedia).toBe(0)
  })
})
