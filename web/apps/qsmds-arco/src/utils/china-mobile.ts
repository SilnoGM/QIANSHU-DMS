/**
 * 中国大陆手机号的纯逻辑。
 *
 * 存储层继续使用 E.164（`+86` + 11 位），本模块只负责界面层的剥离/拼接、
 * 输入归一化和号段校验。非 +86 或长度异常的存量值一律标记为 unsupported，
 * 由表单决定“未触碰则原样保留”，绝不在这里猜测国家码。
 */

export const CHINA_MOBILE_E164_PATTERN = /^\+861[3-9]\d{9}$/u
export const CHINA_MOBILE_NATIONAL_PATTERN = /^1[3-9]\d{9}$/u

export type ChinaMobileInputIssue = 'digits' | 'foreign' | 'length'

export interface ParsedStoredMobile {
  national: string
  unsupported: boolean
}

export function parseStoredMobileE164(
  value: string | null | undefined,
): ParsedStoredMobile {
  if (value === null || value === undefined || value === '') {
    return { national: '', unsupported: false }
  }

  if (!value.startsWith('+86')) {
    return { national: '', unsupported: true }
  }

  const national = value.slice(3)
  if (!/^\d{11}$/u.test(national)) {
    return { national: '', unsupported: true }
  }

  return {
    national,
    unsupported: !CHINA_MOBILE_NATIONAL_PATTERN.test(national),
  }
}

export function buildChinaMobileE164(national: string): string | null {
  return national === '' ? null : `+86${national}`
}

/**
 * 输入归一化：支持粘贴完整 E.164、`86` 前缀与常见分隔符。
 * 非 +86 的国际号码直接拒绝，避免把 `+886…` 误当成本地号码。
 */
export function normalizeMobileInput(
  raw: string,
): { digits: string, issue: ChinaMobileInputIssue | null } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { digits: '', issue: null }
  }

  let value = trimmed.replace(/[\s\-()]/gu, '')
  if (/^\+/u.test(value)) {
    if (!value.startsWith('+86')) {
      return { digits: '', issue: 'foreign' }
    }
    value = value.slice(3)
  }
  else if (/^86\d/u.test(value) && value.length > 11) {
    value = value.slice(2)
  }

  const digits = value.replace(/\D/gu, '')
  const issue: ChinaMobileInputIssue | null = digits.length !== value.length
    ? 'digits'
    : digits.length > 11
      ? 'length'
      : null

  return { digits: digits.slice(0, 11), issue }
}

export function validateChinaMobileNational(
  national: string,
): 'digits' | 'length' | 'segment' | null {
  if (national === '') {
    return null
  }
  if (!/^\d+$/u.test(national)) {
    return 'digits'
  }
  if (national.length !== 11) {
    return 'length'
  }
  if (!CHINA_MOBILE_NATIONAL_PATTERN.test(national)) {
    return 'segment'
  }
  return null
}
