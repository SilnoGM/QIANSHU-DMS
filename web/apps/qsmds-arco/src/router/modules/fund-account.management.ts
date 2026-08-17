import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 资金账户首期只建立管理员工作台的信息架构和空白页面，不提前虚构尚未落库的
 * 业务权限。后续接入真实功能时，必须同步补齐 Server RBAC 与叶子路由 `meta.auth`。
 */
const routes: RouteRecordRaw = {
  path: '/admin/fund-accounts',
  name: 'adminFundAccountManagement',
  component: Layout,
  meta: {
    title: '账户管理',
    icon: 'i-lucide:wallet-cards',
  },
  children: [
    {
      path: 'list',
      name: 'adminFundAccountList',
      component: () => import('@/views/admin/fund-account-management/list/index.vue'),
      meta: {
        title: '资金账户列表',
        icon: 'i-lucide:landmark',
      },
    },
    {
      path: 'transactions',
      name: 'adminFundAccountTransactions',
      component: () => import('@/views/admin/fund-account-management/transactions/index.vue'),
      meta: {
        title: '资金账户流水',
        icon: 'i-lucide:scroll-text',
      },
    },
  ],
}

export default routes
