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
          keepAlive: true,
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
          keepAlive: true,
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
          keepAlive: true,
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
          keepAlive: true,
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
      icon: 'qs-warehouse-transport',
    },
    children: [
      {
        path: 'warehouse-arrivals',
        name: 'qsOperationsWarehouseArrivals',
        component: () => import('@/views/operations/warehouse-arrivals/index.vue'),
        meta: { title: '到仓货件', icon: 'qs-warehouse-arrivals', auth: 'purchase-orders:read', keepAlive: true },
      },
      {
        path: 'ocean-containers',
        name: 'qsOperationsOceanContainers',
        component: () => import('@/views/operations/ocean-containers/index.vue'),
        meta: { title: '海运柜次', icon: 'qs-ocean-containers', auth: 'sales-orders:read' },
      },
      {
        // 隐藏页只从海运柜次的「查看全部柜次」进入；activeMenu 保持侧边栏高亮，不新增菜单项。
        path: 'ocean-containers/all',
        name: 'qsOperationsOceanContainersAll',
        component: () => import('@/views/operations/ocean-containers/all.vue'),
        meta: {
          title: '全部海运柜次',
          auth: 'sales-orders:read',
          activeMenu: '/qs-operations/warehouse-transport/ocean-containers',
          menu: false,
        },
      },
      {
        path: 'overseas-storage',
        name: 'qsOperationsOverseasStorage',
        component: () => import('@/views/workbenches/placeholder.vue'),
        meta: { title: '海外寄仓', icon: 'qs-overseas-storage' },
      },
    ],
  },
  {
    path: '/qs-operations/invoices',
    name: 'qsOperationsInvoices',
    component: Layout,
    redirect: { name: 'qsOperationsInvoicesRecords' },
    meta: {
      title: '发票管理',
      icon: 'qs-invoices',
    },
    children: [
      {
        path: 'create',
        name: 'qsOperationsInvoicesCreate',
        component: () => import('@/views/workbenches/invoices/records/create.vue'),
        // 新建与「重填」共用本页：重填通过 query 带单据 id 回填，不再单开路由。
        meta: { title: '开票申请', icon: 'qs-invoice-request', auth: 'invoice-requests:create' },
      },
      {
        path: 'records',
        name: 'qsOperationsInvoicesRecords',
        component: () => import('@/views/workbenches/invoices/records/index.vue'),
        meta: { title: '开票记录', icon: 'qs-invoice-records', auth: 'invoice-requests:read' },
      },
    ],
  },
  {
    // 运营只看本人财务数据，因此本人账户读取用独立权限 `fund-accounts:read-self`，
    // 不借用财务侧的全量账户视图权限 `fund-accounts:read`；提款按提交与审批拆分，
    // 本组只声明提交。分组 auth 只用于菜单过滤，取组内叶子业务码的并集。
    // 刻意不声明 redirect：两个叶子各自独立授权，显式重定向会把只持有其中一个码的
    // 角色送到无权限页面；交给 Route Store 的既有回退（进入第一个有权限的子路由）。
    path: '/qs-operations/personal-finance',
    name: 'qsOperationsPersonalFinance',
    component: Layout,
    meta: {
      title: '个人财务',
      icon: 'qs-personal-finance',
      auth: ['fund-accounts:read-self', 'fund-withdrawals:create'],
    },
    children: [
      {
        path: 'fund-accounts',
        name: 'qsOperationsPersonalFinanceFundAccounts',
        component: () => import('@/views/operations/personal-finance/fund-accounts/index.vue'),
        meta: { title: '资金账户', icon: 'qs-fund-account-list', auth: 'fund-accounts:read-self', keepAlive: true },
      },
      {
        path: 'withdrawals',
        name: 'qsOperationsPersonalFinanceWithdrawals',
        component: () => import('@/views/operations/personal-finance/withdrawals/index.vue'),
        meta: { title: '提款申请', icon: 'qs-fund-withdrawal', auth: 'fund-withdrawals:create', keepAlive: true },
      },
    ],
  },
]

export default routes
