/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- supertest 的 response.body 是无类型 JSON。 */
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const

function createSessionCookie(tokenValue: string): string {
  return `qianshu_session_dev=${tokenValue}`
}

describe('Notification inbox API with PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let sessionService: AuthSessionService
  const createdUserIds: string[] = []
  const notificationIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    sessionService = application.get(AuthSessionService)
  })

  afterAll(async () => {
    if (notificationIds.length > 0) {
      await prisma.notificationInboxItem.deleteMany({ where: { notificationId: { in: notificationIds } } })
      await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } })
    }
    if (createdUserIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } })
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }
    await application.close()
  })

  async function createUser(label: string) {
    const suffix = randomUUID()
    const user = await prisma.user.create({
      data: {
        username: `inbox-e2e-${label}-${suffix}`,
        usernameNormalized: `inbox-e2e-${label}-${suffix}`,
        displayName: `Inbox ${label}`,
        passwordHash: 'e2e-only-not-a-real-password-hash',
        passwordChangedAt: new Date(),
        profile: { create: {} },
      },
    })
    createdUserIds.push(user.id)
    const issued = await prisma.$transaction(transaction => sessionService.createInTransaction(transaction, {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      mustChangePassword: user.mustChangePassword,
      authVersion: user.authVersion,
    }))
    return { user, cookie: createSessionCookie(issued.tokenValue) }
  }

  async function createInboxNotification(userId: string, title: string) {
    const suffix = randomUUID()
    const notification = await prisma.notification.create({
      data: {
        eventType: 'PURCHASE_REVIEW_PENDING',
        sourceType: 'E2E',
        sourceId: suffix,
        dedupeKey: `notification-inbox-e2e:${suffix}`,
        templateKey: 'purchase.review.pending',
        requestedChannels: ['IN_APP'],
        variables: {},
      },
    })
    notificationIds.push(notification.id)
    const item = await prisma.notificationInboxItem.create({
      data: {
        notificationId: notification.id,
        userId,
        eventType: 'PURCHASE_REVIEW_PENDING',
        templateKey: 'purchase.review.pending',
        templateVersion: 1,
        titleSnapshot: title,
        bodySnapshot: 'E2E 通知正文',
      },
    })
    return { notification, item }
  }

  it('isolates inbox items by current session and supports read/archive flows', async () => {
    const alice = await createUser('alice')
    const bob = await createUser('bob')
    const aliceItem = await createInboxNotification(alice.user.id, 'Alice 的通知')
    const bobItem = await createInboxNotification(bob.user.id, 'Bob 的通知')

    await request(application.getHttpServer())
      .get('/api/notifications/me/inbox')
      .expect(401)

    const aliceList = await request(application.getHttpServer())
      .get('/api/notifications/me/inbox')
      .set('Cookie', alice.cookie)
      .expect(200)
    expect(aliceList.body.items.map((item: { id: string }) => item.id)).toEqual([aliceItem.item.id])

    await request(application.getHttpServer())
      .get(`/api/notifications/me/inbox/${bobItem.item.id}`)
      .set('Cookie', alice.cookie)
      .expect(404)

    const unread = await request(application.getHttpServer())
      .get('/api/notifications/me/inbox/unread-count')
      .set('Cookie', alice.cookie)
      .expect(200)
    expect(unread.body).toEqual({ total: 1 })

    const read = await request(application.getHttpServer())
      .post(`/api/notifications/me/inbox/${aliceItem.item.id}/read`)
      .set('Cookie', alice.cookie)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
    expect(read.body.readAt).not.toBeNull()

    const archived = await request(application.getHttpServer())
      .post(`/api/notifications/me/inbox/${aliceItem.item.id}/archive`)
      .set('Cookie', alice.cookie)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
    expect(archived.body.archivedAt).not.toBeNull()

    const archivedList = await request(application.getHttpServer())
      .get('/api/notifications/me/inbox?status=archived')
      .set('Cookie', alice.cookie)
      .expect(200)
    expect(archivedList.body.items.map((item: { id: string }) => item.id)).toEqual([aliceItem.item.id])

    await request(application.getHttpServer())
      .post(`/api/notifications/me/inbox/${aliceItem.item.id}/unarchive`)
      .set('Cookie', alice.cookie)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)

    const readAll = await request(application.getHttpServer())
      .post('/api/notifications/me/inbox/read-all')
      .set('Cookie', alice.cookie)
      .set(CSRF_HEADERS)
      .send({})
      .expect(200)
    expect(readAll.body).toEqual({ updated: 0, unreadTotal: 0 })

    const bobList = await request(application.getHttpServer())
      .get('/api/notifications/me/inbox')
      .set('Cookie', bob.cookie)
      .expect(200)
    expect(bobList.body.items.map((item: { id: string }) => item.id)).toEqual([bobItem.item.id])
  })

  it('advances the new-item cursor across database microsecond timestamps', async () => {
    const user = await createUser('cursor')
    const first = await request(application.getHttpServer())
      .get('/api/notifications/me/inbox/new')
      .set('Cookie', user.cookie)
      .expect(200)
    expect(first.body.items).toEqual([])

    const created = await createInboxNotification(user.user.id, '微秒游标通知')
    await prisma.$executeRaw`
      UPDATE "notification_inbox_items"
      SET "created_at" = date_trunc('milliseconds', "created_at") + INTERVAL '123 microseconds'
      WHERE "id" = ${created.item.id}::uuid
    `
    const cursor = encodeURIComponent(first.body.nextCursor as string)
    const firstPoll = await request(application.getHttpServer())
      .get(`/api/notifications/me/inbox/new?cursor=${cursor}`)
      .set('Cookie', user.cookie)
      .expect(200)
    expect(firstPoll.body.items.map((item: { id: string }) => item.id)).toEqual([created.item.id])

    const nextCursor = encodeURIComponent(firstPoll.body.nextCursor as string)
    const secondPoll = await request(application.getHttpServer())
      .get(`/api/notifications/me/inbox/new?cursor=${nextCursor}`)
      .set('Cookie', user.cookie)
      .expect(200)
    expect(secondPoll.body.items).toEqual([])
  })
})
