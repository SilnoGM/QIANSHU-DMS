import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import FundAccountManagement, { FUND_ACCOUNT_MANAGEMENT_PERMISSIONS } from './fund-account.management'

// 工作台按独立业务权限展示，不依赖角色名称。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'qs-workbench-finance',
    auth: ['sales-receipts:read', 'purchase-orders:payment', ...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS],
  },
  children: [
    {
      path: '/qs-finance/realtime-payments',
      name: 'qsFinanceRealtimePayments',
      component: () => import('@/layouts/index.vue'),
      meta: {
        title: 'workbench.realtimePayments',
        icon: 'qs-realtime-payments',
        auth: ['sales-receipts:read', 'purchase-orders:payment'],
      },
      children: [
        {
          path: 'sales-receipts',
          name: 'qsFinanceRealtimeSalesReceipts',
          component: () => import('@/views/workbenches/sales-receipts/index.vue'),
          meta: {
            title: 'workbench.salesReceipts',
            icon: 'qs-sales-receipts',
            auth: 'sales-receipts:read',
          },
        },
        {
          path: 'purchase-payments',
          name: 'qsFinanceRealtimePurchasePayments',
          component: () => import('@/views/workbenches/placeholder.vue'),
          meta: {
            title: 'workbench.purchasePayments',
            icon: 'qs-purchase-payments',
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
    icon: 'qs-workbench-purchase',
    auth: ['purchase-orders:review', 'purchase-orders:read'],
  },
  children: [
    {
      path: '/qs-purchase/reviews',
      name: 'qsPurchaseReviews',
      component: () => import('@/views/workbenches/purchase-reviews/index.vue'),
      meta: {
        title: 'workbench.purchaseReviews',
        icon: 'qs-purchase-review',
        singleMenu: true,
        auth: 'purchase-orders:review',
      },
    },
    {
      path: '/qs-purchase/shipments',
      name: 'qsPurchaseShipments',
      component: () => import('@/views/workbenches/shipments/index.vue'),
      meta: {
        title: 'workbench.shipments',
        icon: 'qs-factory-shipment',
        singleMenu: true,
        auth: 'purchase-orders:read',
      },
    },
  ],
}
