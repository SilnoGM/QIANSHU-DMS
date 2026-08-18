import { Prisma } from '../../../generated/prisma/client'
import {
  calculateCompanyShareRateUnits,
  formatFundShareRateUnits,
  parseFundShareRateUnits,
} from '../domain'
import type {
  FundAccountView,
} from './fund-account.contract'
import { FUND_POSTING_ERROR_CODES, FundPostingError } from './fund-posting.errors'

export const FUND_ACCOUNT_VIEW_SELECT = {
  id: true,
  ownerType: true,
  userId: true,
  currency: true,
  balance: true,
  userShareRate: true,
  version: true,
  shareRateUpdatedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
      status: true,
    },
  },
} as const satisfies Prisma.FundAccountSelect

export type FundAccountViewRow = Prisma.FundAccountGetPayload<{
  select: typeof FUND_ACCOUNT_VIEW_SELECT
}>

function internalError(): never {
  throw new FundPostingError(FUND_POSTING_ERROR_CODES.INTERNAL_ERROR)
}

function normalizeDecimal(value: Prisma.Decimal): string {
  try {
    return value.toFixed(4)
  }
  catch {
    return internalError()
  }
}

/**
 * Prisma Decimal 只在持久化边界内存在；所有应用返回值立即转成四位 decimal
 * string。公司比例始终由用户比例推导，绝不从账户表读取第二份状态。
 */
export function mapFundAccountView(row: FundAccountViewRow): FundAccountView {
  if (
    row.currency !== 'CNY'
    || !['USER', 'COMPANY'].includes(row.ownerType)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) {
    return internalError()
  }

  const ownerType = row.ownerType
  if (ownerType === 'USER') {
    if (
      row.userId === null
      || row.user === null
      || row.userShareRate === null
      || !['ACTIVE', 'DISABLED'].includes(row.user.status)
    ) {
      return internalError()
    }

    const userShareRate = normalizeDecimal(row.userShareRate)
    const companyShareRate = formatFundShareRateUnits(
      calculateCompanyShareRateUnits(parseFundShareRateUnits(userShareRate)),
    )

    return Object.freeze({
      id: row.id,
      ownerType,
      user: Object.freeze({
        id: row.user.id,
        username: row.user.username,
        displayName: row.user.displayName,
        status: row.user.status,
      }),
      currency: 'CNY',
      balance: normalizeDecimal(row.balance),
      userShareRate,
      companyShareRate,
      version: row.version,
      shareRateUpdatedAt: row.shareRateUpdatedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  }

  if (
    row.userId !== null
    || row.user !== null
    || row.userShareRate !== null
    || row.shareRateUpdatedAt !== null
  ) {
    return internalError()
  }

  return Object.freeze({
    id: row.id,
    ownerType,
    user: null,
    currency: 'CNY',
    balance: normalizeDecimal(row.balance),
    userShareRate: null,
    companyShareRate: null,
    version: row.version,
    shareRateUpdatedAt: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}
