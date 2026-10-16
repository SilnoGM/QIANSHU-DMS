import { Prisma } from '../../generated/prisma/client'
import { INVOICE_REQUEST_STATUS_VALUES } from './invoice-request.contract'

export const INVOICE_REQUEST_STATUS_FILTER_VALUES = [...INVOICE_REQUEST_STATUS_VALUES, 'ALL'] as const
export type InvoiceRequestStatusFilterValue = (typeof INVOICE_REQUEST_STATUS_FILTER_VALUES)[number]

export interface InvoiceRequestListFilterInput {
  readonly keyword?: string
  readonly status?: InvoiceRequestStatusFilterValue
  /**
   * 行级归属：没有跨提交人权限时由服务端强制带上提交人 id。
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
  options: { omitStatus?: boolean } = {},
): Prisma.InvoiceRequestWhereInput {
  const keyword = filter.keyword?.trim()
  const status = options.omitStatus === true ? undefined : filter.status
  return {
    ...(filter.ownerId === undefined ? {} : { createdById: filter.ownerId }),
    ...(status === undefined || status === 'ALL' ? {} : { status }),
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
