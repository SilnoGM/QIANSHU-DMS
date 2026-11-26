export const DEFAULT_EVENT_QUIET_HOURS = Object.freeze({
  enabled: true,
  start: '23:00',
  end: '08:45',
  timezone: 'Asia/Shanghai',
})

export interface QuietHoursDraft {
  readonly enabled: boolean
  readonly start: string
  readonly end: string
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u

/**
 * 事件渠道静默配置 → 表单草稿。
 * 旧配置缺少 enabled 时按开启处理；null 视为未配置，回落到 23:00–08:45。
 */
export function quietHoursDraftFromDto(value: unknown): QuietHoursDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      enabled: DEFAULT_EVENT_QUIET_HOURS.enabled,
      start: DEFAULT_EVENT_QUIET_HOURS.start,
      end: DEFAULT_EVENT_QUIET_HOURS.end,
    }
  }
  const record = value as Record<string, unknown>
  return {
    enabled: record.enabled !== false,
    start: typeof record.start === 'string' && record.start.length > 0
      ? record.start
      : DEFAULT_EVENT_QUIET_HOURS.start,
    end: typeof record.end === 'string' && record.end.length > 0
      ? record.end
      : DEFAULT_EVENT_QUIET_HOURS.end,
  }
}

/** 关闭时仍提交时间值，方便重新开启；缺失时间回填默认值。 */
export function quietHoursPayload(draft: QuietHoursDraft): {
  readonly enabled: boolean
  readonly start: string
  readonly end: string
  readonly timezone: string
} {
  return {
    enabled: draft.enabled,
    start: draft.start.length > 0 ? draft.start : DEFAULT_EVENT_QUIET_HOURS.start,
    end: draft.end.length > 0 ? draft.end : DEFAULT_EVENT_QUIET_HOURS.end,
    timezone: DEFAULT_EVENT_QUIET_HOURS.timezone,
  }
}

export function quietHoursValidationError(draft: QuietHoursDraft): string | null {
  if (!draft.enabled) {
    return null
  }
  if (!TIME_PATTERN.test(draft.start) || !TIME_PATTERN.test(draft.end)) {
    return '开启静默时段后必须设置有效的开始和结束时间'
  }
  return null
}
