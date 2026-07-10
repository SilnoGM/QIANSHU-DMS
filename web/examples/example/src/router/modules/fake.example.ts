import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/fake_example',
  component: () => import('@/views/fake_example/index.vue'),
  name: 'fakeExample',
  meta: {
    title: $t('route.fake'),
    icon: 'i-ri:database-2-line',
    singleMenu: true,
  },
}

export default routes
