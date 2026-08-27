import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 销售订单进入独立业务分组，后续待办与全部订单共用该层级；新增页仍是隐藏叶子，
 * 并通过 `activeMenu` 保持“全部订单”导航选中。采购订单暂时维持既有一级入口。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/qs-operations/sales',
    name: 'qsOperationsSales',
    component: Layout,
    redirect: { name: 'qsOperationsPendingSalesOrders' },
    meta: {
      title: '销售订单',
      icon: 'i-lucide:receipt-text',
    },
    children: [
      {
        path: 'pending-sales-orders',
        name: 'qsOperationsPendingSalesOrders',
        component: () => import('@/views/operations/sales-orders/index.vue'),
        props: { viewMode: 'pending' },
        meta: {
          title: '待办订单',
          icon: 'i-lucide:list-checks',
        },
      },
      {
        path: 'sales-orders',
        name: 'qsOperationsSalesOrders',
        component: () => import('@/views/operations/sales-orders/index.vue'),
        props: { viewMode: 'all' },
        meta: {
          title: '全部订单',
          icon: 'i-lucide:table-properties',
        },
      },
      {
        path: 'sales-orders/create',
        name: 'operationsSalesOrderCreate',
        component: () => import('@/views/operations/sales-orders/create.vue'),
        meta: {
          title: '新增销售订单',
          activeMenu: '/qs-operations/sales/sales-orders',
          menu: false,
        },
      },
    ],
  },
  {
    path: '/operations/purchase-orders',
    name: 'operationsPurchaseOrders',
    component: () => import('@/views/operations/purchase-orders/index.vue'),
    meta: {
      title: '采购订单',
      icon: 'i-lucide:shopping-cart',
      singleMenu: true,
    },
  },
  {
    path: '/operations/purchase-orders/create',
    name: 'operationsPurchaseOrderCreate',
    component: () => import('@/views/operations/purchase-orders/create.vue'),
    meta: {
      title: '新增采购订单',
      activeMenu: '/operations/purchase-orders',
      menu: false,
      singleMenu: true,
    },
  },
]

export default routes
