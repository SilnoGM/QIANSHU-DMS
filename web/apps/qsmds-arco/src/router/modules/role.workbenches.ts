import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import FundAccountManagement, { FUND_ACCOUNT_MANAGEMENT_PERMISSIONS } from './fund-account.management'

// 工作台按独立业务权限展示，不依赖角色名称。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'qs-workbench-finance',
    auth: ['sales-receipts:read', 'purchase-orders:payment', 'packaging-costs:read', ...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS],
  },
  children: [
    {
      path: '/qs-finance/realtime-payments',
      name: 'qsFinanceRealtimePayments',
      component: () => import('@/layouts/index.vue'),
      meta: {
        title: 'workbench.realtimePayments',
        icon: 'qs-realtime-payments',
        auth: ['sales-receipts:read', 'purchase-orders:payment', 'packaging-costs:read'],
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
          component: () => import('@/views/workbenches/purchase-payments/index.vue'),
          meta: {
            title: 'workbench.purchasePayments',
            icon: 'qs-purchase-payments',
            auth: 'purchase-orders:payment',
          },
        },
        {
          path: 'purchase-payments/batch',
          name: 'qsFinanceRealtimePurchaseBatchPayment',
          component: () => import('@/views/workbenches/purchase-payments/batch-payment-page.vue'),
          meta: {
            title: 'purchasePayment.batch.pageTitle',
            icon: 'qs-purchase-payments',
            menu: false,
            activeMenu: '/qs-finance/realtime-payments/purchase-payments',
            auth: 'purchase-orders:payment',
          },
        },
        {
          path: 'purchase-payments/orders/:id',
          name: 'qsFinanceRealtimePurchaseOrderPayment',
          component: () => import('@/views/workbenches/purchase-payments/payment-page.vue'),
          meta: {
            title: 'purchasePayment.payTitle',
            icon: 'qs-purchase-payments',
            menu: false,
            activeMenu: '/qs-finance/realtime-payments/purchase-payments',
            auth: 'purchase-orders:payment',
          },
        },
        {
          path: 'purchase-payments/:id',
          name: 'qsFinanceRealtimePurchasePayablePayment',
          component: () => import('@/views/workbenches/purchase-payments/payment-page.vue'),
          meta: {
            title: 'purchasePayment.payTitle',
            icon: 'qs-purchase-payments',
            menu: false,
            activeMenu: '/qs-finance/realtime-payments/purchase-payments',
            auth: 'purchase-orders:payment',
          },
        },
        {
          path: 'packaging-payments',
          name: 'qsFinanceRealtimePackagingPayments',
          component: () => import('@/views/workbenches/packaging-payments/index.vue'),
          meta: {
            title: 'workbench.packagingPayments',
            icon: 'qs-packaging-payments',
            auth: 'packaging-costs:read',
          },
        },
        {
          path: 'packaging-payments/:requestId/payment',
          name: 'qsFinanceRealtimePackagingPayment',
          component: () => import('@/views/workbenches/packaging-payments/payment-page.vue'),
          meta: {
            title: 'packagingPayment.payTitle',
            icon: 'qs-packaging-payments',
            menu: false,
            activeMenu: '/qs-finance/realtime-payments/packaging-payments',
            auth: 'packaging-costs:read',
          },
        },
      ],
    },
    FundAccountManagement,
  ],
}

export const purchaseTransportWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.purchaseTransport',
    icon: 'qs-workbench-purchase',
    auth: ['purchase-orders:review', 'purchase-orders:read'],
  },
  children: [
    {
      path: '/qs-purchase-transport/reviews',
      name: 'qsPurchaseTransportReviews',
      component: () => import('@/views/workbenches/purchase-reviews/index.vue'),
      meta: {
        title: 'workbench.purchaseReviews',
        icon: 'qs-purchase-review',
        singleMenu: true,
        auth: 'purchase-orders:review',
      },
    },
    {
      path: '/qs-purchase-transport/shipments',
      name: 'qsPurchaseTransportShipments',
      component: () => import('@/views/workbenches/shipments/index.vue'),
      meta: {
        title: 'workbench.shipments',
        icon: 'qs-factory-shipment',
        singleMenu: true,
        auth: 'purchase-orders:read',
      },
    },
    {
      path: '/qs-purchase-transport/containers',
      name: 'qsPurchaseTransportContainers',
      component: () => import('@/views/workbenches/containers/index.vue'),
      meta: {
        title: 'workbench.containers',
        icon: 'qs-container-management',
        singleMenu: true,
        auth: 'purchase-orders:read',
      },
    },
  ],
}
