import 'dotenv/config'

import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../infrastructure/database/prisma.service'

export const NOTIFICATION_CLEANUP_BATCH_SIZE = 500
export const NOTIFICATION_CLEANUP_TIME_BUDGET_MS = 60_000
export const INBOX_UNARCHIVED_RETENTION_DAYS = 180
export const INBOX_ARCHIVED_RETENTION_DAYS = 365
const CLEANUP_FAILURE_MESSAGE = 'Notification cleanup failed'

export interface NotificationCleanupCounts {
  readonly inboxUnarchivedDeleted: number
  readonly inboxArchivedDeleted: number
  readonly deliveriesDeleted: number
  readonly notificationsDeleted: number
}

export interface NotificationCleanupResult {
  readonly status: 'completed'
  readonly counts: NotificationCleanupCounts
  readonly timeBudgetReached: boolean
}

export interface NotificationCleanupOptions {
  readonly now?: () => Date
  readonly batchSize?: number
  readonly timeBudgetMs?: number
}

function emptyCounts(): {
  inboxUnarchivedDeleted: number
  inboxArchivedDeleted: number
  deliveriesDeleted: number
  notificationsDeleted: number
} {
  return {
    inboxUnarchivedDeleted: 0,
    inboxArchivedDeleted: 0,
    deliveriesDeleted: 0,
    notificationsDeleted: 0,
  }
}

function subtractDays(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000)
}

async function deleteInboxBatches(
  prisma: PrismaService,
  where: Prisma.NotificationInboxItemWhereInput,
  orderField: 'createdAt' | 'archivedAt',
  batchSize: number,
  deadline: number,
): Promise<{ deleted: number, timedOut: boolean }> {
  let deleted = 0
  while (Date.now() < deadline) {
    const rows = await prisma.notificationInboxItem.findMany({
      where,
      select: { id: true },
      orderBy: orderField === 'createdAt'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : [{ archivedAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    })
    if (rows.length === 0) {
      return { deleted, timedOut: false }
    }
    const result = await prisma.notificationInboxItem.deleteMany({
      where: { id: { in: rows.map(row => row.id) } },
    })
    deleted += result.count
    if (rows.length < batchSize) {
      return { deleted, timedOut: false }
    }
  }
  return { deleted, timedOut: true }
}

async function deleteDeliveryBatches(
  prisma: PrismaService,
  cutoff: Date,
  batchSize: number,
  deadline: number,
): Promise<{ deleted: number, timedOut: boolean }> {
  let deleted = 0
  while (Date.now() < deadline) {
    const rows = await prisma.assistantDelivery.findMany({
      where: { createdAt: { lte: cutoff } },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    })
    if (rows.length === 0) {
      return { deleted, timedOut: false }
    }
    const result = await prisma.assistantDelivery.deleteMany({
      where: { id: { in: rows.map(row => row.id) } },
    })
    deleted += result.count
    if (rows.length < batchSize) {
      return { deleted, timedOut: false }
    }
  }
  return { deleted, timedOut: true }
}

async function deleteNotificationBatches(
  prisma: PrismaService,
  cutoff: Date,
  batchSize: number,
  deadline: number,
): Promise<{ deleted: number, timedOut: boolean }> {
  let deleted = 0
  while (Date.now() < deadline) {
    const rows = await prisma.notification.findMany({
      where: {
        createdAt: { lte: cutoff },
        inboxItems: { none: {} },
        deliveries: { none: {} },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    })
    if (rows.length === 0) {
      return { deleted, timedOut: false }
    }
    const result = await prisma.notification.deleteMany({
      where: { id: { in: rows.map(row => row.id) } },
    })
    deleted += result.count
    if (rows.length < batchSize) {
      return { deleted, timedOut: false }
    }
  }
  return { deleted, timedOut: true }
}

export async function cleanupNotificationData(
  prisma: PrismaService,
  options: NotificationCleanupOptions = {},
): Promise<NotificationCleanupResult> {
  const counts = emptyCounts()
  const now = options.now?.() ?? new Date()
  const batchSize = options.batchSize ?? NOTIFICATION_CLEANUP_BATCH_SIZE
  const deadline = Date.now() + (options.timeBudgetMs ?? NOTIFICATION_CLEANUP_TIME_BUDGET_MS)
  const settings = await prisma.notificationSettings.findUnique({ where: { id: 'default' } })
  const notificationRetentionDays = settings?.notificationRetentionDays ?? 180
  const deliveryRetentionDays = settings?.deliveryRetentionDays ?? 90
  let timeBudgetReached = false

  const unarchivedCutoff = subtractDays(now, INBOX_UNARCHIVED_RETENTION_DAYS)
  const unarchived = await deleteInboxBatches(
    prisma,
    { archivedAt: null, createdAt: { lte: unarchivedCutoff } },
    'createdAt',
    batchSize,
    deadline,
  )
  counts.inboxUnarchivedDeleted = unarchived.deleted
  timeBudgetReached ||= unarchived.timedOut

  const archivedCutoff = subtractDays(now, INBOX_ARCHIVED_RETENTION_DAYS)
  const archived = await deleteInboxBatches(
    prisma,
    { archivedAt: { not: null, lte: archivedCutoff } },
    'archivedAt',
    batchSize,
    deadline,
  )
  counts.inboxArchivedDeleted = archived.deleted
  timeBudgetReached ||= archived.timedOut

  const deliveries = await deleteDeliveryBatches(
    prisma,
    subtractDays(now, deliveryRetentionDays),
    batchSize,
    deadline,
  )
  counts.deliveriesDeleted = deliveries.deleted
  timeBudgetReached ||= deliveries.timedOut

  const notifications = await deleteNotificationBatches(
    prisma,
    subtractDays(now, notificationRetentionDays),
    batchSize,
    deadline,
  )
  counts.notificationsDeleted = notifications.deleted
  timeBudgetReached ||= notifications.timedOut

  return { status: 'completed', counts, timeBudgetReached }
}

export interface NotificationOperationsOutput {
  log(message: string): void
  error(message: string): void
}

export async function runNotificationOperationsCli(
  argv: readonly string[],
  output: NotificationOperationsOutput = console,
  connectionString = process.env.DATABASE_URL,
): Promise<number> {
  if (argv.length !== 1 || argv[0] !== 'cleanup' || connectionString === undefined || connectionString.length === 0) {
    output.error(CLEANUP_FAILURE_MESSAGE)
    return 1
  }
  const prisma = new PrismaService({
    getOrThrow: (key: string) => {
      if (key === 'DATABASE_URL') {
        return connectionString
      }
      throw new Error(CLEANUP_FAILURE_MESSAGE)
    },
  } as never)
  try {
    await prisma.$connect()
    const result = await cleanupNotificationData(prisma)
    output.log(JSON.stringify({ kind: 'notification_cleanup', ...result }))
    return 0
  }
  catch {
    output.error(CLEANUP_FAILURE_MESSAGE)
    return 1
  }
  finally {
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

if (require.main === module) {
  void runNotificationOperationsCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
