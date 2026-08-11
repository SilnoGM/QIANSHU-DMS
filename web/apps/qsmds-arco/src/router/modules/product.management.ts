import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 当前产品管理只提供列表与新增两个占位入口，因此权限边界保持最小。
 * 数组用于父菜单的 any-of 判定，叶子路由继续各自声明精确权限。
 */
export const PRODUCT_MANAGEMENT_PERMISSIONS = [
  'products:read',
  'products:create',
] as const

const routes: RouteRecordRaw = {
  path: '/admin/products',
  name: 'adminProductManagement',
  component: Layout,
  meta: {
    title: '产品管理',
    icon: 'i-lucide:package-open',
    auth: [...PRODUCT_MANAGEMENT_PERMISSIONS],
  },
  children: [
    {
      path: 'create',
      name: 'adminProductCreate',
      component: () => import('@/views/admin/product-management/create/index.vue'),
      meta: {
        title: '新增产品',
        icon: 'i-lucide:package-plus',
        auth: 'products:create',
      },
    },
    {
      path: 'list',
      name: 'adminProductList',
      component: () => import('@/views/admin/product-management/list/index.vue'),
      meta: {
        title: '产品列表',
        icon: 'i-lucide:list',
        auth: 'products:read',
      },
    },
  ],
}

export default routes
