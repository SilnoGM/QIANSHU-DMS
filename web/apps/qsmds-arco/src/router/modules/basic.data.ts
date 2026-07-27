import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 基础数据当前只建立稳定的导航层级与页面入口，不预设权限和业务实现。
 * 父路径重定向到首个叶子路由，确保直接访问或刷新时始终拥有明确落点。
 */
const routes: RouteRecordRaw = {
  path: '/system/basic-data',
  name: 'systemBasicData',
  component: Layout,
  redirect: {
    name: 'systemBasicDataRegions',
  },
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
