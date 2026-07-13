import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/layout_container',
  redirect: '/component_pro_example/layout_container',
  meta: {
    title: $t('route.layout.container'),
    icon: 'i-bi:layout-three-columns',
    badge: 'PRO',
  },
}

export default routes
