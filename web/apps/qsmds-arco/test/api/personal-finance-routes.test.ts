import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 运营个人财务与财务提款审批入口契约使用 Node.js 内置 runner。
import test from 'node:test'
import { createRouterMatcher } from 'vue-router'

import { matchesAuthorization } from '../../src/composables/app/auth'
import fundAccountManagementRoutes from '../../src/router/modules/fund-account.management'
import operationsWorkbenchRoutes from '../../src/router/modules/operations.workbench'
import { financeWorkbench } from '../../src/router/modules/role.workbenches'
import {
  FINANCE_WORKBENCH_PERMISSION,
  OPERATIONS_WORKBENCH_PERMISSION,
} from '../../src/router/modules/workbench-access'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'
import { buildRegisteredRoutes } from '../../src/store/modules/app/route.logic'

/** 与 seed 数据集一致的内置角色权限集合（只保留断言用到的部分）。 */
const operationsStaff = [
  'fund-accounts:read-self',
  'fund-withdrawals:create',
  OPERATIONS_WORKBENCH_PERMISSION,
]
const financeStaff = [
  'fund-accounts:read',
  'fund-withdrawals:review',
  FINANCE_WORKBENCH_PERMISSION,
]

const personalFinanceGroup = operationsWorkbenchRoutes.find(
  route => route.name === 'qsOperationsPersonalFinance',
)

const registeredMatcher = createRouterMatcher(
  buildRegisteredRoutes([
    {
      meta: { title: '千树运营工作台', auth: [OPERATIONS_WORKBENCH_PERMISSION] },
      children: [...operationsWorkbenchRoutes],
    },
    financeWorkbench,
  ] as Parameters<typeof buildRegisteredRoutes>[0]),
  {},
)

function canEnter(permissions: string[], path: string) {
  const matched = registeredMatcher.resolve({ path }, undefined!)?.matched ?? []
  assert.ok(matched.length > 0, `路由未注册：${path}`)
  return matched.every(record => matchesAuthorization(permissions, record.meta?.auth ?? ''))
}

function visibleLeafPaths(group: unknown, permissions: string[]) {
  return filterAccessibleMenus(
    [group] as Parameters<typeof filterAccessibleMenus>[0],
    value => matchesAuthorization(permissions, value),
    () => true,
  )[0]?.children?.map(leaf => leaf.path) ?? []
}

