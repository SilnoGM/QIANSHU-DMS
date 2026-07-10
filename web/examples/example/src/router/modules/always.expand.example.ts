import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/always_opened_example',
  component: Layout,
  name: 'alwaysExpandExample',
  meta: {
    title: $t('route.alwaysExpand.root'),
    icon: 'i-fluent:text-bullet-list-tree-16-filled',
    badge: 'PRO',
  },
  children: [
    {
      path: 'page',
      name: 'alwaysExpandExample1',
      component: () => import('@/views/always_opened_example/page.vue'),
      meta: {
        title: $t('route.alwaysExpand.page'),
      },
    },
    {
      path: 'level2',
      name: 'alwaysExpandExample2',
      meta: {
        title: $t('route.alwaysExpand.level2.root'),
        expand: [true, true],
      },
      children: [
        {
          path: 'page',
          name: 'alwaysExpandExample2-1',
          component: () => import('@/views/always_opened_example/level2/page.vue'),
          meta: {
            title: $t('route.alwaysExpand.level2.page'),
          },
        },
        {
          path: 'level3',
          name: 'alwaysExpandExample2-2',
          meta: {
            title: $t('route.alwaysExpand.level2.level3.root'),
            expand: [true, true],
          },
          children: [
            {
              path: 'page1',
              name: 'alwaysExpandExample2-2-1',
              component: () => import('@/views/always_opened_example/level2/level3/page1.vue'),
              meta: {
                title: $t('route.alwaysExpand.level2.level3.page1'),
              },
            },
            {
              path: 'page2',
              name: 'alwaysExpandExample2-2-2',
              component: () => import('@/views/always_opened_example/level2/level3/page2.vue'),
              meta: {
                title: $t('route.alwaysExpand.level2.level3.page2'),
              },
            },
          ],
        },
      ],
    },
  ],
}

export default routes
