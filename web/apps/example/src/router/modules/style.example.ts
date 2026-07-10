import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/style_example',
  component: () => import('@/layouts/index.vue'),
  meta: {
    title: $t('route.style'),
    icon: 'i-ion:dice',
  },
  children: [
    {
      path: '',
      name: 'styleExample',
      component: () => import('@/views/style_example/index.vue'),
      meta: {
        title: $t('route.style'),
        menu: false,
        breadcrumb: false,
      },
    },
  ],
}

export default routes
