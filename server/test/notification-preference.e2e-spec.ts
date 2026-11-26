/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest 的 response.body 是无类型 JSON。 */
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuthSessionService } from '../src/modules/auth/auth-session.service'
import { seedNotificationEventChannel } from './fixtures/notification-event-channel'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const

const EVENT_TYPE = 'SALES_RECEIPT_REVIEW_PENDING'

function createSessionCookie(tokenValue: string): string {
  return `qianshu_session_dev=${tokenValue}`
}

describe('Notification preference API with PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let sessionService: AuthSessionService
  const createdUserIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()
    prisma = application.get(PrismaService)
    sessionService = application.get(AuthSessionService)

    await prisma.notificationChannelSettings.upsert({
      where: { channel: 'IN_APP' },
      create: { channel: 'IN_APP', enabled: true },
      update: { enabled: true },
    })
    await prisma.notificationChannelSettings.upsert({
      where: { channel: 'WECOM' },
      create: { channel: 'WECOM', enabled: false },
      update: { enabled: false },
    })
    await seedNotificationEventChannel(prisma, {
      eventType: EVENT_TYPE,
      channel: 'IN_APP',
      sendMethod: 'IN_APP',
      messages: [{
        kind: 'TEXT',
        payload: { title: null, content: '收款 {{collectionNo}} 待审核', linkUrl: null },
      }],
    })
    await seedNotificationEventChannel(prisma, {
      eventType: EVENT_TYPE,
      channel: 'WECOM',
      sendMethod: 'APP',
      enabled: false,
      messages: [{
        kind: 'TEXT',
        payload: { title: null, content: '收款 {{collectionNo}} 待审核', linkUrl: null },
      }],
    })
  })

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.notificationUserMute.deleteMany({ where: { userId: { in: createdUserIds } } })
      await prisma.authSession.deleteMany({ where: { userId: { in: createdUserIds } } })
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }
    await application.close()
  })

  async function createUser(label: string) {
    const suffix = randomUUID()
    const user = await prisma.user.create({
      data: {
        username: `preference-e2e-${label}-${suffix}`,
        usernameNormalized: `preference-e2e-${label}-${suffix}`,
        displayName: `Preference ${label}`,
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

  function readEvent(body: { events: Array<{ eventType: string, channels: Array<Record<string, unknown>> }> }) {
    return body.events.find(event => event.eventType === EVENT_TYPE)
  }

  it('lists admin-enabled events and keeps mutes isolated per user', async () => {
    const alice = await createUser('alice')
    const bob = await createUser('bob')

    const initial = await request(application.getHttpServer())
      .get('/api/notifications/me/preferences')
      .set('Cookie', alice.cookie)
      .expect(200)

    const initialEvent = readEvent(initial.body)
    expect(initial.body.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'IN_APP', enabled: true }),
      expect.objectContaining({ channel: 'WECOM', enabled: false }),
    ]))
    expect(initialEvent?.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'IN_APP', available: true, muted: false, unavailableReason: null }),
      expect.objectContaining({ channel: 'WECOM', available: false, unavailableReason: 'CONFIG_DISABLED' }),
    ]))

    await request(application.getHttpServer())
      .put(`/api/notifications/me/preferences/${EVENT_TYPE}/IN_APP`)
      .set(CSRF_HEADERS)
      .set('Cookie', alice.cookie)
      .send({ muted: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ eventType: EVENT_TYPE, channel: 'IN_APP', muted: true })
      })

    const aliceView = await request(application.getHttpServer())
      .get('/api/notifications/me/preferences')
      .set('Cookie', alice.cookie)
      .expect(200)
    const bobView = await request(application.getHttpServer())
      .get('/api/notifications/me/preferences')
      .set('Cookie', bob.cookie)
      .expect(200)

    expect(readEvent(aliceView.body)?.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'IN_APP', muted: true }),
    ]))
    expect(readEvent(bobView.body)?.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'IN_APP', muted: false }),
    ]))
  })

  it('removes the mute row when the event is turned back on', async () => {
    const user = await createUser('toggle')

    await request(application.getHttpServer())
      .put(`/api/notifications/me/preferences/${EVENT_TYPE}/IN_APP`)
      .set(CSRF_HEADERS)
      .set('Cookie', user.cookie)
      .send({ muted: true })
      .expect(200)

    await request(application.getHttpServer())
      .put(`/api/notifications/me/preferences/${EVENT_TYPE}/IN_APP`)
      .set(CSRF_HEADERS)
      .set('Cookie', user.cookie)
      .send({ muted: false })
      .expect(200)

    const rows = await prisma.notificationUserMute.findMany({ where: { userId: user.user.id } })
    expect(rows).toEqual([])
  })

  it('rejects mutes for channels the admin has not enabled', async () => {
    const user = await createUser('invalid')

    await request(application.getHttpServer())
      .put(`/api/notifications/me/preferences/${EVENT_TYPE}/WECOM`)
      .set(CSRF_HEADERS)
      .set('Cookie', user.cookie)
      .send({ muted: true })
      .expect(422)
      .expect(({ body }) => {
        expect(body.code).toBe('NOTIFICATION_PREFERENCE_UNAVAILABLE')
      })
  })

  it('rejects unknown events and missing CSRF headers', async () => {
    const user = await createUser('guards')

    await request(application.getHttpServer())
      .put('/api/notifications/me/preferences/UNKNOWN_EVENT/IN_APP')
      .set(CSRF_HEADERS)
      .set('Cookie', user.cookie)
      .send({ muted: true })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('NOTIFICATION_EVENT_NOT_FOUND')
      })

    await request(application.getHttpServer())
      .put(`/api/notifications/me/preferences/${EVENT_TYPE}/IN_APP`)
      .set('Cookie', user.cookie)
      .send({ muted: true })
      .expect(403)
  })
})
