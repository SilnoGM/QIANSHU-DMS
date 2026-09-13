import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

export const MANAGEMENT_READ_PERMISSIONS = [
  'users:read',
  'roles:read',
  'audit:read',
  'regions:read',
]

/**
 * 页面路由只做体验层权限收敛，服务端 PermissionGuard 仍是最终判定。
 * 父级使用 any-of 读取权限，确保至少能访问一个管理页面时才展示菜单组。
 */
const routes: RouteRecordRaw = {
  path: '/system',
  name: 'systemManagement',
  component: Layout,
  meta: {
    title: '权限体系',
    icon: 'qs-access-control',
    auth: [...MANAGEMENT_READ_PERMISSIONS],
  },
  children: [
    {
      path: 'users',
      name: 'systemUsers',
      component: () => import('@/views/system/users/index.vue'),
      meta: {
        title: '用户管理',
        icon: 'qs-users',
        auth: 'users:read',
      },
    },
    {
      path: 'roles',
      name: 'systemRoles',
      component: () => import('@/views/system/roles/index.vue'),
      meta: {
        title: '角色管理',
        icon: 'qs-roles',
        auth: 'roles:read',
      },
    },
    {
      path: 'permissions',
      name: 'systemPermissions',
      component: () => import('@/views/system/permissions/index.vue'),
      meta: {
        title: '权限目录',
        icon: 'qs-permissions',
        auth: 'roles:read',
      },
    },
    {
      path: 'audit',
      name: 'systemAudit',
      component: () => import('@/views/system/audit/index.vue'),
      meta: {
        title: '审计日志',
        icon: 'qs-audit-log',
        auth: 'audit:read',
      },
    },
  ],
}

export default routes
