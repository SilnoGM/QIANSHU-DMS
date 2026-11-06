import type { RouteRecordRaw } from 'vue-router'

/**
 * 通知中心是系统管理下的单页入口，内部按权限收敛概览、千树小助理、
 * 通知规则与发送记录四个页签；没有通知权限的角色看不到菜单。
 */
const route: RouteRecordRaw = {
  path: '/system/notifications',
  name: 'systemNotifications',
  component: () => import('@/views/system/notifications/index.vue'),
  meta: {
    title: '通知中心',
    icon: 'qs-notification',
    auth: ['notification-record:read', 'notification-template:read', 'assistant-channel:read'],
    singleMenu: true,
  },
}

export default route
