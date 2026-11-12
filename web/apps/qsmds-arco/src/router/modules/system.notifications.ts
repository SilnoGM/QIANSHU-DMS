import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 通知中心从单页签改为分组菜单：GeWe 助理、通知策略、通知记录各自独立。
 * 父级只承担分组与权限并集，具体页面权限由叶子声明；没有通知权限的角色看不到整组。
 */
const route: RouteRecordRaw = {
  path: '/system/notifications',
  name: 'systemNotifications',
  component: Layout,
  meta: {
    title: '通知中心',
    icon: 'qs-notification',
    auth: [
      'notification-record:read',
      'notification-template:read',
      'notification-policy:read',
      'assistant-channel:read',
      'assistant-account:read',
    ],
  },
  children: [
    {
      path: '',
      name: 'systemNotificationLanding',
      component: () => import('@/views/system/notifications/index.vue'),
      meta: {
        title: '通知中心',
        menu: false,
      },
    },
    {
      path: 'assistant',
      name: 'systemNotificationAssistant',
      component: () => import('@/views/system/notifications/assistant.vue'),
      meta: {
        title: 'GeWe助理',
        icon: 'qs-gewe-assistant',
        auth: ['assistant-channel:read', 'assistant-account:read'],
      },
    },
    {
      path: 'policies',
      name: 'systemNotificationPolicies',
      component: () => import('@/views/system/notifications/policies.vue'),
      meta: {
        title: '通知策略',
        icon: 'qs-notification-policy',
        auth: ['notification-template:read', 'notification-policy:read'],
      },
    },
    {
      path: 'records',
      name: 'systemNotificationRecords',
      component: () => import('@/views/system/notifications/records.vue'),
      meta: {
        title: '通知记录',
        icon: 'qs-notification-records',
        auth: 'notification-record:read',
      },
    },
  ],
}

export default route
