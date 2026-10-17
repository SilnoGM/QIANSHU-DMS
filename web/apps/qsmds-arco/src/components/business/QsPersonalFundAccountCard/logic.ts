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
