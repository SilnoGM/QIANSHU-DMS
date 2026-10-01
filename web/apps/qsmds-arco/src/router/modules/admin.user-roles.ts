import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 用户与角色分组的读取权限并集。
 *
 * 管理员工作台的主导航组会把自身 auth 覆盖到每个一级子路由，App.vue 再校验全部
 * matched 记录，因此这里声明的集合同时是分组菜单的 any-of 门槛，必须覆盖全部叶子。
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
