import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/layout_center_example',
  component: Layout,
  name: 'layoutCenterExample',
  meta: {
    title: $t('route.layoutCenter.root'),
    icon: 'i-lucide:gallery-horizontal',
    badge: 'PRO',
  },
  children: [
    {
      path: 'inner',
      name: 'layoutCenterExampleInner',
      component: () => import('@/views/layout_center_example/inner.vue'),
      meta: {
        title: $t('route.layoutCenter.inner'),
        layout: {
          center: true,
          centerScope: 'inner',
        },
      },
    },
    {
      path: 'outer',
      name: 'layoutCenterExampleOuter',
      component: () => import('@/views/layout_center_example/outer.vue'),
      meta: {
        title: $t('route.layoutCenter.outer'),
        layout: {
          center: true,
          centerScope: 'outer',
        },
      },
    },
  ],
}

export default routes
