import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw = {
  path: '/jsx_example',
  component: () => import('@/views/jsx_example/index.vue'),
  name: 'jsxExample',
  meta: {
    title: 'JSX',
    icon: 'i-file-icons:jsx',
    singleMenu: true,
  },
}

export default routes
