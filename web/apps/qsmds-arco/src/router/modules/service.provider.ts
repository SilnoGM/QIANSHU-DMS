import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

export const SERVICE_PROVIDER_READ_PERMISSIONS = [
  'suppliers:read',
] as const

/** 合作供方父级保持权限中立；空父菜单由生产递归菜单过滤器自动隐藏。 */
const routes: RouteRecordRaw = {
  path: '/system/service-provider',
  name: 'systemServiceProvider',
  component: Layout,
  meta: {
    title: '合作供方',
    icon: 'i-lucide:handshake',
  },
  children: [
    {
      path: 'suppliers',
      name: 'systemServiceProviderSuppliers',
      component: () => import(
        '@/views/system/service-provider/suppliers/index.vue'
      ),
      meta: {
        title: '供应商管理',
        icon: 'i-lucide:factory',
        auth: 'suppliers:read',
      },
    },
  ],
}

export default routes
