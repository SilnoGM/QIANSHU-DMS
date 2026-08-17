import type { RouteRecordRaw } from 'vue-router'

/**
 * 四个页面都是顶部工作台下的一级路由。`singleMenu` 让页面复用正式布局，
 * 两个新增页再通过 `menu: false` 保持可直接访问但不进入任何导航菜单。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/operations/sales-orders',
    name: 'operationsSalesOrders',
    component: () => import('@/views/operations/sales-orders/index.vue'),
    meta: {
      title: '销售订单',
      icon: 'i-lucide:receipt-text',
      singleMenu: true,
    },
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
    path: '/operations/sales-orders/create',
    name: 'operationsSalesOrderCreate',
    component: () => import('@/views/operations/sales-orders/create.vue'),
    meta: {
      title: '新增销售订单',
      activeMenu: '/operations/sales-orders',
      menu: false,
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
