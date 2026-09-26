import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import FundAccountManagement, { FUND_ACCOUNT_MANAGEMENT_PERMISSIONS } from './fund-account.management'

/**
 * 顺联航账单首期只有两个空白入口，权限随迁移授予内置 system_admin。
 * 父分组与叶子分别声明权限：前者约束菜单过滤，后者约束直接 URL 访问。
 */
export const SLH_BILL_PERMISSION_CODES = [
  'slh-bills:read',
  'slh-bills:reconcile',
] as const

// 工作台按独立业务权限展示，不依赖角色名称。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'qs-workbench-finance',
    auth: ['sales-receipts:read', 'purchase-orders:payment', 'packaging-costs:read', ...SLH_BILL_PERMISSION_CODES, ...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS],
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
    {
      path: '/qs-finance/bill-reconciliation',
      name: 'qsFinanceBillReconciliation',
      component: () => import('@/layouts/index.vue'),
      meta: {
        title: 'workbench.billReconciliation',
        icon: 'qs-bill-reconciliation',
        auth: [...SLH_BILL_PERMISSION_CODES],
      },
      children: [
        {
          path: 'slh-bill-management',
          name: 'qsFinanceBillReconciliationSlhBillManagement',
          component: () => import('@/views/workbenches/slh-bills/index.vue'),
          meta: {
            title: 'workbench.slhBillManagement',
            icon: 'qs-bill-management',
            auth: 'slh-bills:read',
          },
        },
        {
          // 有 children 的路由会被 Route Store 的 deleteMiddleRouteComponent 删掉自身 component，
          // 因此列表页保持为叶子，导入与详情作为同组隐藏兄弟路由，URL 层级不变。
          path: 'slh-bill-management/import',
          name: 'qsFinanceBillReconciliationSlhBillImport',
          component: () => import('@/views/workbenches/slh-bills/import.vue'),
          meta: {
            title: 'slhBill.importTitle',
            auth: 'slh-bills:create',
            menu: false,
            activeMenu: '/qs-finance/bill-reconciliation/slh-bill-management',
          },
        },
        {
          path: 'slh-bill-management/:id',
          name: 'qsFinanceBillReconciliationSlhBillDetail',
          component: () => import('@/views/workbenches/slh-bills/detail.vue'),
          meta: {
            title: 'slhBill.detailTitle',
            auth: 'slh-bills:read',
            menu: false,
            breadcrumb: false,
            activeMenu: '/qs-finance/bill-reconciliation/slh-bill-management',
          },
        },
        {
          path: 'slh-bill-reconciliation',
          name: 'qsFinanceBillReconciliationSlhBillReconciliation',
          component: () => import('@/views/workbenches/placeholder.vue'),
          meta: {
            title: 'workbench.slhBillReconciliation',
            icon: 'qs-bill-reconciliation-check',
            auth: 'slh-bills:reconcile',
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
    auth: ['purchase-orders:review', 'purchase-orders:read', 'container-batches:read'],
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
        auth: 'container-batches:read',
      },
    },
    {
      path: '/qs-purchase-transport/containers/:id',
      name: 'qsPurchaseTransportContainerDetail',
      component: () => import('@/views/workbenches/containers/detail.vue'),
      meta: {
        title: 'workbench.containerDetail',
        icon: 'qs-container-management',
        singleMenu: true,
        menu: false,
        activeMenu: '/qs-purchase-transport/containers',
        auth: 'container-batches:read',
      },
    },
    {
      path: '/qs-purchase-transport/containers/:id/import',
      name: 'qsPurchaseTransportContainerImport',
      component: () => import('@/views/workbenches/containers/import/index.vue'),
      meta: {
        title: 'workbench.containerImport',
        icon: 'qs-container-management',
        singleMenu: true,
        menu: false,
        activeMenu: '/qs-purchase-transport/containers',
        auth: 'container-batches:update',
      },
    },
  ],
}
