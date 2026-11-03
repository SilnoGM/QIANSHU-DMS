import { createHash } from 'node:crypto'

import {
  ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH,
  ADVERTISING_RECHARGE_CURRENCY_VALUES,
  ADVERTISING_RECHARGE_DEFAULT_CURRENCY,
  ADVERTISING_RECHARGE_REASON_MAX_LENGTH,
  ADVERTISING_RECHARGE_REMARK_MAX_LENGTH,
  type AdvertisingRechargeCurrencyValue,
} from './advertising-recharge.contract'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u
const REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** 金额只接受正数、最多两位小数；返回固定两位小数字符串。 */
export function normalizeAdvertisingRechargeAmount(value: string): string {
  const normalized = value.trim()
  if (!AMOUNT_PATTERN.test(normalized)) {
    throw new RangeError('金额格式无效')
  }
  const [integer, fraction = ''] = normalized.split('.')
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents <= 0n) {
    throw new RangeError('金额必须大于 0')
  }
  return `${integer}.${fraction.padEnd(2, '0')}`
}

/** 币种缺省为美元；只接受契约白名单，避免把任意三字母当币种落库。 */
export function normalizeAdvertisingRechargeCurrency(value: string | undefined): AdvertisingRechargeCurrencyValue {
  if (value === undefined) return ADVERTISING_RECHARGE_DEFAULT_CURRENCY
  const normalized = value.trim().toUpperCase()
  if (!ADVERTISING_RECHARGE_CURRENCY_VALUES.includes(normalized as AdvertisingRechargeCurrencyValue)) {
    throw new RangeError('币种只支持人民币或美元')
  }
  return normalized as AdvertisingRechargeCurrencyValue
}

/** 账户名称/编号去掉首尾空白后必须非空，长度按列宽收敛。 */
export function normalizeAdvertisingAccountText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH) {
    throw new RangeError(`${label}不能为空且不能超过 ${ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH} 个字符`)
  }
  return normalized
}

/** 备注选填；纯空白视为未填写，避免与空字符串两种形态并存。 */
export function normalizeAdvertisingRechargeRemark(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (normalized.length > ADVERTISING_RECHARGE_REMARK_MAX_LENGTH) {
    throw new RangeError(`备注不能超过 ${ADVERTISING_RECHARGE_REMARK_MAX_LENGTH} 个字符`)
  }
  return normalized
}

/** 驳回与作废原因必填；调用方负责给出缺少原因时的业务文案。 */
export function normalizeAdvertisingRechargeReason(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > ADVERTISING_RECHARGE_REASON_MAX_LENGTH) {
    throw new RangeError(`原因不能为空且不能超过 ${ADVERTISING_RECHARGE_REASON_MAX_LENGTH} 个字符`)
  }
  return normalized
}

export function requireAdvertisingRechargeRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    throw new RangeError('缺少或非法的 Idempotency-Key 请求头')
  }
  return value.toLowerCase()
}

export function requireAdvertisingRechargeMediaId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new RangeError('媒体资产 id 无效')
  }
  return value.toLowerCase()
}

export function hashAdvertisingRechargeRequestKey(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  bytes.set(createHash('sha256').update(value).digest())
  return bytes
}

/**
 * 编号指纹绑定全部不可变申请内容：同一幂等键改了任何字段都必须冲突，
 * 不能复用旧单号生成一张内容不同的申请。
 */
export function hashAdvertisingRechargeNumberFingerprint(input: {
  readonly applicantUserId: string
  readonly accountType: string
  readonly adAccountName: string
  readonly adAccountNo: string
  readonly rechargeAmount: string
  readonly rechargeCurrency: string
  readonly paymentQrMediaAssetId: string | null
  readonly remark: string | null
  readonly requestKey: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    format: 'advertising-recharge.create.v1',
    applicantUserId: input.applicantUserId,
    accountType: input.accountType,
    adAccountName: input.adAccountName,
    adAccountNo: input.adAccountNo,
    rechargeAmount: input.rechargeAmount,
    rechargeCurrency: input.rechargeCurrency,
    paymentQrMediaAssetId: input.paymentQrMediaAssetId,
    remark: input.remark,
    requestKey: input.requestKey,
  })).digest('hex')
}

function formatFilenameAmount(amount: string): string {
  return amount
    .replace(/(\.\d*?)0+$/u, '$1')
    .replace(/\.$/u, '')
}

function formatShanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(value).replaceAll('-', '')
}

function safeDisplayName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80) || '申请人'
}

function requireExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (!['.jpg', '.png', '.webp'].includes(normalized)) {
    throw new RangeError('图片扩展名无效')
  }
  return normalized
}

/** 付款截图展示名：申请人-广告充值{金额}元-{YYYYMMDD}，只改展示名不改对象键。 */
export function buildAdvertisingRechargeProofFilename(input: {
  readonly amount: string
  readonly displayName: string
  readonly extension: string
  readonly uploadedAt: Date
}): string {
  return [
    safeDisplayName(input.displayName),
    '-广告充值',
    formatFilenameAmount(input.amount),
    '元-',
    formatShanghaiDate(input.uploadedAt),
    requireExtension(input.extension),
  ].join('')
}

/** 收款二维码展示名：申请人-广告账户充值收款码-{YYYYMMDD}，只改展示名不改对象键。 */
export function buildAdvertisingRechargeQrFilename(input: {
  readonly displayName: string
  readonly extension: string
  readonly uploadedAt: Date
}): string {
  return [
    safeDisplayName(input.displayName),
    '-广告账户充值收款码-',
    formatShanghaiDate(input.uploadedAt),
    requireExtension(input.extension),
  ].join('')
}
