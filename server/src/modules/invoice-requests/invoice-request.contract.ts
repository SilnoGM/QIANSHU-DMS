import { InvoiceRequestAction, InvoiceRequestStatus } from '../../generated/prisma/enums'

/** 开票申请的状态与动作取值，全部从 Prisma 生成的枚举派生，避免与数据库枚举漂移。 */
export const INVOICE_REQUEST_STATUS_VALUES = Object.values(InvoiceRequestStatus)
export type InvoiceRequestStatusValue = keyof typeof InvoiceRequestStatus

export const INVOICE_REQUEST_ACTION_VALUES = Object.values(InvoiceRequestAction)
export type InvoiceRequestActionValue = keyof typeof InvoiceRequestAction

/** 终态：不可再流转，整单不可变。 */
export const INVOICE_REQUEST_TERMINAL_STATUS_VALUES: readonly InvoiceRequestStatusValue[] = [
  InvoiceRequestStatus.SETTLED,
  InvoiceRequestStatus.CANCELLED,
]

/** 运营只能取消这两个状态（尚未通知代开票方，撤回零成本）；财务另见 manager 判定。 */
export const INVOICE_REQUEST_OWNER_CANCEL_STATUS_VALUES: readonly InvoiceRequestStatusValue[] = [
  InvoiceRequestStatus.PENDING_REVIEW,
  InvoiceRequestStatus.RETURNED,
]

/**
 * 四项比对（抬头 + 统编 + 营业税 + 总计）的比对池：不含已取消与已退回，
 * 因此「取消后新建」与「退回重填」都不会自己撞自己。
 */
export const INVOICE_REQUEST_DUPLICATE_POOL_STATUS_VALUES: readonly InvoiceRequestStatusValue[] = [
  InvoiceRequestStatus.PENDING_REVIEW,
  InvoiceRequestStatus.NOTIFIED,
  InvoiceRequestStatus.ISSUED,
  InvoiceRequestStatus.SETTLED,
]

/**
 * 「可跨提交人操作」的标记权限：财务持有 `:read-all`，据此获得全量视图、
 * 以及对他人单据的取消能力。权限守卫只保证「能进这个接口」，行级归属必须在这层判定。
 */
export const INVOICE_REQUEST_MANAGER_PERMISSION_CODE = 'invoice-requests:read-all'

/** 明细行上限（下限 1 由提交校验保证）。 */
export const INVOICE_REQUEST_LINE_LIMIT = 5

/** 发票照片的媒体池与用途标记。 */
export const INVOICE_REQUEST_DOCUMENT_POOL = 'invoice'
export const INVOICE_REQUEST_DOCUMENT_UPLOAD_PURPOSE = 'INVOICE_REQUEST_DOCUMENT'
