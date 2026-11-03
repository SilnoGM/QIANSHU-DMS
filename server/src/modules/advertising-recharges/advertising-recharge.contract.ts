/**
 * 广告账户充值的稳定契约：状态、账户类型、权限码、编号、媒体用途与限额。
 *
 * 媒体用途必须与迁移里的 `media_assets_upload_purpose_check` 以及
 * `enforce_ready_media_asset_reference` 保持同一集合，否则上传能成功但引用会失败。
 */
export const ADVERTISING_RECHARGE_STATUS_VALUES = [
  'PENDING',
  'PAID',
  'REJECTED',
  'WITHDRAWN',
  'VOIDED',
] as const
export type AdvertisingRechargeStatusValue = (typeof ADVERTISING_RECHARGE_STATUS_VALUES)[number]

export const ADVERTISING_RECHARGE_STATUS_FILTER_VALUES = [
  'ALL',
  ...ADVERTISING_RECHARGE_STATUS_VALUES,
] as const
export type AdvertisingRechargeStatusFilterValue = (typeof ADVERTISING_RECHARGE_STATUS_FILTER_VALUES)[number]

/** 账户类型与数据库枚举一一对应；只有个人户需要收款二维码。 */
export const ADVERTISING_ACCOUNT_TYPE_VALUES = ['PERSONAL', 'NON_PERSONAL'] as const
export type AdvertisingAccountTypeValue = (typeof ADVERTISING_ACCOUNT_TYPE_VALUES)[number]

export const ADVERTISING_RECHARGE_CURRENCY_VALUES = ['CNY', 'USD'] as const
export type AdvertisingRechargeCurrencyValue = (typeof ADVERTISING_RECHARGE_CURRENCY_VALUES)[number]
export const ADVERTISING_RECHARGE_DEFAULT_CURRENCY: AdvertisingRechargeCurrencyValue = 'USD'

/** 运营只看本人，财务看全部：读取权限分成两个码，不能靠数据范围兜底。 */
export const ADVERTISING_RECHARGE_PERMISSION_READ_SELF = 'advertising-recharges:read-self'
export const ADVERTISING_RECHARGE_PERMISSION_CREATE = 'advertising-recharges:create'
export const ADVERTISING_RECHARGE_PERMISSION_READ = 'advertising-recharges:read'
export const ADVERTISING_RECHARGE_PERMISSION_PAY = 'advertising-recharges:pay'
export const ADVERTISING_RECHARGE_PERMISSION_CODES = [
  ADVERTISING_RECHARGE_PERMISSION_READ_SELF,
  ADVERTISING_RECHARGE_PERMISSION_CREATE,
  ADVERTISING_RECHARGE_PERMISSION_READ,
  ADVERTISING_RECHARGE_PERMISSION_PAY,
] as const

/** 静态节点当前只有占位页，仍需独立权限码，避免借用广告充值权限。 */
export const NETWORK_NODE_PERMISSION_READ = 'network-nodes:read'

export const ADVERTISING_RECHARGE_NO_RULE_CODE = 'ADVERTISING_RECHARGE_NO'
export const ADVERTISING_RECHARGE_NO_CONSUMER_CODE = 'ADVERTISING_RECHARGE.CREATE'

/** 收款二维码是个人收款码，与既有收款码同池；付款截图是付款凭证，沿用 voucher 池。 */
export const ADVERTISING_RECHARGE_QR_POOL = 'payment-recipient'
export const ADVERTISING_RECHARGE_QR_UPLOAD_PURPOSE = 'ADVERTISING_RECHARGE_QR'
export const ADVERTISING_RECHARGE_PROOF_POOL = 'voucher'
export const ADVERTISING_RECHARGE_PROOF_UPLOAD_PURPOSE = 'ADVERTISING_RECHARGE_PAYMENT_PROOF'
export const ADVERTISING_RECHARGE_MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ADVERTISING_RECHARGE_MEDIA_MAX_BYTES = 10n * 1024n * 1024n

/** 下载文件名按 MIME 固定扩展名，不沿用用户上传的文件名。 */
export const ADVERTISING_RECHARGE_EXTENSION_BY_MIME: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
})

/** 广告账户名称与编号都是自由文本，限制长度并禁止首尾空白。 */
export const ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH = 128
export const ADVERTISING_RECHARGE_REMARK_MAX_LENGTH = 500
export const ADVERTISING_RECHARGE_REASON_MAX_LENGTH = 500
