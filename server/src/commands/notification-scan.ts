import 'dotenv/config'

import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../infrastructure/database/prisma.service'
import { NumberingGeneratorService } from '../modules/numbering/numbering-generator.service'
import { SystemNotificationService } from '../modules/notifications/system-notification.service'

const SCAN_LOCK_KEY = 'notification-operations-scan'
const PROXY_WARNING_DAYS = 7
const PROXY_URGENT_DAYS = 1
const PROXY_EXPIRED_LOOKBACK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1_000

export interface NotificationScanResult {
  readonly status: 'completed' | 'skipped'
  readonly reason?: 'outside_window' | 'already_running'
  readonly dryRun: boolean
  readonly proxyExpiring: number
  readonly proxyExpired: number
  readonly purchasePayableDigest: boolean
  readonly packagingPendingDigest: boolean
}

export interface NotificationScanOptions {
  readonly dryRun?: boolean
  readonly now?: () => Date
}

function shanghaiParts(now: Date): { readonly dateKey: string, readonly hour: number, readonly minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    day: '2-digit', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', month: '2-digit', timeZone: 'Asia/Shanghai', year: 'numeric',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? ''
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: get('minute'),
  }
}

function shanghaiDateTime(value: Date): string {
  const { dateKey, hour, minute } = shanghaiParts(value)
  return `${dateKey} ${String(hour).padStart(2, '0')}:${minute}`
}

export function isWithinScanWindow(now: Date): boolean {
  const { hour } = shanghaiParts(now)
  return hour >= 9 && hour < 22
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS)
}

function daysRemaining(now: Date, expiresAt: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))
}

export function proxyBucket(now: Date, expiresAt: Date): '7d' | '1d' | null {
  const remaining = expiresAt.getTime() - now.getTime()
  if (remaining <= 0) {
    return null
  }
  if (remaining <= PROXY_URGENT_DAYS * DAY_MS) {
    return '1d'
  }
  if (remaining <= PROXY_WARNING_DAYS * DAY_MS) {
    return '7d'
  }
  return null
}

async function scanProxyNodes(
  prisma: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  now: Date,
  dryRun: boolean,
): Promise<number> {
  const nodes = await prisma.proxyNode.findMany({
    where: {
      expiresAt: { gt: now, lte: addDays(now, PROXY_WARNING_DAYS) },
      vendorMissing: false,
    },
    orderBy: { expiresAt: 'asc' },
    select: {
      assignedUser: { select: { displayName: true, id: true, status: true } },
      assignedUserId: true,
      expiresAt: true,
      host: true,
      id: true,
      publicIp: true,
    },
  })
  let published = 0
  for (const node of nodes) {
    const bucket = proxyBucket(now, node.expiresAt)
    if (bucket === null) {
      continue
    }
    const target = node.assignedUser !== null && node.assignedUser.status === 'ACTIVE'
      ? { kind: 'USERS' as const, userIds: [node.assignedUser.id] }
      : { kind: 'PERMISSION' as const, permissionCode: 'proxy-nodes:manage' }
    const expiryDate = node.expiresAt.toISOString().slice(0, 10)
    if (dryRun) {
      published += 1
      continue
    }
    await notifications.publish({
      eventType: 'PROXY_NODE_EXPIRING',
      source: { type: 'PROXY_NODE', id: node.id },
      target,
      templateKey: 'operations.proxy-node.expiring',
      variables: {
        assignedUserName: node.assignedUser?.displayName ?? '未绑定',
        daysRemaining: daysRemaining(now, node.expiresAt),
        expiresAt: shanghaiDateTime(node.expiresAt),
        host: node.host,
        nodeLabel: node.publicIp ?? node.host,
      },
      dedupeKey: `proxy-node-expiring:${node.id}:${expiryDate}:${bucket}`,
      priority: bucket === '1d' ? 'HIGH' : 'NORMAL',
    }, { transaction: prisma })
    published += 1
  }
  return published
}

async function scanExpiredProxyNodes(
  prisma: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  now: Date,
  dryRun: boolean,
): Promise<number> {
  const nodes = await prisma.proxyNode.findMany({
    where: {
      expiresAt: { gte: addDays(now, -PROXY_EXPIRED_LOOKBACK_DAYS), lte: now },
      vendorMissing: false,
    },
    orderBy: { expiresAt: 'asc' },
    select: {
      assignedUser: { select: { displayName: true, id: true, status: true } },
      assignedUserId: true,
      expiresAt: true,
      host: true,
      id: true,
      publicIp: true,
    },
  })
  let published = 0
  for (const node of nodes) {
    const target = node.assignedUser !== null && node.assignedUser.status === 'ACTIVE'
      ? { kind: 'USERS' as const, userIds: [node.assignedUser.id] }
      : { kind: 'PERMISSION' as const, permissionCode: 'proxy-nodes:manage' }
    if (dryRun) {
      published += 1
      continue
    }
    await notifications.publish({
      eventType: 'PROXY_NODE_EXPIRED',
      source: { type: 'PROXY_NODE', id: node.id },
      target,
      templateKey: 'operations.proxy-node.expired',
      variables: {
        assignedUserName: node.assignedUser?.displayName ?? '未绑定',
        expiresAt: shanghaiDateTime(node.expiresAt),
        host: node.host,
        nodeLabel: node.publicIp ?? node.host,
      },
      dedupeKey: `proxy-node-expired:${node.id}:${node.expiresAt.toISOString().slice(0, 10)}`,
    }, { transaction: prisma })
    published += 1
  }
  return published
}

