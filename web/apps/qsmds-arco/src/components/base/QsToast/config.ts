import type {
  QsToastId,
  QsToastRole,
  QsToastType,
} from './types'

/**
 * vue-sonner 会把 0 和空字符串同时当作“生成新 id”和“关闭全部”的假值。
 * 项目入口只允许有限正数或非空字符串，避免返回值、存储值和 dismiss 目标分叉。
 */
export function isUsableQsToastId(
  id: QsToastId | undefined,
): id is QsToastId {
  if (typeof id === 'number') {
    return Number.isFinite(id) && id > 0
  }

  return typeof id === 'string' && id.trim().length > 0
}

export const QS_TOAST_ICON_NAMES = {
  default: 'i-lucide:message-circle-more',
  error: 'i-lucide:circle-x',
  info: 'i-lucide:info',
  loading: 'i-lucide:loader-circle',
  success: 'i-lucide:circle-check',
  warning: 'i-lucide:triangle-alert',
} as const satisfies Record<QsToastType, string>

export const QS_TOAST_DEFAULT_DURATIONS = {
  default: 3200,
  error: 6000,
  info: 4000,
  loading: Number.POSITIVE_INFINITY,
  success: 2800,
  warning: 5000,
} as const satisfies Record<QsToastType, number>

/**
 * 类型只约束编译期调用，运行时仍可能收到脚本或旧页面传入的 NaN、负数。
 * 此处统一回退到状态默认值，避免底层计时器进入不可预测状态。
 */
export function resolveQsToastDuration(
  type: QsToastType,
  duration?: number,
): number {
  if (
    duration === Number.POSITIVE_INFINITY
    || (duration !== undefined && Number.isFinite(duration) && duration > 0)
  ) {
    return duration
  }

  return QS_TOAST_DEFAULT_DURATIONS[type]
}

/**
 * 永久提示不会自动退出，因此必须保留键盘可操作的关闭入口。错误提示默认可关闭，
 * 但有限时长提示仍允许调用方通过 closable 显式覆盖。
 */
export function resolveQsToastClosable(
  type: QsToastType,
  duration: number,
  closable?: boolean,
): boolean {
  if (duration === Number.POSITIVE_INFINITY) {
    return true
  }

  return closable ?? type === 'error'
}

export function resolveQsToastRole(type: QsToastType): QsToastRole {
  return type === 'error' ? 'alert' : 'status'
}
