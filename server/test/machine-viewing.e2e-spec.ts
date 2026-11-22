/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- Jest 匹配器与 catch 结果用于断言。 */
import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../src/app.module'
import { scanMachineViewingNotifications } from '../src/commands/machine-viewing-notification-scan'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { MachineViewingQueryService } from '../src/modules/machine-viewings/machine-viewing-query.service'
import { MachineViewingService } from '../src/modules/machine-viewings/machine-viewing.service'
import { SystemNotificationService } from '../src/modules/notifications/system-notification.service'

jest.setTimeout(60_000)

const USER_PREFIX = 'machine_viewing_e2e_'
const NOW = new Date('2026-11-05T02:00:00.000Z') // 10:00 上海
const BEFORE_NOTIFICATION_TIME = new Date('2026-11-05T00:00:00.000Z') // 08:00 上海

describe('machine viewing appointments against PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let service: MachineViewingService
  let queries: MachineViewingQueryService
  let operationsId: string
  let otherOperationsId: string
  let purchasingId: string
  let notificationRecipientId: string
  let roleIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    service = application.get(MachineViewingService)
    queries = application.get(MachineViewingQueryService)

    const permissions = await prisma.permission.findMany({
      where: {
        code: {
          in: [
            'machine-viewings:read',
            'machine-viewings:create',
            'machine-viewings:update',
            'data-scope:self',
            'data-scope:all',
          ],
        },
      },
      select: { id: true, code: true },
    })
    const permissionId = (code: string): string => {
      const found = permissions.find(item => item.code === code)
      if (found === undefined) throw new Error(`permission ${code} missing`)
      return found.id
    }

    const operationsRole = await prisma.role.create({
      data: {
        code: `${USER_PREFIX}ops_${randomUUID().slice(0, 8)}`,
        name: '看机预约 E2E 运营',
        permissions: {
          create: [
            { permissionId: permissionId('machine-viewings:read') },
            { permissionId: permissionId('machine-viewings:create') },
            { permissionId: permissionId('machine-viewings:update') },
            { permissionId: permissionId('data-scope:self') },
          ],
        },
      },
      select: { id: true },
    })
    const purchasingRole = await prisma.role.create({
      data: {
        code: `${USER_PREFIX}purchasing_${randomUUID().slice(0, 8)}`,
        name: '看机预约 E2E 采运',
        permissions: {
          create: [
            { permissionId: permissionId('machine-viewings:read') },
            { permissionId: permissionId('machine-viewings:update') },
            { permissionId: permissionId('data-scope:all') },
          ],
        },
      },
      select: { id: true },
    })
    // 通知目标按真实角色 code `purchasing_staff` 解析；E2E 临时库不跑 seed，这里补一个收件角色。
    const notificationRole = await prisma.role.create({
      data: {
        code: 'purchasing_staff',
        name: '看机预约 E2E 通知收件角色',
      },
      select: { id: true },
    })
    roleIds = [operationsRole.id, purchasingRole.id, notificationRole.id]

    operationsId = await createUser('ops', operationsRole.id)
    otherOperationsId = await createUser('ops_other', operationsRole.id)
    purchasingId = await createUser('purchasing', purchasingRole.id)
    notificationRecipientId = await createUser('notification', notificationRole.id)

    // 生产默认模板会被 purge，通知模板由管理员配置；E2E 需要自己补一份可渲染的站内模板。
    const variables = [
      'appointmentNo',
      'appointmentDate',
      'period',
      'hour',
      'site',
      'machineType',
      'customerName',
      'customerPhone',
      'contactPerson',
      'status',
    ].map(name => ({
      name,
      required: false,
      maxLength: 200,
      sensitive: name === 'customerName',
    }))
    await prisma.notificationTemplate.createMany({
      data: [
        {
          key: 'operations.machine-viewing.created',
          channel: 'IN_APP',
          name: '看机预约',
          domain: 'OPERATIONS',
          titleTemplate: '看机预约 {{appointmentNo}}',
          bodyTemplate: '时间：{{appointmentDate}} {{period}} {{hour}}\n客户：{{customerName}}',
          variables,
          maxLength: 2000,
          enabled: true,
        },
        {
          key: 'operations.machine-viewing.created',
          channel: 'ASSISTANT',
          name: '看机预约',
          domain: 'OPERATIONS',
          titleTemplate: null,
          bodyTemplate: '时间：{{appointmentDate}} {{period}} {{hour}}\n客户：{{customerName}}',
          variables,
          maxLength: 2000,
          enabled: true,
        },
        {
          key: 'operations.machine-viewing.rescheduled',
          channel: 'IN_APP',
          name: '看机预约改期',
          domain: 'OPERATIONS',
          titleTemplate: '看机预约改期 {{appointmentNo}}',
          bodyTemplate: '原时间：{{previousAppointmentTime}}\n新时间：{{appointmentTime}}\n客户：{{customerName}}',
          variables: [
            'appointmentNo',
            'previousAppointmentTime',
            'appointmentTime',
            'site',
            'machineType',
            'customerName',
            'contactPerson',
          ].map(name => ({
            name,
            required: false,
            maxLength: 200,
            sensitive: name === 'customerName',
          })),
          maxLength: 2000,
          enabled: true,
        },
      ],
    })
  })

  afterAll(async () => {
    try {
      const userIds = [operationsId, otherOperationsId, purchasingId, notificationRecipientId].filter(Boolean)
      await prisma.machineViewingAppointment.deleteMany({ where: { createdByUserId: { in: userIds } } })
      await prisma.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } })
      await application?.close()
    }
    catch {
      // 隔离 CI 数据库会在本次运行后销毁；清理失败不掩盖测试结论。
    }
  })

  async function createUser(label: string, roleId: string): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '')
    const username = `${USER_PREFIX}${label}_${suffix}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: `看机 E2E ${label}`,
        passwordHash: 'not-a-real-hash',
        passwordChangedAt: new Date('2026-01-01T00:00:00.000Z'),
        profile: { create: {} },
        roles: { create: { roleId } },
      },
      select: { id: true },
    })
    return user.id
  }

  function commandContext(actorUserId: string) {
    return { actorUserId, requestId: `req_${randomUUID()}` }
  }

  function input(overrides: Record<string, unknown> = {}) {
    return {
      site: 'NEW_TAIPEI_LINKOU' as const,
      machineType: 'MINI_TILLER' as const,
      appointmentMonth: 11,
      appointmentDay: 5,
      period: 'PM' as const,
      hour: 3,
      customerName: '陈先生',
      customerPhone: '0912-345-678',
      contactPerson: '李华',
      ...overrides,
    }
  }

  it('persists the resolved year, optional hour and audit event', async () => {
    const created = await service.create(commandContext(operationsId), input(), randomUUID(), NOW)

    expect(created).toMatchObject({
      site: 'NEW_TAIPEI_LINKOU',
      machineType: 'MINI_TILLER',
      appointmentDate: '2026-11-05',
      period: 'PM',
      hour: 3,
      customerName: '陈先生',
      customerPhone: '0912-345-678',
      contactPerson: '李华',
      // 今天 08:30 后创建：立即通知并把状态推进到已预约。
      status: 'APPOINTED',
      feedback: null,
      createdBy: { id: operationsId },
    })
    expect(created.appointmentNo).toMatch(/^MV\/\d{8}-\d{4}$/u)

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED', targetId: created.id },
    })
    expect(audit).not.toBeNull()

    const withoutHour = await service.create(
      commandContext(operationsId),
      input({ appointmentDay: 20, hour: undefined, period: 'AM' }),
      randomUUID(),
      NOW,
    )
    expect(withoutHour.hour).toBeNull()
    expect(withoutHour.appointmentDate).toBe('2026-11-20')
    expect(withoutHour.status).toBe('PENDING_APPOINTMENT')
    expect(withoutHour.appointmentNo).toMatch(/^MV\/\d{8}-\d{4}$/u)
    expect(withoutHour.appointmentNo).not.toBe(created.appointmentNo)
  })

  it('rolls a past month/day into the next year and rejects an impossible day', async () => {
    const rolled = await service.create(
      commandContext(operationsId),
      input({ appointmentMonth: 1, appointmentDay: 5 }),
      randomUUID(),
      NOW,
    )
    expect(rolled.appointmentDate).toBe('2027-01-05')

    await expect(service.create(
      commandContext(operationsId),
      input({ appointmentMonth: 2, appointmentDay: 31 }),
      randomUUID(),
      NOW,
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_VALIDATION_FAILED' })
  })

  it('replays the same idempotency key and rejects changed content', async () => {
    const key = randomUUID()
    const first = await service.create(commandContext(operationsId), input({ customerName: '幂等客户' }), key, NOW)
    const replay = await service.create(commandContext(operationsId), input({ customerName: '幂等客户' }), key, NOW)
    expect(replay.id).toBe(first.id)
    // 重放不能二次发号：编号必须与原单一致。
    expect(replay.appointmentNo).toBe(first.appointmentNo)

    await expect(service.create(
      commandContext(operationsId),
      input({ customerName: '换了客户' }),
      key,
      NOW,
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_IDEMPOTENCY_CONFLICT' })
  })

  it('scopes operations to its own rows and purchasing to all rows', async () => {
    const mine = await service.create(commandContext(operationsId), input({ customerName: '我的客户' }), randomUUID(), NOW)
    const others = await service.create(
      commandContext(otherOperationsId),
      input({ customerName: '他人客户' }),
      randomUUID(),
      NOW,
    )

    const own = await queries.listForActor(operationsId, { page: 1, pageSize: 100 })
    expect(own.items.some(item => item.id === mine.id)).toBe(true)
    expect(own.items.some(item => item.id === others.id)).toBe(false)
    expect(own.items.every(item => item.createdBy.id === operationsId)).toBe(true)

    const all = await queries.listForActor(purchasingId, { page: 1, pageSize: 100 })
    expect(all.items.some(item => item.id === mine.id)).toBe(true)
    expect(all.items.some(item => item.id === others.id)).toBe(true)
  })

  it('lists by appointment number descending so the newest registration is first', async () => {
    const first = await service.create(commandContext(purchasingId), input({ customerName: '分页一' }), randomUUID(), NOW)
    const second = await service.create(commandContext(purchasingId), input({ customerName: '分页二' }), randomUUID(), NOW)
    // 编号由同一规则按序派发，后登记的编号一定更大。
    expect(second.appointmentNo > first.appointmentNo).toBe(true)

    const page = await queries.listForActor(purchasingId, { page: 1, pageSize: 100 })
    const ids = page.items.map(item => item.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
    expect(page.total).toBe(ids.length)
  })

  it('reads back a manually recorded status and feedback', async () => {
    // 旧数据可能由脚本直接写入；序列化链路仍需兼容任意已存在状态。
    const created = await service.create(
      commandContext(operationsId),
      input({ customerName: '反馈读取' }),
      randomUUID(),
      NOW,
    )
    await prisma.machineViewingAppointment.update({
      where: { id: created.id },
      data: { status: 'FEEDBACK_GIVEN', feedback: '客户到场，已看过微耕机，倾向年底下单。' },
    })

    const page = await queries.listForActor(purchasingId, { page: 1, pageSize: 100 })
    const row = page.items.find(item => item.id === created.id)
    expect(row).toMatchObject({
      status: 'FEEDBACK_GIVEN',
      feedback: '客户到场，已看过微耕机，倾向年底下单。',
    })
  })

  it('updates editable content without changing the appointment number', async () => {
    const created = await service.create(
      commandContext(operationsId),
      input({ customerName: '编辑前' }),
      randomUUID(),
      NOW,
    )
    const updated = await service.update(commandContext(operationsId), created.id, {
      site: 'TAICHUNG_LONGJING',
      machineType: 'SHREDDER',
      appointmentDate: '2026-11-20',
      period: 'AM',
      customerName: '编辑后',
      contactPerson: '王五',
    }, NOW)

    expect(updated).toMatchObject({
      id: created.id,
      appointmentNo: created.appointmentNo,
      site: 'TAICHUNG_LONGJING',
      machineType: 'SHREDDER',
      appointmentDate: '2026-11-20',
      period: 'AM',
      hour: null,
      customerName: '编辑后',
      customerPhone: null,
      contactPerson: '王五',
      status: 'PENDING_APPOINTMENT',
    })
    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'MACHINE_VIEWING_APPOINTMENT_UPDATED', targetId: created.id },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit?.metadata).toMatchObject({ changedFields: expect.stringContaining('customerName') })
  })

  it('runs the strict status flow, edits feedback in place and locks cancellation afterwards', async () => {
    const created = await service.create(
      commandContext(operationsId),
      input({ customerName: '状态流转' }),
      randomUUID(),
      BEFORE_NOTIFICATION_TIME,
    )

    await expect(service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'FEEDBACK_GIVEN', feedback: '跳步' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })

    const appointed = await service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'APPOINTED' },
      NOW,
    )
    expect(appointed.status).toBe('APPOINTED')

    const fedBack = await service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'FEEDBACK_GIVEN', feedback: '客户到场，已看过微耕机。' },
    )
    expect(fedBack).toMatchObject({ status: 'FEEDBACK_GIVEN', feedback: '客户到场，已看过微耕机。' })

    const edited = await service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'FEEDBACK_GIVEN', feedback: '客户到场，已看过微耕机，倾向年底下单。' },
    )
    expect(edited.feedback).toBe('客户到场，已看过微耕机，倾向年底下单。')
    expect(edited.status).toBe('FEEDBACK_GIVEN')

    await expect(service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'CANCELLED' },
    )).rejects.toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })

    const lockedEdit = await service.update(commandContext(operationsId), created.id, {
      site: created.site,
      machineType: created.machineType,
      appointmentDate: created.appointmentDate,
      period: created.period,
      hour: created.hour ?? undefined,
      customerName: '改名',
      customerPhone: created.customerPhone ?? undefined,
      contactPerson: created.contactPerson,
    }, NOW).catch(error => error)
    expect(lockedEdit).toMatchObject({ code: 'MACHINE_VIEWING_STATE_CHANGED', status: 409 })
  })

  it('cancels before feedback and records the optional reason only in audit', async () => {
    const created = await service.create(
      commandContext(operationsId),
      input({ customerName: '取消预约' }),
      randomUUID(),
      BEFORE_NOTIFICATION_TIME,
    )
    const cancelled = await service.transition(
      commandContext(operationsId),
      created.id,
      { status: 'CANCELLED', cancelReason: '客户临时有事' },
    )
    expect(cancelled).toMatchObject({ status: 'CANCELLED', feedback: null })

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED', targetId: created.id },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit?.metadata).toMatchObject({
      fromStatus: 'PENDING_APPOINTMENT',
      toStatus: 'CANCELLED',
      cancelReason: '客户临时有事',
    })
  })

  it('scopes updates by data scope: operations cannot touch another operator row, purchasing can', async () => {
    const created = await service.create(
      commandContext(otherOperationsId),
      input({ customerName: '他人预约' }),
      randomUUID(),
      NOW,
    )
    const update = {
      site: 'NEW_TAIPEI_LINKOU' as const,
      machineType: 'MINI_TILLER' as const,
      appointmentDate: '2026-11-20',
      period: 'PM' as const,
      customerName: '被改名字',
      contactPerson: '李华',
    }

    await expect(service.update(commandContext(operationsId), created.id, update, NOW))
      .rejects.toMatchObject({ code: 'MACHINE_VIEWING_NOT_FOUND', status: 404 })

    const updatedByPurchasing = await service.update(commandContext(purchasingId), created.id, update, NOW)
    expect(updatedByPurchasing.customerName).toBe('被改名字')
  })

  it('runs the 08:30 scan for today PENDING appointments and advances them', async () => {
    const created = await service.create(
      commandContext(operationsId),
      input({ customerName: '批次客户' }),
      randomUUID(),
      BEFORE_NOTIFICATION_TIME,
    )
    expect(created.status).toBe('PENDING_APPOINTMENT')

    const result = await scanMachineViewingNotifications(
      prisma,
      application.get(SystemNotificationService),
      new AuditService(),
      { now: () => NOW },
    )
    expect(result.status).toBe('completed')
    expect(result.advanced).toBeGreaterThanOrEqual(1)

    const row = await prisma.machineViewingAppointment.findUnique({
      where: { id: created.id },
      select: { status: true },
    })
    expect(row?.status).toBe('APPOINTED')

    const notification = await prisma.notification.findFirst({
      where: {
        eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
        sourceId: created.id,
      },
      select: { id: true },
    })
    expect(notification).not.toBeNull()

    const audit = await prisma.auditEvent.findFirst({
      where: {
        actorType: 'SYSTEM',
        eventType: 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED',
        targetId: created.id,
      },
      select: { id: true },
    })
    expect(audit).not.toBeNull()
  })

  it('only sends the reschedule event for an APPOINTED future appointment and returns it to PENDING', async () => {
    const created = await service.create(
      commandContext(operationsId),
      input({ appointmentDay: 5, customerName: '未来改期' }),
      randomUUID(),
      NOW,
    )
    expect(created.status).toBe('APPOINTED')

    const updated = await service.update(commandContext(operationsId), created.id, {
      site: created.site,
      machineType: created.machineType,
      appointmentDate: '2026-11-20',
      period: 'AM',
      customerName: created.customerName,
      customerPhone: created.customerPhone ?? undefined,
      contactPerson: created.contactPerson,
    }, NOW)
    expect(updated).toMatchObject({
      appointmentDate: '2026-11-20',
      status: 'PENDING_APPOINTMENT',
    })

    const rescheduleNotification = await prisma.notification.findFirst({
      where: {
        eventType: 'MACHINE_VIEWING_APPOINTMENT_RESCHEDULED',
        sourceId: created.id,
      },
      select: { id: true },
    })
    expect(rescheduleNotification).not.toBeNull()

    const appointmentNotification = await prisma.notification.findFirst({
      where: {
        eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
        dedupeKey: { contains: ':r2' },
        sourceId: created.id,
      },
      select: { id: true },
    })
    expect(appointmentNotification).toBeNull()
  })

  it('filters by keyword, status, site, machine type and appointment date range', async () => {
    const earlier = await service.create(
      commandContext(purchasingId),
      input({ appointmentDay: 5, customerName: '筛选甲', site: 'NEW_TAIPEI_LINKOU', machineType: 'MINI_TILLER' }),
      randomUUID(),
      NOW,
    )
    const later = await service.create(
      commandContext(purchasingId),
      input({ appointmentDay: 20, customerName: '筛选乙', site: 'TAICHUNG_LONGJING', machineType: 'SHREDDER' }),
      randomUUID(),
      NOW,
    )

    const keyword = await queries.listForActor(purchasingId, { page: 1, pageSize: 100, keyword: '筛选甲' })
    expect(keyword.items.map(item => item.id)).toEqual([earlier.id])

    const byStatus = await queries.listForActor(purchasingId, { page: 1, pageSize: 100, status: 'APPOINTED' })
    expect(byStatus.items.some(item => item.id === earlier.id)).toBe(true)
    expect(byStatus.items.some(item => item.id === later.id)).toBe(false)

    const bySiteAndType = await queries.listForActor(purchasingId, {
      page: 1,
      pageSize: 100,
      site: 'TAICHUNG_LONGJING',
      machineType: 'SHREDDER',
    })
    expect(bySiteAndType.items.some(item => item.id === later.id)).toBe(true)
    expect(bySiteAndType.items.some(item => item.id === earlier.id)).toBe(false)

    const byDate = await queries.listForActor(purchasingId, {
      page: 1,
      pageSize: 100,
      dateFrom: '2026-11-20',
      dateTo: '2026-11-20',
    })
    expect(byDate.items.some(item => item.id === later.id)).toBe(true)
    expect(byDate.items.some(item => item.id === earlier.id)).toBe(false)

    await expect(queries.listForActor(purchasingId, { page: 1, pageSize: 100, dateFrom: '2026-02-31' }))
      .rejects.toMatchObject({ code: 'MACHINE_VIEWING_VALIDATION_FAILED', status: 422 })
  })
})
