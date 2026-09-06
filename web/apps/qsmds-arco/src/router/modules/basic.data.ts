import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 基础数据父级保持权限中立，由各业务叶子独立声明访问权限。
 * 这样无地区权限的账号仍可看到其余基础数据入口，避免父级鉴权误删整棵菜单。
 */
const routes: RouteRecordRaw = {
  path: '/system/basic-data',
  name: 'systemBasicData',
  component: Layout,
  meta: {
    title: '基础数据',
    icon: 'i-lucide:database',
  },
  children: [
    {
      path: 'regions',
      name: 'systemBasicDataRegions',
      component: () => import('@/views/system/basic-data/regions/index.vue'),
      meta: {
        title: '地区管理',
        icon: 'i-lucide:map-pinned',
        auth: 'regions:read',
      },
    },
    {
      path: 'currencies',
      name: 'systemBasicDataCurrencies',
      component: () => import(
        '@/views/system/basic-data/currency-exchange-rate/index.vue'
      ),
      meta: {
        title: '货币汇率',
        icon: 'i-lucide:coins',
        auth: ['currencies:read', 'exchange-rates:read'],
        tabMerge: 'routeName',
      },
    },
    {
      path: 'exchange-rates',
      name: 'systemBasicDataExchangeRates',
      redirect: {
        name: 'systemBasicDataCurrencies',
        query: {
          tab: 'exchange-rates',
        },
      },
      meta: {
        title: '当前汇率',
        auth: 'exchange-rates:read',
        activeMenu: '/system/basic-data/currencies',
        menu: false,
      },
    },
    {
      path: 'numbering',
      name: 'systemBasicDataNumbering',
      component: () => import('@/views/system/basic-data/numbering/index.vue'),
      meta: {
        title: '编号管理',
        icon: 'i-lucide:list-ordered',
        auth: 'numbering-rules:read',
      },
    },
    {
      path: 'numbering/create',
      name: 'systemBasicDataNumberingCreate',
      component: () => import('@/views/system/basic-data/numbering/create.vue'),
      meta: {
        title: '新增编号规则',
        auth: 'numbering-rules:read',
        activeMenu: '/system/basic-data/numbering',
        menu: false,
        tabMerge: 'routeName',
      },
    },
    {
      path: 'numbering/shipping-mark-bindings',
      name: 'systemBasicDataShippingMarkBindings',
      component: () => import('@/views/system/basic-data/numbering/shipping-mark-bindings.vue'),
      meta: {
        title: '唛头规则绑定',
        auth: 'purchase-shipping-marks:read',
        activeMenu: '/system/basic-data/numbering',
        menu: false,
        tabMerge: 'routeName',
      },
    },
    {
      path: 'dictionaries',
      name: 'systemBasicDataDictionaries',
      component: () => import('@/views/system/basic-data/dictionaries/index.vue'),
      meta: {
        title: '字典管理',
        icon: 'i-lucide:book-open',
        auth: 'dictionaries:read',
      },
    },
  ],
}

export default routes
