import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'
import pinia from '@/store'

function Layout() {
  return import('@/layouts/index.vue')
}
const menuBadgeStore = useMenuBadgeStore(pinia)

const routes: RouteRecordRaw = {
  path: '/menu_badge_example',
  component: Layout,
  name: 'menuBadgeExample',
  meta: {
    title: $t('route.menuBadge.root'),
    icon: 'i-ri:notification-badge-line',
    badge: 'PRO',
  },
  children: [
    {
      path: 'dot',
      name: 'menuBadgeExampleDot',
      component: () => import('@/views/menu_badge_example/dot.vue'),
      meta: {
        title: $t('route.menuBadge.dot'),
        badge: () => menuBadgeStore.dot,
      },
    },
    {
      path: 'number',
      name: 'menuBadgeExampleNumber',
      component: () => import('@/views/menu_badge_example/number.vue'),
      meta: {
        title: $t('route.menuBadge.number'),
        badge: () => menuBadgeStore.number,
      },
    },
    {
      path: 'text',
      name: 'menuBadgeExampleText',
      component: () => import('@/views/menu_badge_example/text.vue'),
      meta: {
        title: $t('route.menuBadge.text'),
        badge: () => menuBadgeStore.text,
      },
    },
    {
      path: 'variant',
      name: 'menuBadgeExampleVariant',
      component: () => import('@/views/menu_badge_example/variant.vue'),
      meta: {
        title: $t('route.menuBadge.variant'),
        badge: ['!!!', () => menuBadgeStore.variant],
      },
    },
  ],
}

export default routes
