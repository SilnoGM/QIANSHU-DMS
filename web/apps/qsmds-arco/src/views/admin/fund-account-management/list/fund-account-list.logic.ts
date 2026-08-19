import type {
  FundAccountDto,
  FundAccountPageDto,
  UserDto,
} from '@/api/generated/types.gen'
import type { FundAccountListQuery } from '@/api/modules/fund-accounts'
import type { CurrencyDescriptor } from '@/components/base/currency'

import Decimal from 'decimal.js'

interface FundAccountListSorting {
  readonly desc: boolean
  readonly id: string
}

export interface FundAccountListQueryInput {
  readonly filters: Readonly<Record<string, unknown>>
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly sorting: readonly FundAccountListSorting[]
}

export interface FundBalanceState {
  readonly label: '余额正常' | '负余额'
  readonly tone: 'negative' | 'neutral' | 'positive'
}

const ALLOWED_PAGE_SIZES = new Set([20, 50, 100])
const SORT_FIELDS = new Set<NonNullable<FundAccountListQuery['sortBy']>>([
  'balance',
  'createdAt',
  'updatedAt',
  'userShareRate',
])

/**
 * 通用表格可以产生任意列 id；这里只把 Server 明确支持的排序字段写入查询，
 * 防止展示列名称被误当成公共 API 参数。搜索只 trim，不改变用户输入大小写。
 */
export function buildFundAccountListQuery(
  input: FundAccountListQueryInput,
): FundAccountListQuery {
  const query: FundAccountListQuery = {
    page: Number.isSafeInteger(input.page) && input.page >= 1 ? input.page : 1,
    pageSize: ALLOWED_PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
  }
  const search = input.search.trim()
  if (search !== '') {
    query.search = search
  }
  if (
    input.filters.ownerType === 'USER'
    || input.filters.ownerType === 'COMPANY'
  ) {
    query.ownerType = input.filters.ownerType
  }

  const firstSort = input.sorting[0]
  if (firstSort && SORT_FIELDS.has(
    firstSort.id as NonNullable<FundAccountListQuery['sortBy']>,
  )) {
    query.sortBy = firstSort.id as NonNullable<FundAccountListQuery['sortBy']>
    query.sortOrder = firstSort.desc ? 'desc' : 'asc'
  }
  return query
}

/** 页面状态保留 version 供 mutation 使用，但列表列定义不得把它展示出来。 */
export function adaptFundAccountPage(
  page: FundAccountPageDto,
): FundAccountPageDto {
  return {
    ...page,
    items: page.items.map(account => ({
      ...account,
      user: account.user === null ? null : { ...account.user },
    })),
  }
}

/**
 * 开户候选来自用户目录减去全部 USER 账户。公司账户没有 user，不参与集合；
 * DISABLED 用户仍保留状态交给管理员判断，避免前端私自添加 Server 未声明的限制。
 */
export function findUnopenedFundAccountUsers(
  users: readonly UserDto[],
  accounts: readonly FundAccountDto[],
): UserDto[] {
  const openedUserIds = new Set(accounts.flatMap(account => (
    account.ownerType === 'USER' && account.user !== null
      ? [account.user.id]
      : []
  )))
  return users.filter(user => !openedUserIds.has(user.id))
}

export function findCompanyFundAccount(
  accounts: readonly FundAccountDto[],
): FundAccountDto | null {
  return accounts.find(account => account.ownerType === 'COMPANY') ?? null
}

/** 资金域固定两位小数；描述符仍源自应用货币目录，不复制名称或符号。 */
export function withFundAccountPrecision(
  currencies: readonly CurrencyDescriptor[],
): CurrencyDescriptor[] {
  return currencies
    .filter(currency => currency.code === 'CNY')
    .map(currency => ({ ...currency, minorUnit: 2 }))
}

export function getFundBalanceState(balance: string): FundBalanceState {
  const comparison = new Decimal(balance).comparedTo(0)
  const tone = comparison < 0
    ? 'negative'
    : comparison > 0
      ? 'positive'
      : 'neutral'
  return {
    label: tone === 'negative' ? '负余额' : '余额正常',
    tone,
  }
}

export function formatFundShareRate(rate: null | string): string {
  if (rate === null) {
    return '—'
  }
  return `${new Decimal(rate).toFixed(2)}%`
}
