import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw = {
  path: '/ui_example',
  component: () => import('@/views/ui_example/index.vue'),
  name: 'uiExample',
  meta: {
    title: 'UI',
    icon: 'i-whh:jqueryui',
    singleMenu: true,
    menu: false,
    breadcrumb: false,
    localeAuth: ['zh-cn', 'zh-tw'],
  },
}

export default routes
