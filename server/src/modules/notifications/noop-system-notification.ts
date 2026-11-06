import type { SystemNotificationService } from './system-notification.service'

/**
 * 直接构造业务服务的测试夹具默认使用 no-op 发布器；Nest 运行时会注入真实服务。
 * 返回结构与真实发布结果一致，避免测试为通知依赖构造完整 Prisma 事务。
 */
export const noopSystemNotifications = {
  publish: () => Promise.resolve({
    notificationId: 'noop',
    duplicated: false,
    channels: [],
    warnings: [],
  }),
} as unknown as SystemNotificationService
