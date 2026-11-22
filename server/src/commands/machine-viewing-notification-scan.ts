import 'dotenv/config'

import { Prisma } from '../generated/prisma/client'
import { AuditEventType } from '../generated/prisma/enums'
import { PrismaService } from '../infrastructure/database/prisma.service'
import { AuditService } from '../modules/audit/audit.service'
import {
  isMachineViewingNotificationTimeReached,
  publishAppointmentNotification,
} from '../modules/machine-viewings/machine-viewing-notification'
import { shanghaiCalendarDate } from '../modules/machine-viewings/machine-viewing.logic'
import { NumberingGeneratorService } from '../modules/numbering/numbering-generator.service'
import { SystemNotificationService } from '../modules/notifications/system-notification.service'

const SCAN_LOCK_KEY = 'machine-viewing-notification-scan'

export interface MachineViewingNotificationScanResult {
  readonly status: 'completed' | 'skipped'
  readonly reason?: 'before_notification_time' | 'already_running'
  readonly dryRun: boolean
  readonly due: number
  readonly triggered: number
  readonly advanced: number
  readonly failed: number
}

export interface MachineViewingNotificationScanOptions {
  readonly dryRun?: boolean
  readonly now?: () => Date
}

function skipped(
  reason: 'before_notification_time' | 'already_running',
  dryRun: boolean,
): MachineViewingNotificationScanResult {
  return {
    status: 'skipped',
    reason,
    dryRun,
    due: 0,
    triggered: 0,
    advanced: 0,
    failed: 0,
  }
}

/**
 * 每天 08:30 发送「今天 + 待预约」的看机通知。
 *
 * 与通用通知扫描分开：通用扫描的 09:00–22:00 窗口和 09:05/13:05 节奏保持不变，
 * 这里只处理看机预约，并且允许 08:30 后当天补跑。
 */
export async function scanMachineViewingNotifications(
  prisma: PrismaService,
  notifications: SystemNotificationService,
  audit: AuditService,
  options: MachineViewingNotificationScanOptions = {},
): Promise<MachineViewingNotificationScanResult> {
  const now = options.now?.() ?? new Date()
  const dryRun = options.dryRun ?? false
  if (!isMachineViewingNotificationTimeReached(now)) {
    return skipped('before_notification_time', dryRun)
  }
  const todayParts = shanghaiCalendarDate(now)
  const today = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day))
  const dateKey = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
  const requestId = `machine-viewing-scan:${dateKey}`

  return prisma.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${SCAN_LOCK_KEY}, 0)) AS locked
    `)
    if (locked[0]?.locked !== true) {
      return skipped('already_running', dryRun)
    }

    const rows = await transaction.machineViewingAppointment.findMany({
      where: {
        appointmentDate: today,
        status: 'PENDING_APPOINTMENT',
      },
      orderBy: [{ appointmentNo: 'asc' }],
      select: {
        appointmentNo: true,
        appointmentDate: true,
        contactPerson: true,
        customerName: true,
        customerPhone: true,
        hour: true,
        id: true,
        machineType: true,
        period: true,
        scheduleRevision: true,
        site: true,
      },
    })
    if (dryRun) {
      return {
        status: 'completed',
        dryRun,
        due: rows.length,
        triggered: 0,
        advanced: 0,
        failed: 0,
      }
    }

    let triggered = 0
    let advanced = 0
    let failed = 0
    for (const row of rows) {
      const accepted = await publishAppointmentNotification(
        transaction,
        notifications,
        row,
        now,
      )
      if (!accepted) {
        failed += 1
        continue
      }
      triggered += 1
      await transaction.machineViewingAppointment.update({
        where: { id: row.id },
        data: { status: 'APPOINTED' },
      })
      advanced += 1
      await audit.record(transaction, {
        eventType: AuditEventType.MACHINE_VIEWING_APPOINTMENT_STATUS_CHANGED,
        outcome: 'SUCCESS',
        actorType: 'SYSTEM',
        requestId,
        targetType: 'MACHINE_VIEWING_APPOINTMENT',
        targetId: row.id,
        metadata: {
          appointmentNo: row.appointmentNo,
          fromStatus: 'PENDING_APPOINTMENT',
          toStatus: 'APPOINTED',
          trigger: 'SCHEDULED_NOTIFICATION',
          scheduleRevision: row.scheduleRevision,
        },
      })
    }
    return {
      status: 'completed',
      dryRun,
      due: rows.length,
      triggered,
      advanced,
      failed,
    }
  }, { timeout: 120_000 })
}

export interface MachineViewingNotificationScanOutput {
  log(message: string): void
  error(message: string): void
}

export async function runMachineViewingNotificationScanCli(
  argv: readonly string[],
  output: MachineViewingNotificationScanOutput = console,
  connectionString = process.env.DATABASE_URL,
): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const nowArg = argv.find(argument => argument.startsWith('--now='))
  const now = nowArg === undefined ? undefined : new Date(nowArg.slice('--now='.length))
  if (connectionString === undefined || connectionString.length === 0 || (now !== undefined && Number.isNaN(now.getTime()))) {
    output.error('Machine viewing notification scan failed')
    return 1
  }
  const prisma = new PrismaService({
    getOrThrow: (key: string) => {
      if (key === 'DATABASE_URL') {
        return connectionString
      }
      throw new Error('Machine viewing notification scan failed')
    },
  } as never)
  try {
    await prisma.$connect()
    const result = await scanMachineViewingNotifications(
      prisma,
      new SystemNotificationService(prisma, new NumberingGeneratorService(prisma)),
      new AuditService(),
      {
        dryRun,
        ...(now === undefined ? {} : { now: () => now }),
      },
    )
    output.log(JSON.stringify({ kind: 'machine_viewing_notification_scan', ...result }))
    return 0
  }
  catch {
    output.error('Machine viewing notification scan failed')
    return 1
  }
  finally {
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

if (require.main === module) {
  void runMachineViewingNotificationScanCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