test('运营工作台新增个人财务分组，两个叶子各用独立权限', () => {
  assert.equal(personalFinanceGroup?.path, '/qs-operations/personal-finance')
  assert.equal(personalFinanceGroup?.meta?.title, '个人财务')
  assert.equal(personalFinanceGroup?.meta?.icon, 'qs-personal-finance')
  // 分组的任何一条 auth 都只用于菜单过滤：组内叶子业务码的并集。
  assert.deepEqual(personalFinanceGroup?.meta?.auth, [
    'fund-accounts:read-self',
    'fund-withdrawals:create',
  ])
  assert.equal(typeof personalFinanceGroup?.component, 'function')
  // 两个叶子各自独立授权，分组不声明 redirect：显式重定向会把只持有其中一个码的
  // 角色送到无权限页面，交给 Route Store 的既有回退（进入第一个有权限的子路由）。
  assert.equal(personalFinanceGroup?.redirect, undefined)
  assert.deepEqual(
    personalFinanceGroup?.children?.map(route => ({
      auth: route.meta?.auth,
      icon: route.meta?.icon,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        auth: 'fund-accounts:read-self',
        icon: 'qs-fund-account-list',
        name: 'qsOperationsPersonalFinanceFundAccounts',
        path: 'fund-accounts',
        title: '资金账户',
      },
      {
        auth: 'fund-withdrawals:create',
        icon: 'qs-fund-withdrawal',
        name: 'qsOperationsPersonalFinanceWithdrawals',
        path: 'withdrawals',
        title: '提款申请',
      },
    ],
  )
  const [fundAccounts, withdrawals] = personalFinanceGroup?.children ?? []
  assert.match(String(fundAccounts?.component), /operations\/personal-finance\/fund-accounts\/index\.vue/u)
  assert.match(String(withdrawals?.component), /operations\/personal-finance\/withdrawals\/index\.vue/u)
  assert.ok(
    operationsWorkbenchRoutes.at(-1) === personalFinanceGroup,
    '个人财务分组排在运营工作台现有分组之后',
  )
})

test('资金账户流水（本人）不借用财务侧全量账户读取权限', () => {
  // 本人账户读取必须独立授权：运营即便持有 workbench:operations，也不能凭
  // fund-accounts:read 之外的关系进入财务账户管理组。
  assert.equal(canEnter([OPERATIONS_WORKBENCH_PERMISSION, 'fund-accounts:read-self'], '/qs-finance/fund-accounts/list'), false)
  assert.equal(canEnter([FINANCE_WORKBENCH_PERMISSION, 'fund-accounts:read'], '/qs-operations/personal-finance/fund-accounts'), false)
})

test('财务账户管理新增账户提款审批叶子，分组菜单过滤并集同步扩展', () => {
  assert.deepEqual(fundAccountManagementRoutes.meta?.auth, [
    'fund-accounts:read',
    'fund-withdrawals:review',
  ])
  const approval = fundAccountManagementRoutes.children?.find(
    route => route.name === 'qsFinanceFundWithdrawalApprovals',
  )
  assert.equal(approval?.path, 'withdrawal-approvals')
  assert.equal(approval?.meta?.title, '账户提款审批')
  assert.equal(approval?.meta?.icon, 'qs-fund-withdrawal')
  assert.equal(approval?.meta?.auth, 'fund-withdrawals:review')
  assert.match(String(approval?.component), /admin\/fund-account-management\/withdrawal-approvals\/index\.vue/u)
  // 叶子顺序：两个既有账户页之后追加，既有页面契约不变。
  assert.deepEqual(
    fundAccountManagementRoutes.children?.map(route => route.name),
    [
      'qsFinanceFundAccountList',
      'qsFinanceFundAccountTransactions',
      'qsFinanceFundWithdrawalApprovals',
    ],
  )
  assert.ok(financeWorkbench.children.includes(fundAccountManagementRoutes))
})

test('菜单按角色权限集合可见：个人财务与账户提款审批各归各的工作台', () => {
  // 运营：个人财务两个叶子都可见。
  assert.deepEqual(
    visibleLeafPaths(personalFinanceGroup, operationsStaff),
    ['fund-accounts', 'withdrawals'],
  )
  // 只有工作台准入码、没有业务码时不显示分组。
  assert.deepEqual(visibleLeafPaths(personalFinanceGroup, [OPERATIONS_WORKBENCH_PERMISSION]), [])
  // 只持有其中一个业务码时，分组保留但只显示对应叶子。
  assert.deepEqual(visibleLeafPaths(personalFinanceGroup, ['fund-accounts:read-self']), ['fund-accounts'])
  assert.deepEqual(visibleLeafPaths(personalFinanceGroup, ['fund-withdrawals:create']), ['withdrawals'])

  // 财务：账户管理组保留两个既有页面与新的提款审批页。
  assert.deepEqual(
    visibleLeafPaths(fundAccountManagementRoutes, financeStaff),
    ['list', 'transactions', 'withdrawal-approvals'],
  )
  // 只授予提款审批码时，分组仍可见（并集包含该码），且只显示审批页。
  assert.deepEqual(
    visibleLeafPaths(fundAccountManagementRoutes, ['fund-withdrawals:review']),
    ['withdrawal-approvals'],
  )
  assert.deepEqual(visibleLeafPaths(fundAccountManagementRoutes, ['fund-accounts:read']), ['list', 'transactions'])
  assert.deepEqual(visibleLeafPaths(fundAccountManagementRoutes, []), [])
})

test('直接 URL 准入与菜单一致：跨工作台被拦截，本工作台可进入', () => {
  for (const path of [
    '/qs-operations/personal-finance/fund-accounts',
    '/qs-operations/personal-finance/withdrawals',
  ]) {
    assert.equal(canEnter(operationsStaff, path), true, `运营角色应能进入 ${path}`)
    assert.equal(canEnter(financeStaff, path), false, `财务角色不应进入 ${path}`)
    assert.equal(canEnter([], path), false, `无准入码不得进入 ${path}`)
    assert.equal(
      canEnter([OPERATIONS_WORKBENCH_PERMISSION], path),
      false,
      `缺少业务码不得进入 ${path}`,
    )
  }
  assert.equal(
    canEnter(financeStaff, '/qs-finance/fund-accounts/withdrawal-approvals'),
    true,
    '财务角色应能进入账户提款审批',
  )
  for (const permissions of [
    operationsStaff,
    [FINANCE_WORKBENCH_PERMISSION],
    ['fund-withdrawals:review'],
    [],
  ]) {
    assert.equal(
      canEnter(permissions, '/qs-finance/fund-accounts/withdrawal-approvals'),
      false,
      `非财务角色不得进入账户提款审批：${permissions.join(',') || '无权限'}`,
    )
  }
})

test('个人资金账户页面接入页头、账户卡片、流水表与本人接口', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/personal-finance/fund-accounts/index.vue', import.meta.url),
    'utf8',
  )
  assert.match(source, /defineOptions\(\{ name: 'OperationsPersonalFinanceFundAccounts' \}\)/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<FaPageMain/u)
  assert.match(source, /<QsPersonalFundAccountCard/u)
  assert.match(source, /fundAccountsApi\.accounts\.self\(/u)
  assert.match(source, /fundAccountsApi\.transactions\.listSelf\(/u)
  assert.match(source, /:account="account"/u)
  assert.match(source, /:loading="accountLoading"/u)
  assert.match(source, /@retry="loadAccount"/u)
  assert.match(source, /personalFinanceLedger\.column\.sequence/u)
  assert.match(source, /personalFinanceLedger\.column\.amount/u)
})

test('提款入口页面保持空白占位约定：单根节点、无文案、无数据依赖', () => {
  for (const [relativePath, componentName] of [
    ['../../src/views/operations/personal-finance/withdrawals/index.vue', 'OperationsPersonalFinanceWithdrawals'],
    ['../../src/views/admin/fund-account-management/withdrawal-approvals/index.vue', 'FinanceFundWithdrawalApprovals'],
  ] as const) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, new RegExp(`defineOptions\\(\\{ name: '${componentName}' \\}\\)`, 'u'))
    assert.match(source, /<template>\s*<div \/>\s*<\/template>/u)
    assert.doesNotMatch(source, /FaPageMain|FaPageHeader|useRoute|useI18n|Api/u)
  }
})
