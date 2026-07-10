import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/auth_example',
  component: Layout,
  name: 'authExample',
  meta: {
    title: $t('route.auth.root'),
    icon: 'i-ri:shield-keyhole-line',
  },
  children: [
    {
      path: '',
      name: 'authExampleIndex',
      component: () => import('@/views/auth_example/index.vue'),
      meta: {
        title: $t('route.auth.root'),
        menu: false,
        breadcrumb: false,
        activeMenu: '/auth_example',
      },
    },
    {
      path: 'test',
      name: 'authExampleTest',
      component: () => import('@/views/auth_example/test.vue'),
      meta: {
        title: $t('route.auth.test'),
        auth: ['pages.general:browse'],
        menu: false,
        breadcrumb: false,
        activeMenu: '/auth_example',
      },
    },
  ],
}

export default routes
