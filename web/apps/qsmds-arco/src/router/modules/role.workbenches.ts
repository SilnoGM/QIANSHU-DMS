import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import FundAccountManagement, { FUND_ACCOUNT_MANAGEMENT_PERMISSIONS } from './fund-account.management'

// 工作台按独立业务权限展示，不依赖角色名称。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'i-lucide:wallet-cards',
    auth: ['sales-receipts:read', 'purchase-orders:payment', ...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS],
  },
  children: [
    {
      path: '/qs-finance/realtime-payments',
      name: 'qsFinanceRealtimePayments',
      component: () => import('@/layouts/index.vue'),
      meta: {
        title: 'workbench.realtimePayments',
        icon: 'i-lucide:arrow-left-right',
        auth: ['sales-receipts:read', 'purchase-orders:payment'],
      },
      children: [
        {
          path: 'sales-receipts',
          name: 'qsFinanceRealtimeSalesReceipts',
          component: () => import('@/views/workbenches/sales-receipts/index.vue'),
          meta: {
            title: 'workbench.salesReceipts',
            icon: 'i-lucide:arrow-down-to-line',
            auth: 'sales-receipts:read',
          },
        },
        {
          path: 'purchase-payments',
          name: 'qsFinanceRealtimePurchasePayments',
          component: () => import('@/views/workbenches/placeholder.vue'),
          meta: {
            title: 'workbench.purchasePayments',
            icon: 'i-lucide:arrow-up-from-line',
            auth: 'purchase-orders:payment',
          },
        },
      ],
    },
    FundAccountManagement,
  ],
}

export const purchaseWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.purchase',
    icon: 'i-lucide:clipboard-check',
    auth: 'purchase-orders:review',
  },
  children: [
    {
      path: '/qs-purchase/reviews',
      name: 'qsPurchaseReviews',
      component: () => import('@/views/workbenches/purchase-reviews/index.vue'),
      meta: {
        title: 'workbench.purchaseReviews',
        icon: 'i-lucide:clipboard-check',
        singleMenu: true,
        auth: 'purchase-orders:review',
      },
    },
  ],
}
