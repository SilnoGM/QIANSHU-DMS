import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { MachineViewingQueryService } from '../src/modules/machine-viewings/machine-viewing-query.service'
import { MachineViewingService } from '../src/modules/machine-viewings/machine-viewing.service'

jest.setTimeout(60_000)

const USER_PREFIX = 'machine_viewing_e2e_'
const NOW = new Date('2026-11-05T02:00:00.000Z')

describe('machine viewing appointments against PostgreSQL', () => {
  let application: INestApplication
  let prisma: PrismaService
  let service: MachineViewingService
  let queries: MachineViewingQueryService
  let operationsId: string
  let otherOperationsId: string
  let purchasingId: string
  let roleIds: string[] = []

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    application = moduleRef.createNestApplication()
    await application.init()
    prisma = application.get(PrismaService)
    service = application.get(MachineViewingService)
    queries = application.get(MachineViewingQueryService)

    const permissions = await prisma.permission.findMany({
      where: { code: { in: ['machine-viewings:read', 'machine-viewings:create', 'data-scope:self', 'data-scope:all'] } },
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
            { permissionId: permissionId('data-scope:all') },
          ],
        },
      },
      select: { id: true },
    })
    roleIds = [operationsRole.id, purchasingRole.id]

    operationsId = await createUser('ops', operationsRole.id)
    otherOperationsId = await createUser('ops_other', operationsRole.id)
    purchasingId = await createUser('purchasing', purchasingRole.id)
  })

  afterAll(async () => {
    try {
      const userIds = [operationsId, otherOperationsId, purchasingId].filter(Boolean)
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
      createdBy: { id: operationsId },
    })

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

  it('paginates newest submissions first', async () => {
    const first = await service.create(commandContext(purchasingId), input({ customerName: '分页一' }), randomUUID(), NOW)
    const second = await service.create(commandContext(purchasingId), input({ customerName: '分页二' }), randomUUID(), NOW)
    // 同一毫秒内创建时 createdAt 可能相同；显式错开时间，断言才不会依赖随机 UUID 排序。
    await prisma.machineViewingAppointment.update({
      where: { id: first.id },
      data: { createdAt: new Date('2026-11-05T01:00:00.000Z') },
    })
    await prisma.machineViewingAppointment.update({
      where: { id: second.id },
      data: { createdAt: new Date('2026-11-05T02:00:00.000Z') },
    })

    const page = await queries.listForActor(purchasingId, { page: 1, pageSize: 100 })
    const ids = page.items.map(item => item.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
    expect(page.total).toBe(ids.length)
  })
})
