import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/icon_example',
  redirect: '/component_example/icon',
  meta: {
    title: $t('route.icon'),
    icon: 'i-ri:remixicon-line',
  },
}

export default routes
