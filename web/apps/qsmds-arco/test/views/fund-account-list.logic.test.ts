import type {
  FundAccountDto,
  FundAccountPageDto,
  UserDto,
} from '../../src/api/generated/types.gen'
import type { CurrencyDescriptor } from '../../src/components/base/currency'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 资金账户列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  adaptFundAccountPage,
  buildFundAccountListQuery,
  findCompanyFundAccount,
  findUnopenedFundAccountUsers,
  formatFundShareRate,
  getFundBalanceState,
  withFundAccountPrecision,
} from '../../src/views/admin/fund-account-management/list/fund-account-list.logic'

function accountFixture(
  id: string,
  ownerType: FundAccountDto['ownerType'],
  userId?: string,
): FundAccountDto {
  return {
    balance: ownerType === 'COMPANY' ? '100.00' : '-20.12',
    companyShareRate: ownerType === 'COMPANY' ? null : '70.00',
    createdAt: '2026-08-18T01:00:00.000Z',
    currency: 'CNY',
    id,
    ownerType,
    shareRateUpdatedAt: ownerType === 'COMPANY'
      ? null
      : '2026-08-18T02:00:00.000Z',
    updatedAt: '2026-08-18T03:00:00.000Z',
    user: userId === undefined
      ? null
      : {
          displayName: `用户 ${userId}`,
          id: userId,
          status: 'ACTIVE',
          username: `member-${userId}`,
        },
    userShareRate: ownerType === 'COMPANY' ? null : '30.00',
    version: 3,
  }
}

function userFixture(id: string, status: UserDto['status'] = 'ACTIVE'): UserDto {
  return {
    createdAt: '2026-08-18T01:00:00.000Z',
    displayName: `用户 ${id}`,
    id,
    lastLoginAt: null,
    mustChangePassword: false,
    profile: {
      avatarUrl: null,
      createdAt: '2026-08-18T01:00:00.000Z',
      email: null,
      mobileE164: null,
      remark: null,
      updatedAt: '2026-08-18T01:00:00.000Z',
    },
    roleIds: [],
    status,
    updatedAt: '2026-08-18T01:00:00.000Z',
    username: `member-${id}`,
  }
}

test('列表查询规范化搜索、主体筛选、分页和单列排序', () => {
  assert.deepEqual(buildFundAccountListQuery({
    filters: { ownerType: 'USER' },
    page: 2,
    pageSize: 50,
    search: '  member-001  ',
    sorting: [{ desc: false, id: 'balance' }],
  }), {
    ownerType: 'USER',
    page: 2,
    pageSize: 50,
    search: 'member-001',
    sortBy: 'balance',
    sortOrder: 'asc',
  })

  assert.deepEqual(buildFundAccountListQuery({
    filters: { ownerType: 'INVALID' },
    page: 0,
    pageSize: 10,
    search: '   ',
    sorting: [{ desc: true, id: 'subject' }],
  }), { page: 1, pageSize: 20 })
})

test('账户分页 adapter 保留两位金额与版本但切断容器引用', () => {
  const page: FundAccountPageDto = {
    items: [accountFixture('account-user', 'USER', 'user-1')],
    page: 1,
    pageSize: 20,
    total: 1,
  }
  const adapted = adaptFundAccountPage(page)

  assert.deepEqual(adapted, page)
  assert.notEqual(adapted, page)
  assert.notEqual(adapted.items, page.items)
  assert.notEqual(adapted.items[0], page.items[0])
  assert.notEqual(adapted.items[0]?.user, page.items[0]?.user)
  assert.equal(adapted.items[0]?.balance, '-20.12')
  assert.equal(adapted.items[0]?.version, 3)
})

test('开户候选只排除已有用户账户并保留用户状态供管理员核对', () => {
  const users = [
    userFixture('user-1'),
    userFixture('user-2', 'DISABLED'),
    userFixture('user-3'),
  ]
  const accounts = [
    accountFixture('account-company', 'COMPANY'),
    accountFixture('account-user-2', 'USER', 'user-2'),
  ]

  assert.deepEqual(
    findUnopenedFundAccountUsers(users, accounts).map(user => ({
      id: user.id,
      status: user.status,
    })),
    [
      { id: 'user-1', status: 'ACTIVE' },
      { id: 'user-3', status: 'ACTIVE' },
    ],
  )
  assert.equal(findCompanyFundAccount(accounts)?.id, 'account-company')
})

test('资金展示固定两位精度并区分正数、负数和零值状态', () => {
  const catalog: CurrencyDescriptor[] = [{
    code: 'CNY',
    enabled: true,
    minorUnit: 2,
    name: '人民币',
    symbol: '¥',
  }]
  const fundCatalog = withFundAccountPrecision(catalog)

  assert.equal(fundCatalog[0]?.minorUnit, 2)
  assert.equal(catalog[0]?.minorUnit, 2)
  assert.deepEqual(getFundBalanceState('-0.01'), {
    label: '负余额',
    tone: 'negative',
  })
  assert.deepEqual(getFundBalanceState('12.34'), {
    label: '余额正常',
    tone: 'positive',
  })
  assert.deepEqual(getFundBalanceState('0.00'), {
    label: '余额正常',
    tone: 'neutral',
  })
  assert.deepEqual(getFundBalanceState('-0.00'), {
    label: '余额正常',
    tone: 'neutral',
  })
  assert.equal(formatFundShareRate('30.00'), '30.00%')
  assert.equal(formatFundShareRate(null), '—')
})
