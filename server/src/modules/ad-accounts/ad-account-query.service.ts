import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  AD_ACCOUNT_BALANCE_ALERT_USD,
  resolveAverageDailySpend,
  resolveAvailableBalance,
  resolveCoveredDays,
  resolveSustainableDays,
  shouldAlertLowBalance,
} from './ad-account-balance'
import { SPEND_WINDOW_DAYS, resolveSpendWindow, toSpendDate } from './ad-account-date'
import type {
  AdAccountAssigneeDto,
  AdAccountBalanceAlertSummaryDto,
  AdAccountDto,
  AdAccountListDto,
} from './ad-account.dto'

const ZERO = new Prisma.Decimal(0)

@Injectable()
export class AdAccountQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string): Promise<AdAccountListDto> {
    return { list: await this.load({ assignedUserId: userId }) }
  }

  async listAll(): Promise<AdAccountListDto> {
    return { list: await this.load({}) }
  }

  async balanceAlertSummary(userId: string): Promise<AdAccountBalanceAlertSummaryDto> {
    const [mine, all] = await Promise.all([
      this.countLowBalance({ assignedUserId: userId }),
      this.countLowBalance({}),
    ])

    return { mine, all, threshold: AD_ACCOUNT_BALANCE_ALERT_USD }
  }

  async assignableUsers(keyword?: string): Promise<AdAccountAssigneeDto[]> {
    const trimmed = keyword?.trim()
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        ...(trimmed
          ? {
              OR: [
                { displayName: { contains: trimmed, mode: 'insensitive' } },
                { username: { contains: trimmed, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { displayName: 'asc' },
      take: 50,
      select: { id: true, displayName: true },
    })

    return users
  }

  private async countLowBalance(where: Prisma.AdAccountWhereInput): Promise<number> {
    const rows = await this.prisma.adAccount.findMany({
      where: { ...where, vendorMissing: false, spendCap: { gt: 0 } },
      select: { spendCap: true, amountSpent: true, disabledTransferAmount: true, vendorMissing: true },
    })

    return rows.filter((row) => shouldAlertLowBalance({
      availableBalance: resolveAvailableBalance({
        spendCap: row.spendCap,
        amountSpent: row.amountSpent,
        disabledTransferAmount: row.disabledTransferAmount,
      }),
      vendorMissing: row.vendorMissing,
    })).length
  }

  private async load(where: Prisma.AdAccountWhereInput): Promise<AdAccountDto[]> {
    const now = new Date()
    const accounts = await this.prisma.adAccount.findMany({
      where,
      orderBy: { accountName: 'asc' },
      include: { assignedUser: { select: { id: true, displayName: true } } },
    })

    if (accounts.length === 0) {
      return []
    }

    const { startDate, endDate } = resolveSpendWindow(now)
    const spendRows = await this.prisma.adAccountSpendDaily.findMany({
      where: {
        adAccountId: { in: accounts.map((account) => account.id) },
        spendDate: { gte: toSpendDate(startDate), lte: toSpendDate(endDate) },
      },
      select: { adAccountId: true, spend: true },
    })

    const totals = new Map<string, Prisma.Decimal>()

    for (const row of spendRows) {
      const current = totals.get(row.adAccountId) ?? ZERO
      totals.set(row.adAccountId, current.plus(row.spend))
    }

    const views = accounts.map((account) => this.toView(
      account,
      totals.get(account.id) ?? ZERO,
      now,
    ))

    // 按风险排序：续航最短的在前，无法估算的排末尾。
    return views.sort((left, right) => {
      const leftDays = left.sustainableDays
      const rightDays = right.sustainableDays

      if (leftDays === null && rightDays === null) {
        return left.accountName.localeCompare(right.accountName)
      }

      if (leftDays === null) {
        return 1
      }

      if (rightDays === null) {
        return -1
      }

      return leftDays - rightDays || left.accountName.localeCompare(right.accountName)
    })
  }

  private toView(
    account: {
      id: string
      accountId: string
      accountName: string
      accountSource: 'SELF' | 'AUTHORIZED'
      companyCn: string | null
      accountStatus: number
      accountStatusText: string | null
      freeze: number | null
      disableReason: number
      spendCap: Prisma.Decimal
      amountSpent: Prisma.Decimal
      dailySpendLimit: Prisma.Decimal | null
      disabledTransferAmount: Prisma.Decimal
      vendorMissing: boolean
      createdTime: Date
      vendorUpdatedAt: Date | null
      lastSyncedAt: Date
      assignedUser: { id: string, displayName: string } | null
    },
    totalSpend: Prisma.Decimal,
    now: Date,
  ): AdAccountDto {
    const availableBalance = resolveAvailableBalance({
      spendCap: account.spendCap,
      amountSpent: account.amountSpent,
      disabledTransferAmount: account.disabledTransferAmount,
    })
    const coveredDays = resolveCoveredDays(account.createdTime, now, SPEND_WINDOW_DAYS)
    // 授权户没有日消耗数据；余额耗尽仍可判定为 0 天，其余情况显示「—」。
    const sevenDayAverage = account.accountSource === 'AUTHORIZED'
      ? null
      : resolveAverageDailySpend(totalSpend, coveredDays)
    const sustainableDays = resolveSustainableDays({
      availableBalance,
      averageDailySpend: sevenDayAverage ?? new Prisma.Decimal(0),
    })

    return {
      id: account.id,
      accountId: account.accountId,
      accountName: account.accountName,
      accountSource: account.accountSource,
      companyCn: account.companyCn,
      accountStatus: account.accountStatus,
      accountStatusText: account.accountStatusText,
      freeze: account.freeze,
      disableReason: account.disableReason,
      spendCap: account.spendCap.toFixed(2),
      amountSpent: account.amountSpent.toFixed(2),
      dailySpendLimit: account.dailySpendLimit === null ? null : account.dailySpendLimit.toFixed(2),
      disabledTransferAmount: account.disabledTransferAmount.toFixed(2),
      availableBalance: availableBalance === null ? null : availableBalance.toFixed(2),
      sevenDayAverage: sevenDayAverage === null ? null : sevenDayAverage.toFixed(2),
      sustainableDays,
      lowBalance: shouldAlertLowBalance({ availableBalance, vendorMissing: account.vendorMissing }),
      balanceAlertThreshold: AD_ACCOUNT_BALANCE_ALERT_USD,
      vendorMissing: account.vendorMissing,
      createdTime: account.createdTime.toISOString(),
      vendorUpdatedAt: account.vendorUpdatedAt === null ? null : account.vendorUpdatedAt.toISOString(),
      lastSyncedAt: account.lastSyncedAt.toISOString(),
      assignedUser: account.assignedUser,
    }
  }
}
