import type { RouteRecordRaw } from 'vue-router'

/**
 * 开发图谱（Git 提交线路图）与版本更新共用同一份构建期数据，
 * 页面只读静态数据，不设单独权限码。
 */
const route: RouteRecordRaw = {
  path: '/system/development-map',
  name: 'systemDevelopmentMap',
  component: () => import('@/views/system/development-map/index.vue'),
  meta: {
    title: '开发图谱',
    icon: 'qs-development-map',
    singleMenu: true,
  },
}

export default route
