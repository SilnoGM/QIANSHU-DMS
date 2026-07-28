import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

export const BASIC_DATA_READ_PERMISSIONS = [
  'regions:read',
] as const

/**
 * 基础数据父级使用 any-of 读取权限。父路由不固定重定向到地区管理，
 * 后续增加其他基础数据权限时可继续由全局 guard 选择首个有权访问的叶子。
 */
const routes: RouteRecordRaw = {
  path: '/system/basic-data',
  name: 'systemBasicData',
  component: Layout,
  meta: {
    title: '基础数据',
    icon: 'i-lucide:database',
    auth: [...BASIC_DATA_READ_PERMISSIONS],
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
      component: () => import('@/views/system/basic-data/currencies/index.vue'),
      meta: {
        title: '货币管理',
        icon: 'i-lucide:coins',
      },
    },
    {
      path: 'exchange-rates',
      name: 'systemBasicDataExchangeRates',
      component: () => import('@/views/system/basic-data/exchange-rates/index.vue'),
      meta: {
        title: '汇率管理',
        icon: 'i-lucide:arrow-left-right',
      },
    },
    {
      path: 'numbering',
      name: 'systemBasicDataNumbering',
      component: () => import('@/views/system/basic-data/numbering/index.vue'),
      meta: {
        title: '编号管理',
        icon: 'i-lucide:list-ordered',
      },
    },
    {
      path: 'dictionaries',
      name: 'systemBasicDataDictionaries',
      component: () => import('@/views/system/basic-data/dictionaries/index.vue'),
      meta: {
        title: '字典管理',
        icon: 'i-lucide:book-open',
      },
    },
  ],
}

export default routes
