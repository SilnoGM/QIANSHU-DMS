import type { RouteRecordMainRaw } from '@fantastic-admin/types'

// 工作台按独立业务权限展示，不依赖角色名称。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'i-lucide:wallet-cards',
    auth: ['sales-receipts:read', 'purchase-orders:payment'],
  },
  children: [
    {
      path: '/qs-finance/sales-receipts',
      name: 'qsFinanceSalesReceipts',
      component: () => import('@/views/workbenches/sales-receipts/index.vue'),
      meta: {
        title: 'workbench.salesReceipts',
        icon: 'i-lucide:arrow-down-to-line',
        singleMenu: true,
        auth: 'sales-receipts:read',
      },
    },
    {
      path: '/qs-finance/purchase-payments',
      name: 'qsFinancePurchasePayments',
      component: () => import('@/views/workbenches/placeholder.vue'),
      meta: {
        title: 'workbench.purchasePayments',
        icon: 'i-lucide:arrow-up-from-line',
        singleMenu: true,
        auth: 'purchase-orders:payment',
      },
    },
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
      component: () => import('@/views/workbenches/placeholder.vue'),
      meta: {
        title: 'workbench.purchaseReviews',
        icon: 'i-lucide:clipboard-check',
        singleMenu: true,
        auth: 'purchase-orders:review',
      },
    },
  ],
}
