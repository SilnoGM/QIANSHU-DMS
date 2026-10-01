import type { RouteRecordRaw } from 'vue-router'

/**
 * 系统状态只汇总前端可直取的信息、当前身份与公开健康接口，
 * 不引入新的后端接口与权限码。
 */
const route: RouteRecordRaw = {
  path: '/system/status',
  name: 'systemStatus',
  component: () => import('@/views/system/status/index.vue'),
  meta: {
    title: '系统状态',
    icon: 'qs-system-status',
    singleMenu: true,
  },
}

export default route
