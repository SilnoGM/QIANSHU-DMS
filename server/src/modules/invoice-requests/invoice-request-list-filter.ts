import { Prisma } from '../../generated/prisma/client'
import { INVOICE_REQUEST_STATUS_VALUES } from './invoice-request.contract'
import { INVOICE_SETTLE_WAIT_HOURS } from './invoice-request.logic'

export const INVOICE_REQUEST_STATUS_FILTER_VALUES = [...INVOICE_REQUEST_STATUS_VALUES, 'ALL'] as const
export type InvoiceRequestStatusFilterValue = (typeof INVOICE_REQUEST_STATUS_FILTER_VALUES)[number]

/** 「已开出邮寄」的二级视图：未满 120 小时（等待中）与已满 120 小时（可结算）。 */
export const INVOICE_ISSUED_SETTLE_VIEW_VALUES = ['WAITING', 'SETTLEABLE'] as const
export type InvoiceIssuedSettleView = (typeof INVOICE_ISSUED_SETTLE_VIEW_VALUES)[number]

/** 上传时刻落在该分界之前（含）即可结算；列表、计数与前端倒计时共用 120 小时口径。 */
export function resolveIssuedSettleCutoff(now: Date): Date {
  return new Date(now.getTime() - INVOICE_SETTLE_WAIT_HOURS * 3_600_000)
}

export interface InvoiceRequestListFilterInput {
  readonly keyword?: string
  readonly status?: InvoiceRequestStatusFilterValue
  /** 二级视图只对「已开出邮寄」有意义；传入时强制 status=ISSUED。 */
  readonly issuedView?: InvoiceIssuedSettleView
  /**
   * 行级归属：没有跨提交人权限时服务端强制带上提交人 id。
   * 这个条件由服务端计算后注入，不接受客户端直接指定。
   */
  readonly ownerId?: string
}

/**
 * 列表与计数的唯一条件构造点：搜索、状态与归属过滤在这里集中表达，
 * 避免列表、计数与详情三处谓词漂移。`omitStatus` 用来构造「忽略状态维度」的计数基准。
 */
export function buildInvoiceRequestListWhere(
  filter: InvoiceRequestListFilterInput,
  options: { now?: Date, omitStatus?: boolean } = {},
): Prisma.InvoiceRequestWhereInput {
  const keyword = filter.keyword?.trim()
  const status = options.omitStatus === true ? undefined : filter.status
  // 计数基准必须忽略二级视图，否则等待中/可结算会互相排斥、拿不到同一分母。
  const issuedView = options.omitStatus === true ? undefined : filter.issuedView
  const cutoff = resolveIssuedSettleCutoff(options.now ?? new Date())
  const statusCondition: Prisma.InvoiceRequestWhereInput = issuedView === undefined
    ? (status === undefined || status === 'ALL' ? {} : { status })
    : {
        status: 'ISSUED',
        documentUploadedAt: issuedView === 'SETTLEABLE' ? { lte: cutoff } : { gt: cutoff },
      }
  return {
    ...(filter.ownerId === undefined ? {} : { createdById: filter.ownerId }),
    ...statusCondition,
    ...(keyword === undefined || keyword === ''
      ? {}
      : {
          OR: [
            { invoiceNo: { contains: keyword, mode: 'insensitive' } },
            { buyerName: { contains: keyword, mode: 'insensitive' } },
            { buyerTaxId: { contains: keyword, mode: 'insensitive' } },
            { invoiceRemark: { contains: keyword, mode: 'insensitive' } },
            { internalRemark: { contains: keyword, mode: 'insensitive' } },
            { recipientName: { contains: keyword, mode: 'insensitive' } },
          ],
        }),
  }
}
