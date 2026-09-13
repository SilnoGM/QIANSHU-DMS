import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'

interface ReceiptSourcePage {
  items: Array<Pick<SalesReceiptRequestDetailDto, 'id'> & {
    approvedPayment: Pick<NonNullable<SalesReceiptRequestDetailDto['approvedPayment']>, 'id'> | null
  }>
  total: number
}

/** 调用方按 status=APPROVED、pageSize=20 查询；不能用排除已作废收款的 view=APPROVED。 */
export async function findReceiptSourcePage(
  paymentId: string,
  fetchPage: (page: number) => Promise<ReceiptSourcePage>,
  signal: AbortSignal,
): Promise<{ page: number, requestId: string } | null> {
  for (let page = 1; ; page += 1) {
    signal.throwIfAborted()
    const result = await fetchPage(page)
    // 请求取消与响应返回可能交错，关闭弹窗后不再应用旧定位结果。
    signal.throwIfAborted()
    const source = result.items.find(item => item.approvedPayment?.id === paymentId)
    if (source) {
      return { page, requestId: source.id }
    }
    if (result.items.length === 0 || page * 20 >= result.total) {
      return null
    }
  }
}
