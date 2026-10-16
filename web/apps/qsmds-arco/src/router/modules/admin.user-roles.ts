import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 用户与角色分组的读取权限并集。
 *
 * 该数组只用于本分组的菜单过滤（any-of），必须覆盖组内全部叶子，否则叶子可见时
 * 分组已被整体过滤；工作台准入由「管理员工作台」的独立准入码 `workbench:admin`
 * 承担，不再与业务读码混用。
 */
export const ADMIN_USER_ROLE_READ_PERMISSIONS = [
  'users:read',
  'roles:read',
] as const

/**
 * 页面路由只做体验层权限收敛，服务端 PermissionGuard 仍是最终判定。
 * 权限目录沿用 roles:read，展示的是角色可分配的权限快照。
 */
const routes: RouteRecordRaw = {
  path: '/admin',
  name: 'adminUserRoles',
  component: Layout,
  meta: {
    title: '用户与角色',
    icon: 'qs-access-control',
    auth: [...ADMIN_USER_ROLE_READ_PERMISSIONS],
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
  ],
}

export default routes
