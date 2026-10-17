import type { QsPersonalFundAccountCardState } from './types'

/** 金额隐藏态使用固定掩码；真实余额不参与任何字符串拼接。 */
export const PERSONAL_FUND_ACCOUNT_AMOUNT_MASK = '******'

/**
 * 分成比例只接受服务端输出的 0–100 两位小数字符串。
 *
 * 展示层不重新计算比例，也不接受缺小数位的输入；异常值统一回落占位符，
 * 避免把不完整的数据当成百分比展示。
 */
export function formatUserShareRate(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '—'
  }

  const normalized = value.trim()
  if (!/^(?:0|[1-9]\d?|100)\.\d{2}$/u.test(normalized)) {
    return '—'
  }

  return `${normalized}%`
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
