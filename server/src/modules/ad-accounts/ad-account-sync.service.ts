import { Inject, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import { SystemNotificationService } from '../notifications/system-notification.service'
import {
  AD_ACCOUNT_BALANCE_ALERT_USD,
  resolveAverageDailySpend,
  resolveAvailableBalance,
  resolveCoveredDays,
  resolveSustainableDays,
  shouldAlertLowBalance,
} from './ad-account-balance'
import type { CheetahGoAccount, CheetahGoClient, CheetahGoDailySpend } from './cheetahgo.client'
import { CHEETAHGO_CLIENT } from './cheetahgo.tokens'
import {
  SPEND_WINDOW_DAYS,
  formatShanghaiDate,
  resolveSpendWindow,
  toSpendDate,
} from './ad-account-date'

const SYNC_LOCK_KEY = 'ad-account-sync'

export type AdAccountSyncSkipReason = 'disabled' | 'already_running'

export interface AdAccountSyncResult {
  readonly status: 'completed' | 'skipped'
  readonly reason?: AdAccountSyncSkipReason
  readonly dryRun: boolean
  readonly accounts: number
  readonly missing: number
  readonly spendRows: number
  readonly alerts: number
  readonly resets: number
  readonly spendSynced: boolean
  readonly authorizedSynced: boolean
}

export interface AdAccountSyncOptions {
  readonly dryRun?: boolean
  readonly now?: () => Date
}

function emptyResult(
  status: 'completed' | 'skipped',
  dryRun: boolean,
  reason?: AdAccountSyncSkipReason,
): AdAccountSyncResult {
  return {
    status,
    reason,
    dryRun,
    accounts: 0,
    missing: 0,
    spendRows: 0,
    alerts: 0,
    resets: 0,
    spendSynced: false,
    authorizedSynced: false,
  }
}

@Injectable()
export class AdAccountSyncService {
  private readonly logger = new Logger(AdAccountSyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: SystemNotificationService,
    private readonly audit: AuditService,
    @Inject(CHEETAHGO_CLIENT) private readonly client: CheetahGoClient | null,
  ) {}

  async sync(options: AdAccountSyncOptions = {}): Promise<AdAccountSyncResult> {
    const now = options.now?.() ?? new Date()
    const dryRun = options.dryRun ?? false

    if (this.client === null) {
      return emptyResult('skipped', dryRun, 'disabled')
    }

    // 网络请求放在事务外：避免把上游抖动拖进长事务。
    const accounts = await this.client.listAccounts()
    const authorized = await this.fetchAuthorizedAccounts()
    const syncedAccounts = mergeAccounts(accounts, authorized.accounts)
    const { startDate, endDate } = resolveSpendWindow(now)
    const spend = await this.fetchSpend(startDate, endDate)
    const spendSynced = spend !== null
    const authorizedSynced = authorized.synced

    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${SYNC_LOCK_KEY}, 0)) AS locked
      `)

      if (locked[0]?.locked !== true) {
        return emptyResult('skipped', dryRun, 'already_running')
      }

      if (dryRun) {
        return {
          status: 'completed' as const,
          dryRun,
          accounts: syncedAccounts.length,
          missing: 0,
          spendRows: spend?.length ?? 0,
          alerts: 0,
          resets: 0,
          spendSynced,
          authorizedSynced,
        }
      }

      // 先整体标记缺失，再按本次返回置回 false：供应商侧消失的账户保留历史绑定。
      // 授权列表拉取失败时只标记自开户，避免把 QS-FS-01 的上一轮快照误标为未同步。
      await transaction.adAccount.updateMany({
        where: {
          vendorMissing: false,
          ...(authorizedSynced ? {} : { accountSource: 'SELF' }),
        },
        data: { vendorMissing: true },
      })

      const synced = new Map<string, { id: string, lowBalanceAlertedAt: Date | null }>()

      for (const account of syncedAccounts) {
        const row = await this.upsertAccount(transaction, account, now)
        synced.set(account.accountId, row)
      }

      const spendCount = await this.upsertSpend(transaction, spend ?? [], synced)
      const totals = aggregateSpend(spend ?? [])
      const { alerts, resets } = await this.evaluateBalanceAlerts(
        transaction,
        syncedAccounts,
        synced,
        totals,
        now,
      )

      const missing = await transaction.adAccount.count({ where: { vendorMissing: true } })

      await this.audit.record(transaction, {
        eventType: 'AD_ACCOUNT_SYNCED',
        outcome: 'SUCCESS',
        actorType: 'SYSTEM',
        targetType: 'AD_ACCOUNT',
        metadata: {
          accounts: syncedAccounts.length,
          missing,
          spendRows: spendCount,
          alerts,
          resets,
          spendSynced,
          authorizedSynced,
        },
      })

      return {
        status: 'completed' as const,
        dryRun,
        accounts: syncedAccounts.length,
        missing,
        spendRows: spendCount,
        alerts,
        resets,
        spendSynced,
        authorizedSynced,
      }
    }, { timeout: 120_000 })
  }

  private async fetchSpend(startDate: string, endDate: string): Promise<CheetahGoDailySpend[] | null> {
    if (this.client === null) {
      return null
    }

    try {
      return await this.client.listDailySpend(startDate, endDate)
    } catch (error) {
      // 消耗失败不影响账户主数据同步；结果里如实标记，由调用方告警。
      this.logger.warn(`广告账户日消耗拉取失败，本轮跳过消耗更新: ${String(error)}`)
      return null
    }
  }

  /**
   * 授权账户接口失败不影响自开户同步：本轮保留授权户上次快照，
   * 由 authorizedSynced=false 让调用方与审计知道这一轮没有更新授权户。
   */
  private async fetchAuthorizedAccounts(): Promise<{ accounts: CheetahGoAccount[], synced: boolean }> {
    if (this.client === null) {
      return { accounts: [], synced: false }
    }

    try {
      return { accounts: await this.client.listAuthorizedAccounts(), synced: true }
    } catch (error) {
      this.logger.warn(`授权广告账户拉取失败，本轮保留上次快照: ${String(error)}`)
      return { accounts: [], synced: false }
    }
  }

  private async upsertAccount(
    transaction: Prisma.TransactionClient,
    account: CheetahGoAccount,
    now: Date,
  ): Promise<{ id: string, lowBalanceAlertedAt: Date | null }> {
    return transaction.adAccount.upsert({
      where: { accountId: account.accountId },
      create: {
        accountId: account.accountId,
        accountName: account.accountName,
        accountSource: account.accountSource,
        companyCn: account.companyCn,
        accountStatus: account.accountStatus,
        accountStatusText: account.accountStatusText,
        freeze: account.freeze,
        disableReason: account.disableReason,
        spendCap: account.spendCap,
        amountSpent: account.amountSpent,
        dailySpendLimit: account.dailySpendLimit,
        disabledTransferAmount: account.disabledTransferAmount,
        createdTime: account.createdTime,
        vendorUpdatedAt: account.vendorUpdatedAt,
        vendorMissing: false,
        lastSyncedAt: now,
      },
      update: {
        accountName: account.accountName,
        accountSource: account.accountSource,
        companyCn: account.companyCn,
        accountStatus: account.accountStatus,
        accountStatusText: account.accountStatusText,
        freeze: account.freeze,
        disableReason: account.disableReason,
        spendCap: account.spendCap,
        amountSpent: account.amountSpent,
        dailySpendLimit: account.dailySpendLimit,
        disabledTransferAmount: account.disabledTransferAmount,
        createdTime: account.createdTime,
        vendorUpdatedAt: account.vendorUpdatedAt,
        vendorMissing: false,
        lastSyncedAt: now,
      },
      select: { id: true, lowBalanceAlertedAt: true },
    })
  }

  private async upsertSpend(
    transaction: Prisma.TransactionClient,
    rows: readonly CheetahGoDailySpend[],
    synced: Map<string, { id: string, lowBalanceAlertedAt: Date | null }>,
  ): Promise<number> {
    let count = 0

    for (const row of rows) {
      const account = synced.get(row.accountId)

      if (!account) {
        continue
      }

      const spendDate = toSpendDate(row.date)

      await transaction.adAccountSpendDaily.upsert({
        where: { adAccountId_spendDate: { adAccountId: account.id, spendDate } },
        create: { adAccountId: account.id, spendDate, spend: row.spend },
        update: { spend: row.spend },
      })

      count += 1
    }

    return count
  }

  /**
   * 余额预警按「状态跃迁」触发：跌穿阈值且尚未标记时发一次，回升到阈值以上时清空标记。
   * 这样每轮 15 分钟的同步不会把同一条预警反复推送。
   */
  private async evaluateBalanceAlerts(
    transaction: Prisma.TransactionClient,
    accounts: readonly CheetahGoAccount[],
    synced: Map<string, { id: string, lowBalanceAlertedAt: Date | null }>,
    totals: Map<string, Prisma.Decimal>,
    now: Date,
  ): Promise<{ alerts: number, resets: number }> {
    let alerts = 0
    let resets = 0
    const alertDate = formatShanghaiDate(now)

    for (const account of accounts) {
      const row = synced.get(account.accountId)

      if (!row) {
        continue
      }

      const availableBalance = resolveAvailableBalance({
        spendCap: account.spendCap,
        amountSpent: account.amountSpent,
        disabledTransferAmount: account.disabledTransferAmount,
      })
      const shouldAlert = shouldAlertLowBalance({ availableBalance, vendorMissing: false })

      if (!shouldAlert) {
        if (row.lowBalanceAlertedAt !== null) {
          await transaction.adAccount.update({
            where: { id: row.id },
            data: { lowBalanceAlertedAt: null },
          })
          resets += 1
        }

        continue
      }

      if (row.lowBalanceAlertedAt !== null) {
        continue
      }

      const coveredDays = resolveCoveredDays(account.createdTime, now, SPEND_WINDOW_DAYS)
      // 授权户没有日消耗数据：日均与续航一律显示「—」，不能把 0 当成真实消耗。
      const averageDailySpend = account.accountSource === 'AUTHORIZED'
        ? null
        : resolveAverageDailySpend(
            totals.get(account.accountId) ?? new Prisma.Decimal(0),
            coveredDays,
          )
      const expectedDays = resolveSustainableDays({
        availableBalance,
        averageDailySpend: averageDailySpend ?? new Prisma.Decimal(0),
      })
      const assignedUser = await this.resolveAssignee(transaction, row.id)

      await this.notifications.publish({
        eventType: 'AD_ACCOUNT_BALANCE_LOW',
        source: { type: 'AD_ACCOUNT', id: row.id },
        target: assignedUser === null
          ? { kind: 'PERMISSION', permissionCode: 'ad-accounts:manage' }
          : { kind: 'USERS', userIds: [assignedUser] },
        variables: {
          adAccountName: account.accountName,
          adAccountNo: account.accountId,
          availableBalance: (availableBalance ?? new Prisma.Decimal(0)).toFixed(2),
          balanceThreshold: new Prisma.Decimal(AD_ACCOUNT_BALANCE_ALERT_USD).toFixed(2),
          sevenDayAverage: averageDailySpend === null ? '—' : averageDailySpend.toFixed(2),
          expectedDays: expectedDays === null ? '—' : String(expectedDays),
          companyName: account.companyCn
            ?? (account.accountSource === 'AUTHORIZED' ? '授权账户' : '—'),
        },
        dedupeKey: `ad-account-balance-low:${account.accountId}:${alertDate}`,
      }, { transaction, now })

      await transaction.adAccount.update({
        where: { id: row.id },
        data: { lowBalanceAlertedAt: now },
      })
      alerts += 1
    }

    return { alerts, resets }
  }

  /** 绑定人已停用或未绑定时回落到管理权限接收人，避免预警无人接收。 */
  private async resolveAssignee(
    transaction: Prisma.TransactionClient,
    adAccountId: string,
  ): Promise<string | null> {
    const account = await transaction.adAccount.findUnique({
      where: { id: adAccountId },
      select: { assignedUserId: true },
    })

    if (!account?.assignedUserId) {
      return null
    }

    const user = await transaction.user.findUnique({
      where: { id: account.assignedUserId },
      select: { id: true, status: true },
    })

    return user?.status === 'ACTIVE' ? user.id : null
  }
}

function aggregateSpend(rows: readonly CheetahGoDailySpend[]): Map<string, Prisma.Decimal> {
  const totals = new Map<string, Prisma.Decimal>()

  for (const row of rows) {
    const current = totals.get(row.accountId) ?? new Prisma.Decimal(0)
    totals.set(row.accountId, current.plus(new Prisma.Decimal(row.spend)))
  }

  return totals
}

/** 同一 accountId 同时出现在两类列表时以自开户为准（字段更完整）。 */
function mergeAccounts(
  selfAccounts: readonly CheetahGoAccount[],
  authorizedAccounts: readonly CheetahGoAccount[],
): CheetahGoAccount[] {
  const merged = new Map(selfAccounts.map((account) => [account.accountId, account]))

  for (const account of authorizedAccounts) {
    if (!merged.has(account.accountId)) {
      merged.set(account.accountId, account)
    }
  }

  return [...merged.values()]
}
