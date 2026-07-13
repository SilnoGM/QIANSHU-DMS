import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/menu_icon_example',
  component: Layout,
  name: 'menuIconExample',
  meta: {
    title: $t('route.menuIcon.root'),
    icon: 'i-ri:check-fill',
    badge: 'PRO',
  },
  children: [
    {
      path: 'child',
      name: 'menuIconExampleChild',
      component: () => import('@/views/menu_icon_example/child.vue'),
      meta: {
        title: $t('route.menuIcon.child'),
        icon: ['i-twemoji:face-without-mouth', 'i-twemoji:grinning-face-with-big-eyes'],
      },
    },
    {
      path: 'parent',
      name: 'menuIconExampleParent',
      meta: {
        title: $t('route.menuIcon.parent.root'),
        icon: ['i-twemoji:face-without-mouth', 'i-twemoji:grinning-face-with-big-eyes'],
      },
      children: [
        {
          path: 'index',
          name: 'menuIconExampleParentIndex',
          component: () => import('@/views/menu_icon_example/parent.vue'),
          meta: {
            title: $t('route.menuIcon.parent.index'),
          },
        },
      ],
    },
  ],
}

export default routes
