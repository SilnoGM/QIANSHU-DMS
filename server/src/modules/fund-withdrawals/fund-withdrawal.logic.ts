import { createHash } from 'node:crypto'

const FUND_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u

/** 提款金额只接受正数、最多两位小数；返回固定两位小数字符串。 */
export function normalizeFundWithdrawalAmount(value: string): string {
  const normalized = value.trim()
  if (!FUND_AMOUNT_PATTERN.test(normalized)) {
    throw new RangeError('提款金额格式无效')
  }
  const [integer, fraction = ''] = normalized.split('.')
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents <= 0n) {
    throw new RangeError('提款金额必须大于 0')
  }
  return `${integer}.${fraction.padEnd(2, '0')}`
}

/** 文件名金额去掉无意义的小数尾零：100.00 → 100，100.50 → 100.5。 */
export function formatWithdrawalFilenameAmount(amount: string): string {
  return amount
    .replace(/(\.\d*?)0+$/u, '$1')
    .replace(/\.$/u, '')
}

/**
 * 付款截图的展示名：用户展示名-提款{金额}元-{YYYYMMDD}。
 * 只改 originalFilename，不改对象键；非法路径字符替换为下划线，长度按媒体字段上限收敛。
 */
export function buildFundWithdrawalProofFilename(input: {
  readonly amount: string
  readonly displayName: string
  readonly extension: string
  readonly uploadedAt: Date
}): string {
  const safeName = input.displayName
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80) || '用户'
  const extension = input.extension.toLowerCase()
  if (!['.jpg', '.png', '.webp'].includes(extension)) {
    throw new RangeError('付款截图扩展名无效')
  }
  const date = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(input.uploadedAt).replaceAll('-', '')
  return `${safeName}-提款${formatWithdrawalFilenameAmount(input.amount)}元-${date}${extension}`
}

/**
 * 财务审批该提款申请的站内直达链接。
 *
 * 契约：`APP_ORIGIN` 是纯 origin（无尾斜杠、无路径），前端默认 hash 路由，因此显式拼 `/#/`。
 * 路径必须与 `fund-account.management.ts` 的隐藏审批叶子保持一致；改路由时同步这里，
 * 否则通知里的链接会 404 而不是被类型检查发现。
 */
export function buildWithdrawalReviewUrl(appOrigin: string, requestId: string): string {
  return `${appOrigin}/#/qs-finance/fund-accounts/withdrawal-approvals/${encodeURIComponent(requestId)}`
}

/** 幂等键继续使用 UUID 契约；与开票申请保持一致。 */
const REQUEST_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function requireFundWithdrawalRequestKey(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_KEY_PATTERN.test(value)) {
    throw new RangeError('缺少或非法的 Idempotency-Key 请求头')
  }
  return value.toLowerCase()
}

export function hashFundWithdrawalRequestKey(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  bytes.set(createHash('sha256').update(value).digest())
  return bytes
}

export function hashFundWithdrawalNumberFingerprint(input: {
  readonly accountId: string
  readonly amount: string
  readonly userId: string
  readonly requestKey: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    format: 'fund-withdrawal.create.v1',
    accountId: input.accountId,
    amount: input.amount,
    userId: input.userId,
    requestKey: input.requestKey,
  })).digest('hex')
}
