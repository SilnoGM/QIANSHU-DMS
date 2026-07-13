import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/tabbar_example',
  component: Layout,
  name: 'tabbarExample',
  meta: {
    title: $t('route.tabbar.root'),
    icon: 'i-ic:round-tab',
    badge: true,
  },
  children: [
    {
      path: 'api',
      name: 'tabbarExampleApi',
      component: () => import('@/views/tabbar_example/api.vue'),
      meta: {
        title: $t('route.tabbar.api'),
      },
    },
    {
      path: 'merge',
      name: 'tabbarExampleMerge',
      meta: {
        title: $t('route.tabbar.merge'),
        badge: 'PRO',
      },
      children: [
        {
          path: 'route_name',
          name: 'tabbarExampleMergeRouteName',
          component: () => import('@/views/tabbar_example/merge/route_name/index.vue'),
          meta: {
            title: $t('route.tabbar.routeName'),
          },
        },
        {
          path: 'route_name/:id',
          name: 'tabbarExampleMergeRouteNameDetail',
          component: () => import('@/views/tabbar_example/merge/route_name/detail.vue'),
          meta: {
            title: $t('route.tabbar.detail'),
            menu: false,
            activeMenu: '/tabbar_example/merge/route_name',
            tabMerge: 'routeName',
          },
        },
        {
          path: 'active_menu',
          name: 'tabbarExampleMergeActiveMenu',
          component: () => import('@/views/tabbar_example/merge/active_menu/index.vue'),
          meta: {
            title: $t('route.tabbar.activeMenu'),
          },
        },
        {
          path: 'active_menu/:id',
          name: 'tabbarExampleMergeActiveMenuDetail',
          component: () => import('@/views/tabbar_example/merge/active_menu/detail.vue'),
          meta: {
            title: $t('route.tabbar.detail'),
            menu: false,
            activeMenu: '/tabbar_example/merge/active_menu',
            tabMerge: 'activeMenu',
          },
        },
      ],
    },
  ],
}

export default routes
