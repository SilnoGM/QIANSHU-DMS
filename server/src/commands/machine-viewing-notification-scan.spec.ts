/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest 匹配器返回 any，用于断言调用参数。 */
import type { AuditService } from '../modules/audit/audit.service'
import { scanMachineViewingNotifications } from './machine-viewing-notification-scan'

const NOW = new Date('2026-11-05T00:30:00.000Z') // 08:30 上海
const ROW = {
  appointmentDate: new Date('2026-11-05T00:00:00.000Z'),
  appointmentNo: 'MV/20261105-0001',
  contactPerson: '李华',
  customerName: '陈先生',
  customerPhone: '0912-345-678',
  hour: 10,
  id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
  machineType: 'MINI_TILLER',
  period: 'AM',
  scheduleRevision: 1,
  site: 'NEW_TAIPEI_LINKOU',
}

function harness(options: {
  readonly locked?: boolean
  readonly rows?: readonly Record<string, unknown>[]
  readonly notificationStatus?: string
} = {}) {
  const appointment = {
    findMany: jest.fn().mockResolvedValue(options.rows ?? [ROW]),
    update: jest.fn().mockResolvedValue({}),
  }
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: options.locked ?? true }]),
    machineViewingAppointment: appointment,
    notification: {
      findUnique: jest.fn().mockResolvedValue({ status: options.notificationStatus ?? 'COMPLETED' }),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(transaction)),
  }
  const notifications = {
    publish: jest.fn().mockResolvedValue({
      notificationId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      duplicated: false,
      channels: [{ channel: 'IN_APP', status: 'CREATED', recipientCount: 1, skippedCount: 0 }],
      warnings: [],
    }),
  }
  const audit = {
    record: jest.fn().mockResolvedValue({}),
  }
  return { appointment, audit, notifications, prisma, transaction }
}

describe('scanMachineViewingNotifications', () => {
  it('skips before 08:30 and when another scan holds the lock', async () => {
    const early = harness()
    await expect(scanMachineViewingNotifications(
      early.prisma as never,
      early.notifications as never,
      early.audit as unknown as AuditService,
      { now: () => new Date('2026-11-05T00:29:00.000Z') },
    )).resolves.toMatchObject({ status: 'skipped', reason: 'before_notification_time' })
    expect(early.transaction.$queryRaw).not.toHaveBeenCalled()

    const locked = harness({ locked: false })
    await expect(scanMachineViewingNotifications(
      locked.prisma as never,
      locked.notifications as never,
      locked.audit as unknown as AuditService,
      { now: () => NOW },
    )).resolves.toMatchObject({ status: 'skipped', reason: 'already_running' })
    expect(locked.appointment.findMany).not.toHaveBeenCalled()
  })

  it('publishes one notification per due row, advances status and writes system audit', async () => {
    const run = harness()
    await expect(scanMachineViewingNotifications(
      run.prisma as never,
      run.notifications as never,
      run.audit as unknown as AuditService,
      { now: () => NOW },
    )).resolves.toEqual({
      status: 'completed',
      dryRun: false,
      due: 1,
      triggered: 1,
      advanced: 1,
      failed: 0,
    })

    expect(run.notifications.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'MACHINE_VIEWING_APPOINTMENT_CREATED',
      dedupeKey: 'machine-viewing-notified:9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a:r1',
    }), expect.objectContaining({ transaction: run.transaction }))
    expect(run.appointment.update).toHaveBeenCalledWith({
      where: { id: ROW.id },
      data: { status: 'APPOINTED' },
    })
    expect(run.audit.record).toHaveBeenCalledWith(run.transaction, expect.objectContaining({
      actorType: 'SYSTEM',
      eventType: 'MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED',
      metadata: expect.objectContaining({ trigger: 'SCHEDULED_NOTIFICATION' }),
    }))
  })

  it('counts a failed notification without advancing the row', async () => {
    const run = harness({ notificationStatus: 'FAILED' })
    await expect(scanMachineViewingNotifications(
      run.prisma as never,
      run.notifications as never,
      run.audit as unknown as AuditService,
      { now: () => NOW },
    )).resolves.toMatchObject({ triggered: 0, advanced: 0, failed: 1 })
    expect(run.appointment.update).not.toHaveBeenCalled()
    expect(run.audit.record).not.toHaveBeenCalled()
  })

  it('does not publish in dry-run mode', async () => {
    const run = harness()
    await expect(scanMachineViewingNotifications(
      run.prisma as never,
      run.notifications as never,
      run.audit as unknown as AuditService,
      { now: () => NOW, dryRun: true },
    )).resolves.toMatchObject({ status: 'completed', dryRun: true, due: 1, triggered: 0 })
    expect(run.notifications.publish).not.toHaveBeenCalled()
  })
})
