import { Prisma } from '../../generated/prisma/client'

export interface SlhBillLineFilterInput {
  /** 明细模糊搜索关键字：入仓单号、唛头、货名、收货人信息。 */
  keyword?: string
  /** 账单上的柜号原文（`container_batch_name_text`），精确匹配。 */
  containerBatchName?: string
}

/**
 * 明细列表的过滤条件：先把范围收窄到本账单，再叠加可选的柜号与关键字。
 *
 * 关键字用 insensitive contains —— 单号、唛头、货名与收货人信息都是核对时的手工检索入口，
 * 用户往往只记得片段；柜号则按账单原文精确匹配，避免 `0102-01柜` 与 `0102-01` 这类写法互相串。
 * 空白输入一律视为未筛选，否则会返回一个"有筛选条件但搜不到"的空页。
 */
export function buildSlhBillLineWhere(billId: string, filter: SlhBillLineFilterInput = {}): Prisma.SlhBillLineWhereInput {
  const keyword = filter.keyword?.trim()
  const containerBatchName = filter.containerBatchName?.trim()
  return {
    billId,
    ...(containerBatchName === undefined || containerBatchName === '' ? {} : { containerBatchNameText: containerBatchName }),
    ...(keyword === undefined || keyword === '' ? {} : {
      OR: [
        { warehouseReceiptReference: { contains: keyword, mode: 'insensitive' } },
        { shippingMarkText: { contains: keyword, mode: 'insensitive' } },
        { goodsName: { contains: keyword, mode: 'insensitive' } },
        { recipientInfoRaw: { contains: keyword, mode: 'insensitive' } },
      ],
    }),
  }
}
