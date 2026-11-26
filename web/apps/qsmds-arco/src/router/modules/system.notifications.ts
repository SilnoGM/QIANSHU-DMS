import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 通知中心分组菜单：事件配置、通知记录与企业微信配置各自独立。
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
      'notification-policy:read',
      'wecom-channel:read',
      'wecom-app:read',
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
      path: 'wecom',
      name: 'systemNotificationWecom',
      component: () => import('@/views/system/notifications/wecom.vue'),
      meta: {
        title: '企业微信',
        icon: 'qs-notification',
        auth: ['wecom-channel:read', 'wecom-app:read'],
      },
    },
    {
      path: 'events',
      name: 'systemNotificationEvents',
      component: () => import('@/views/system/notifications/events/index.vue'),
      meta: {
        title: '事件配置',
        icon: 'qs-notification-policy',
        auth: 'notification-policy:read',
      },
    },
    {
      path: 'events/:eventType',
      name: 'systemNotificationEventDetail',
      component: () => import('@/views/system/notifications/events/detail.vue'),
      meta: {
        title: '事件配置详情',
        menu: false,
        auth: 'notification-policy:read',
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
