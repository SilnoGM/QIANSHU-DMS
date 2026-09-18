import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 资金账户首期只有两个读取入口，共用一个 systemOnly 权限。父分组与叶子路由都
 * 声明权限，分别约束菜单过滤和直接 URL 访问，不能借用产品管理权限。
 */
export const FUND_ACCOUNT_MANAGEMENT_PERMISSIONS = [
  'fund-accounts:read',
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
  ],
}

export default routes
