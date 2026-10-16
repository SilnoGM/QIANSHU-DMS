import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 账户管理分组：资金账户列表、资金账户流水共用全量账户读取权限，账户提款审批
 * 用独立的提款审批权限。父分组与叶子路由都声明权限，分别约束菜单过滤和直接 URL
 * 访问，不能借用产品管理权限。
 * 分组 auth 只用于菜单过滤，取组内叶子业务码的并集：只持有提款审批码的角色也必须
 * 能看到分组，否则审批入口会随分组一起被过滤掉。
 */
export const FUND_ACCOUNT_MANAGEMENT_PERMISSIONS = [
  'fund-accounts:read',
  'fund-withdrawals:review',
] as const

const routes: RouteRecordRaw = {
  path: '/qs-finance/fund-accounts',
  name: 'qsFinanceFundAccountManagement',
  component: Layout,
  meta: {
    title: '账户管理',
    icon: 'qs-fund-accounts',
    auth: [...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS],
  },
  children: [
    {
      path: 'list',
      name: 'qsFinanceFundAccountList',
      component: () => import('@/views/admin/fund-account-management/list/index.vue'),
      meta: {
        title: '资金账户列表',
        icon: 'qs-fund-account-list',
        auth: 'fund-accounts:read',
      },
    },
    {
      path: 'transactions',
      name: 'qsFinanceFundAccountTransactions',
      component: () => import('@/views/admin/fund-account-management/transactions/index.vue'),
      meta: {
        title: '资金账户流水',
        icon: 'qs-fund-transactions',
        auth: 'fund-accounts:read',
      },
    },
    {
      path: 'withdrawal-approvals',
      name: 'qsFinanceFundWithdrawalApprovals',
      component: () => import('@/views/admin/fund-account-management/withdrawal-approvals/index.vue'),
      meta: {
        title: '账户提款审批',
        icon: 'qs-fund-withdrawal',
        auth: 'fund-withdrawals:review',
      },
    },
  ],
}

export default routes
