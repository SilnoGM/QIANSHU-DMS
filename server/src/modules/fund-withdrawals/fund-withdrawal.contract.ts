/** 提款申请状态与筛选值；与数据库 enum 一一对应。 */
export const FUND_WITHDRAWAL_STATUS_VALUES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type FundWithdrawalStatusValue = (typeof FUND_WITHDRAWAL_STATUS_VALUES)[number]
export const FUND_WITHDRAWAL_STATUS_FILTER_VALUES = ['ALL', ...FUND_WITHDRAWAL_STATUS_VALUES] as const
export type FundWithdrawalStatusFilterValue = (typeof FUND_WITHDRAWAL_STATUS_FILTER_VALUES)[number]

export const FUND_WITHDRAWAL_PERMISSION_CREATE = 'fund-withdrawals:create'
export const FUND_WITHDRAWAL_PERMISSION_REVIEW = 'fund-withdrawals:review'
export const FUND_WITHDRAWAL_NO_RULE_CODE = 'FUND_WITHDRAWAL_NO'
export const FUND_WITHDRAWAL_NO_CONSUMER_CODE = 'FUND_WITHDRAWAL.CREATE'

/** 付款截图是付款凭证，复用既有 voucher 池；用途独立，避免与其它凭证互相复用。 */
export const FUND_WITHDRAWAL_PAYMENT_PROOF_POOL = 'voucher'
export const FUND_WITHDRAWAL_PAYMENT_PROOF_UPLOAD_PURPOSE = 'FUND_WITHDRAWAL_PAYMENT_PROOF'
export const FUND_WITHDRAWAL_PAYMENT_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const FUND_WITHDRAWAL_PAYMENT_PROOF_MAX_BYTES = 10n * 1024n * 1024n

/** 付款截图下载文件名使用的受控扩展名；上传前按 MIME 固定，不沿用用户文件名。 */
export const FUND_WITHDRAWAL_PROOF_EXTENSION_BY_MIME: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
})
