import type { DateTimeDisplayValue } from '../../base/DateTimeDisplay/format'
import type { QsPersonalFundAccountCardState } from './types'
import {
  DEFAULT_TIME_ZONE,
  EMPTY_DATE_TIME_TEXT,
  formatDateTime,
} from '../../base/DateTimeDisplay/format'

/** 金额隐藏态使用固定掩码；真实余额不参与任何字符串拼接。 */
export const PERSONAL_FUND_ACCOUNT_AMOUNT_MASK = '******'

const MILLISECONDS_PER_DAY = 86_400_000

/**
 * 把带显式时区的时间归一到上海自然日，返回该日 00:00 的 UTC 毫秒值。
 *
 * 复用 DateTimeDisplay 的严格校验：非法日历日期与缺少时区的字符串都视为不可用，
 * 避免浏览器本地时区把开户日算出一天偏差。
 */
function resolveShanghaiCalendarDay(value: DateTimeDisplayValue): number | null {
  const dateText = formatDateTime(value, 'date', DEFAULT_TIME_ZONE)
  if (dateText === EMPTY_DATE_TIME_TEXT) {
    return null
  }

  const dayEpochMs = Date.parse(`${dateText}T00:00:00.000Z`)
  return Number.isFinite(dayEpochMs) ? dayEpochMs : null
}

/**
 * 开户天数按上海自然日计算，开户当天算第 1 天。
 *
 * 调用方传入服务端校准后的“现在”，避免浏览器时钟偏差把天数算错；
 * 开户时间无法解析时返回 null，未来时间（时钟偏差或脏数据）收敛为第 1 天。
 */
export function resolveOpenedDays(
  createdAt: string | null | undefined,
  nowEpochMs: number,
): number | null {
  const openedDay = resolveShanghaiCalendarDay(createdAt)
  const currentDay = resolveShanghaiCalendarDay(nowEpochMs)
  if (openedDay === null || currentDay === null) {
    return null
  }

  const elapsedDays = Math.floor((currentDay - openedDay) / MILLISECONDS_PER_DAY)
  return Math.max(1, elapsedDays + 1)
}

/** 隐藏金额只保留币种符号与固定掩码，不携带真实金额。 */
export function formatMaskedAmount(symbol: string): string {
  const normalized = symbol.trim()
  return normalized.length > 0
    ? `${normalized} ${PERSONAL_FUND_ACCOUNT_AMOUNT_MASK}`
    : PERSONAL_FUND_ACCOUNT_AMOUNT_MASK
}

/**
 * 卡片状态优先级：加载中 → 失败 → 未开户 → 就绪。
 *
 * 加载中优先，避免首次请求还在进行时闪现旧账户或失败文案；
 * 空白错误文本不构成失败态。
 */
export function resolvePersonalFundAccountCardState(input: {
  loading: boolean
  error: string | null
  hasAccount: boolean
}): QsPersonalFundAccountCardState {
  if (input.loading) {
    return 'loading'
  }
  if (input.error !== null && input.error.trim().length > 0) {
    return 'error'
  }
  if (!input.hasAccount) {
    return 'empty'
  }
  return 'ready'
}

export type PersonalFundAccountPanelTone = 'green' | 'yellow' | 'red'

/**
 * 负余额识别只用于面板配色，不参与金额计算。
 *
 * 服务端输出普通十进制字符串；负零（-0.00）不算负数，
 * 异常值一律按非负数处理，避免面板误变黄色。
 */
export function isNegativeAmount(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) {
    return false
  }
  return Number(normalized) < 0
}

/**
 * 余额面板状态色：未开户红色、可见负余额黄色、其余绿色。
 *
 * 隐藏金额时即使余额为负也保持绿色：颜色不能反向暴露余额正负，
 * 否则金额隐藏就失去意义。
 */
export function resolvePersonalFundAccountPanelTone(input: {
  state: QsPersonalFundAccountCardState
  balance: string | null
  amountVisible: boolean
}): PersonalFundAccountPanelTone {
  if (input.state === 'empty') {
    return 'red'
  }
  if (
    input.state === 'ready'
    && input.amountVisible
    && isNegativeAmount(input.balance)
  ) {
    return 'yellow'
  }
  return 'green'
}
