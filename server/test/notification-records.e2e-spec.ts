/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest 的 response.body 是无类型 JSON。 */
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { SystemNotificationService } from '../src/modules/notifications/system-notification.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const

describe('Notification records API with PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let browser: ReturnType<typeof request.agent>
  let userId: string
  const notificationIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    const passwordProvider = application.get(PasswordProvider)

    const suffix = randomUUID()
    const username = `notification-records-e2e-${suffix}`
    const password = `Record-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '通知记录 E2E 管理员',
        passwordHash: await passwordProvider.hash(password),
        passwordChangedAt: new Date(),
      },
    })
    userId = user.id
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'system_admin' } })
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } })

    browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
  })

  afterAll(async () => {
    if (notificationIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } })
    }
    if (userId !== undefined) {
      await prisma.authSession.deleteMany({ where: { userId } })
      await prisma.auditEvent.deleteMany({ where: { actorUserId: userId } })
      await prisma.user.deleteMany({ where: { id: userId } })
    }
    await application.close()
  })

  async function createRecord(): Promise<string> {
    const suffix = randomUUID()
    const now = new Date()
    const notification = await prisma.notification.create({
      data: {
        eventType: 'PURCHASE_REVIEW_PENDING',
        sourceType: 'PURCHASE_ORDER',
        sourceId: `RECORD-E2E-${suffix}`,
        dedupeKey: `notification-records-e2e:${suffix}`,
        priority: 'HIGH',
        status: 'PENDING',
        templateKey: 'purchase.review.pending',
        requestedChannels: ['IN_APP', 'ASSISTANT'],
        variables: {},
        expiresAt: new Date(now.getTime() + 86_400_000),
        publishedAt: now,
        requestedByUserId: userId,
        inboxItems: {
          create: {
            userId,
            eventType: 'PURCHASE_REVIEW_PENDING',
            templateKey: 'purchase.review.pending',
            templateVersion: 1,
            titleSnapshot: '通知记录 E2E',
            bodySnapshot: '通知记录 E2E 正文',
          },
        },
        deliveries: {
          create: {
            recipientUserId: userId,
            status: 'PENDING',
            attemptCount: 0,
            nextAttemptAt: new Date(now.getTime() + 3_600_000),
            templateKey: 'purchase.review.pending',
            templateVersion: 1,
            renderedContent: '通知记录 E2E 交付',
          },
        },
      },
      select: { id: true },
    })
    notificationIds.push(notification.id)
    return notification.id
  }

  it('publishes a numbered notification through the sole service entry point', async () => {
    const notifications = application.get(SystemNotificationService)
    const suffix = randomUUID()
    const command = {
      channels: [],
      dedupeKey: `notification-number-e2e:${suffix}`,
      eventType: 'PURCHASE_REVIEW_PENDING' as const,
      source: { id: suffix, type: 'E2E' },
      target: { kind: 'USERS' as const, userIds: [userId] },
      templateKey: 'purchase.review.pending',
      variables: { orderNo: suffix },
    }

    await expect(prisma.$transaction(async (transaction) => {
      const first = await notifications.publish(command, { transaction })
      const notification = await transaction.notification.findUniqueOrThrow({
        where: { id: first.notificationId },
        select: { notificationNo: true, numberingIssuanceId: true },
      })
      expect(notification.notificationNo).toMatch(/^NTF\/[0-9]{8}-[0-9]{6}$/u)
      expect(notification.numberingIssuanceId).not.toBeNull()

      const issuance = await transaction.numberingIssuance.findUniqueOrThrow({
        where: { id: notification.numberingIssuanceId as string },
        select: { consumerCode: true, generatedNumber: true },
      })
      expect(issuance.consumerCode).toBe('NOTIFICATION.CREATE')
      expect(issuance.generatedNumber).toBe(notification.notificationNo)

      const duplicate = await notifications.publish(command, { transaction })
      expect(duplicate.duplicated).toBe(true)
      expect(duplicate.notificationId).toBe(first.notificationId)
      expect(await transaction.notification.count({
        where: { id: first.notificationId },
      })).toBe(1)
      throw new Error('rollback numbering test')
    })).rejects.toThrow('rollback numbering test')
  })

  it('supports options, filters, detail counts and cancellation', async () => {
    const recordId = await createRecord()

    const options = await browser
      .get('/api/notifications/records/options')
      .expect(200)
    expect(options.body.events).toHaveLength(39)

    const now = Date.now()
    const list = await browser
      .get('/api/notifications/records')
      .query({
        status: 'PENDING',
        domain: 'PURCHASE',
        channel: 'IN_APP',
        priority: 'HIGH',
        keyword: 'RECORD-E2E-',
        publishedFrom: new Date(now - 3_600_000).toISOString(),
        publishedTo: new Date(now + 3_600_000).toISOString(),
        page: 1,
        pageSize: 20,
      })
      .expect(200)

    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({
      id: recordId,
      eventLabel: '采购审核',
      domain: 'PURCHASE',
      channels: ['IN_APP', 'ASSISTANT'],
      inAppItemCount: 1,
      inAppUnreadCount: 1,
      deliveryCounts: { PENDING: 1 },
      requestedByName: '通知记录 E2E 管理员',
    })

    const detail = await browser
      .get(`/api/notifications/records/${recordId}`)
      .expect(200)
    expect(detail.body.deliveries).toHaveLength(1)
    expect(detail.body.deliveries[0]).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    })

    const cancelled = await browser
      .post(`/api/notifications/records/${recordId}/cancel`)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
    expect(cancelled.body).toEqual({ cancelled: 1, status: 'CANCELLED' })

    const afterCancel = await browser
      .get(`/api/notifications/records/${recordId}`)
      .expect(200)
    expect(afterCancel.body.status).toBe('CANCELLED')
    expect(afterCancel.body.deliveryCounts).toEqual({ CANCELLED: 1 })
  })
})