async function scanPurchasePayableDigest(
  prisma: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  now: Date,
  dryRun: boolean,
): Promise<boolean> {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      orderStatus: 'CONFIRMED',
      paymentStatus: { not: 'PAID' },
      payables: { some: { closedAt: null, dueAmount: { gt: 0 } } },
    },
    select: {
      payables: { where: { closedAt: null, dueAmount: { gt: 0 } }, select: { dueAmount: true } },
    },
  })
  if (orders.length === 0) {
    return false
  }
  const totalDue = orders.reduce((sum, order) => {
    return order.payables.reduce((orderSum, payable) => orderSum.add(payable.dueAmount), sum)
  }, new Prisma.Decimal(0))
  if (dryRun) {
    return true
  }
  const { dateKey } = shanghaiParts(now)
  await notifications.publish({
    eventType: 'PURCHASE_PAYABLE_PENDING',
    source: { type: 'PURCHASE_PAYABLE_DIGEST', id: dateKey },
    target: { kind: 'PERMISSION', permissionCode: 'purchase-orders:payment' },
    templateKey: 'purchase.payable.pending',
    variables: {
      orderCount: orders.length,
      totalDueAmountCny: totalDue.toFixed(2),
    },
    dedupeKey: `purchase-payable-pending:${dateKey}`,
    priority: 'NORMAL',
  }, { transaction: prisma })
  return true
}

async function scanPackagingPendingDigest(
  prisma: Prisma.TransactionClient,
  notifications: SystemNotificationService,
  now: Date,
  dryRun: boolean,
): Promise<boolean> {
  const rows = await prisma.packagingCostRequest.findMany({
    where: { status: 'PENDING_PAYMENT' },
    select: { amount: true },
  })
  if (rows.length === 0) {
    return false
  }
  const total = rows.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0))
  if (dryRun) {
    return true
  }
  const { dateKey } = shanghaiParts(now)
  await notifications.publish({
    eventType: 'PACKAGING_COST_PAYMENT_PENDING',
    source: { type: 'PACKAGING_PAYMENT_DIGEST', id: dateKey },
    target: { kind: 'PERMISSION', permissionCode: 'packaging-costs:pay' },
    templateKey: 'packaging.payment.pending',
    variables: {
      requestCount: rows.length,
      totalAmountCny: total.toFixed(2),
    },
    dedupeKey: `packaging-payment-pending:${dateKey}`,
    priority: 'NORMAL',
  }, { transaction: prisma })
  return true
}

export async function scanNotifications(
  prisma: PrismaService,
  notifications: SystemNotificationService,
  options: NotificationScanOptions = {},
): Promise<NotificationScanResult> {
  const now = options.now?.() ?? new Date()
  const dryRun = options.dryRun ?? false
  if (!isWithinScanWindow(now)) {
    return {
      status: 'skipped',
      reason: 'outside_window',
      dryRun,
      proxyExpiring: 0,
      proxyExpired: 0,
      purchasePayableDigest: false,
      packagingPendingDigest: false,
    }
  }
  return prisma.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${SCAN_LOCK_KEY}, 0)) AS locked
    `)
    if (locked[0]?.locked !== true) {
      return {
        status: 'skipped',
        reason: 'already_running',
        dryRun,
        proxyExpiring: 0,
        proxyExpired: 0,
        purchasePayableDigest: false,
        packagingPendingDigest: false,
      }
    }
    const proxyExpiring = await scanProxyNodes(transaction, notifications, now, dryRun)
    const proxyExpired = await scanExpiredProxyNodes(transaction, notifications, now, dryRun)
    const purchasePayableDigest = await scanPurchasePayableDigest(transaction, notifications, now, dryRun)
    const packagingPendingDigest = await scanPackagingPendingDigest(transaction, notifications, now, dryRun)
    return {
      status: 'completed',
      dryRun,
      proxyExpiring,
      proxyExpired,
      purchasePayableDigest,
      packagingPendingDigest,
    }
  }, { timeout: 120_000 })
}

export interface NotificationScanOutput {
  log(message: string): void
  error(message: string): void
}

export async function runNotificationScanCli(
  argv: readonly string[],
  output: NotificationScanOutput = console,
  connectionString = process.env.DATABASE_URL,
): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const nowArg = argv.find(argument => argument.startsWith('--now='))
  const now = nowArg === undefined ? undefined : new Date(nowArg.slice('--now='.length))
  if (connectionString === undefined || connectionString.length === 0 || (now !== undefined && Number.isNaN(now.getTime()))) {
    output.error('Notification scan failed')
    return 1
  }
  const prisma = new PrismaService({
    getOrThrow: (key: string) => {
      if (key === 'DATABASE_URL') {
        return connectionString
      }
      throw new Error('Notification scan failed')
    },
  } as never)
  try {
    await prisma.$connect()
    const result = await scanNotifications(
      prisma,
      new SystemNotificationService(prisma, new NumberingGeneratorService(prisma)),
      {
        dryRun,
        ...(now === undefined ? {} : { now: () => now }),
      },
    )
    output.log(JSON.stringify({ kind: 'notification_scan', ...result }))
    return 0
  }
  catch {
    output.error('Notification scan failed')
    return 1
  }
  finally {
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

if (require.main === module) {
  void runNotificationScanCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
