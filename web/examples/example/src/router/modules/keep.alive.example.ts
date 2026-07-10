import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/keep_alive_example',
  component: () => import('@/views/keep_alive_example/index.vue'),
  name: 'keepAliveExample',
  meta: {
    title: $t('route.keepAlive'),
    icon: 'i-cil:window-restore',
    singleMenu: true,
    keepAlive: true,
  },
}

export default routes
