import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 销售订单与采购订单各自进入独立业务分组，让待办页和全部页拥有稳定的菜单层级。
 * 两个新增页均作为隐藏叶子，并通过 activeMenu 保持所属“全部订单”菜单高亮。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/qs-operations/sales',
    name: 'qsOperationsSales',
    component: Layout,
    redirect: { name: 'qsOperationsPendingSalesOrders' },
    meta: {
      title: '销售订单',
      icon: 'qs-sales-orders',
    },
    children: [
      {
        path: 'pending-sales-orders',
        name: 'qsOperationsPendingSalesOrders',
        component: () => import('@/views/operations/sales-orders/index.vue'),
        props: { viewMode: 'pending' },
        meta: {
          title: '待办订单',
          icon: 'qs-pending',
        },
      },
      {
        path: 'sales-orders',
        name: 'qsOperationsSalesOrders',
        component: () => import('@/views/operations/sales-orders/index.vue'),
        props: { viewMode: 'all' },
        meta: {
          title: '全部订单',
          icon: 'qs-all-orders',
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
    path: '/qs-operations/purchase',
    name: 'qsOperationsPurchase',
    component: Layout,
    redirect: { name: 'qsOperationsPendingPurchaseOrders' },
    meta: {
      title: '采购订单',
      icon: 'qs-purchase-orders',
    },
    children: [
      {
        path: 'pending-purchase-orders',
        name: 'qsOperationsPendingPurchaseOrders',
        component: () => import('@/views/operations/purchase-orders/pending.vue'),
        meta: {
          title: '待办采购',
          icon: 'qs-pending',
          auth: 'purchase-orders:read',
        },
      },
      {
        path: 'purchase-orders',
        name: 'qsOperationsPurchaseOrders',
        component: () => import('@/views/operations/purchase-orders/index.vue'),
        meta: {
          title: '全部采购',
          icon: 'qs-all-orders',
          auth: 'purchase-orders:read',
        },
      },
      {
        path: 'purchase-orders/create',
        name: 'operationsPurchaseOrderCreate',
        component: () => import('@/views/operations/purchase-orders/create.vue'),
        meta: {
          title: '新增采购订单',
          auth: 'purchase-orders:create',
          activeMenu: '/qs-operations/purchase/purchase-orders',
          menu: false,
        },
      },
    ],
  },
  {
    path: '/qs-operations/warehouse-transport',
    name: 'qsOperationsWarehouseTransport',
    component: Layout,
    redirect: { name: 'qsOperationsWarehouseArrivals' },
    meta: {
      title: '仓储运输',
      icon: 'qs-factory-shipment',
    },
    children: [
      {
        path: 'warehouse-arrivals',
        name: 'qsOperationsWarehouseArrivals',
        component: () => import('@/views/workbenches/placeholder.vue'),
        meta: { title: '到仓货件', icon: 'qs-product-list' },
      },
      {
        path: 'ocean-containers',
        name: 'qsOperationsOceanContainers',
        component: () => import('@/views/workbenches/placeholder.vue'),
        meta: { title: '海运柜次', icon: 'qs-factory-shipment' },
      },
      {
        path: 'overseas-storage',
        name: 'qsOperationsOverseasStorage',
        component: () => import('@/views/workbenches/placeholder.vue'),
        meta: { title: '海外寄仓', icon: 'qs-regions' },
      },
    ],
  },
]

export default routes
