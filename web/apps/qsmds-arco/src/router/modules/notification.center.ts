import type { RouteRecordRaw } from 'vue-router'

/**
 * 站内通知中心是登录用户个人页面，不占侧边栏菜单，由顶栏铃铛进入。
 */
const route: RouteRecordRaw = {
  path: 'notifications',
  name: 'notificationCenter',
  component: () => import('@/views/notifications/index.vue'),
  meta: {
    title: '通知中心',
    menu: false,
    breadcrumb: false,
  },
}

export default route
