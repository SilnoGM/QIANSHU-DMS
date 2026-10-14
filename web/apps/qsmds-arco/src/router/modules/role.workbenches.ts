import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import FundAccountManagement from './fund-account.management'
import {
  FINANCE_WORKBENCH_PERMISSION,
  PURCHASE_TRANSPORT_WORKBENCH_PERMISSION,
} from './workbench-access'

/**
 * 顺联航账单首期只有两个空白入口，权限随迁移授予内置 system_admin。
 * 父分组与叶子分别声明权限：前者约束菜单过滤，后者约束直接 URL 访问。
 */
export const SLH_BILL_PERMISSION_CODES = [
  'slh-bills:read',
  'slh-bills:reconcile',
] as const

// 工作台可见与准入由独立准入码决定（见 workbench-access.ts），不依赖角色名称，
// 也不再由组内业务码并集决定；组内页面继续按各自业务码收敛。
export const financeWorkbench: RouteRecordMainRaw = {
  meta: {
    title: 'workbench.finance',
    icon: 'qs-workbench-finance',
    auth: [FINANCE_WORKBENCH_PERMISSION],
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
          // 与导入页、柜次详情一致：隐藏菜单但保留面包屑末级（不设 breadcrumb: false），
          // 让用户能看到自己在本页；注意详情是列表的兄弟路由，面包屑里不会出现列表那一级。
          meta: {
            title: 'slhBill.detailTitle',
            auth: 'slh-bills:read',
            menu: false,
            activeMenu: '/qs-finance/bill-reconciliation/slh-bill-management',
          },
        },
        {
          path: 'slh-bill-reconciliation',
          name: 'qsFinanceBillReconciliationSlhBillReconciliation',
          component: () => import('@/views/workbenches/slh-reconciliation/index.vue'),
          meta: {
            title: 'workbench.slhBillReconciliation',
            icon: 'qs-bill-reconciliation-check',
            auth: 'slh-bills:reconcile',
          },
        },
        {
          path: 'slh-bill-reconciliation/:id',
          name: 'qsFinanceBillReconciliationSlhReconciliationDetail',
          component: () => import('@/views/workbenches/slh-reconciliation/detail.vue'),
          // 与账单详情同款：隐藏菜单但保留面包屑末级（不设 breadcrumb: false），
          // 让用户能看到自己在本页；详情是列表的兄弟路由，面包屑里不会出现列表那一级。
          meta: {
            title: 'workbench.slhBillReconciliationDetail',
            auth: 'slh-bills:reconcile',
            menu: false,
            activeMenu: '/qs-finance/bill-reconciliation/slh-bill-reconciliation',
          },
        },
      ],
    },
    {
      path: '/qs-finance/invoices',
      name: 'qsFinanceInvoices',
      component: () => import('@/layouts/index.vue'),
      meta: {
        title: 'workbench.invoiceManagement',
        icon: 'qs-invoices',
        // 只用于菜单过滤：组内叶子业务码的并集；直接 URL 准入仍由工作台准入码覆盖。
        auth: ['invoice-requests:read', 'invoice-requests:review'],
      },
      children: [
        {
          path: 'approval',
          name: 'qsFinanceInvoicesApproval',
          component: () => import('@/views/workbenches/invoices/approval/index.vue'),
          meta: {
            title: 'workbench.invoiceApproval',
            icon: 'qs-invoice-approval',
            auth: 'invoice-requests:review',
          },
        },
        {
          path: 'approval/:id',
          name: 'qsFinanceInvoicesDetail',
          component: () => import('@/views/workbenches/invoices/approval/detail.vue'),
          // 与账单详情同款：隐藏菜单但保留面包屑末级（不设 breadcrumb: false）。
          meta: {
            title: 'invoiceRequest.detailTitle',
            auth: 'invoice-requests:review',
            menu: false,
            activeMenu: '/qs-finance/invoices/approval',
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
    auth: [PURCHASE_TRANSPORT_WORKBENCH_PERMISSION],
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
