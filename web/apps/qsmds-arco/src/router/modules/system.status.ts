import type { RouteRecordRaw } from 'vue-router'

/**
 * 系统状态是系统管理下的单页菜单。
 *
 * 分组已用 `audit:read` 收敛；叶子再声明 `system-status:read`，让菜单过滤与页面
 * 内容级判断都落在同一个系统专用权限上。服务端 PermissionGuard 仍是最终判定。
 */
const route: RouteRecordRaw = {
  path: '/system/status',
  name: 'systemStatus',
  component: () => import('@/views/system/status/index.vue'),
  meta: {
    title: '系统状态',
    icon: 'qs-status-switch',
    auth: 'system-status:read',
    singleMenu: true,
  },
}

export default route
