import { Prisma } from '../../generated/prisma/client'
import {
  collectContainerCandidateDates, matchSlhBillLines,
  type SlhBillContainerBatchInput, type SlhBillLineMatchSource, type SlhBillLineUnmatchedReason,
} from './slh-bill-line-matching'
import { slhReconciliationPreviewLineSelect, type SlhReconciliationPreviewLineSource } from './slh-reconciliation-batch.serializer'

export interface SlhReconciliationLineMatch {
  line: SlhReconciliationPreviewLineSource
  status: 'MATCHED' | 'UNMATCHED'
  source: SlhBillLineMatchSource | null
  reason: SlhBillLineUnmatchedReason | null
  loadingItemId: string | null
  containerBatchName: string | null
  loadingItemLineNumber: number | null
}

const isoDate = (value: Date): string => value.toISOString().slice(0, 10)

/**
 * 匹配一张账单里尚未对账的明细行。
 *
 * 服务端只按「柜号/唛头可能指向的日期」预加载柜次，判定规则全部交给
 * slh-bill-line-matching；调用方可以直接传事务客户端，把匹配放在创建事务内。
 */
export async function matchBillUnreconciledLines(
  client: Prisma.TransactionClient,
  billId: string,
): Promise<SlhReconciliationLineMatch[]> {
  const lines = await client.slhBillLine.findMany({
    where: { billId, reconciledAt: null },
    select: slhReconciliationPreviewLineSelect,
    orderBy: { lineNumber: 'asc' },
  })
  if (lines.length === 0) {
    return []
  }
  const inputs = lines.map(line => ({
    lineId: line.id,
    loadingDate: isoDate(line.loadingDate),
    containerBatchText: line.containerBatchNameText,
    shippingMarkText: line.shippingMarkText,
  }))
  const dates = collectContainerCandidateDates(inputs)
  const containers = dates.length === 0 ? [] : await client.containerBatch.findMany({
    where: { loadingDate: { in: dates.map(date => new Date(`${date}T00:00:00.000Z`)) } },
    select: {
      id: true, loadingDate: true, sequenceInDay: true, containerBatchName: true,
      items: {
        select: {
          id: true, lineNumber: true, oceanShippingMarkText: true,
          shipment: { select: { purchaseOrderId: true, purchaseOrder: { select: { salesOrderId: true } } } },
        },
      },
    },
  })
  const containerInputs: SlhBillContainerBatchInput[] = containers.map(container => ({
    id: container.id,
    loadingDate: isoDate(container.loadingDate),
    sequenceInDay: container.sequenceInDay,
    items: container.items.map(item => ({
      id: item.id,
      oceanShippingMarkText: item.oceanShippingMarkText,
      shipment: item.shipment === null ? null : {
        purchaseOrderId: item.shipment.purchaseOrderId,
        salesOrderId: item.shipment.purchaseOrder?.salesOrderId ?? null,
      },
    })),
  }))
  // 柜次行 → 所属柜次名称与行号：预览要展示匹配依据，没有它用户无法判断这行为什么算合格。
  const containerByItem = new Map<string, { containerBatchName: string, lineNumber: number }>()
  for (const container of containers) {
    for (const item of container.items) {
      containerByItem.set(item.id, { containerBatchName: container.containerBatchName, lineNumber: item.lineNumber })
    }
  }

  const results = matchSlhBillLines({ lines: inputs, containers: containerInputs })
  return lines.map((line, index) => {
    const result = results[index]
    const matched = result.loadingItemId === null ? null : containerByItem.get(result.loadingItemId) ?? null
    return {
      line,
      status: result.status,
      source: result.source,
      reason: result.reason,
      loadingItemId: result.loadingItemId,
      containerBatchName: matched?.containerBatchName ?? null,
      loadingItemLineNumber: matched?.lineNumber ?? null,
    }
  })
}
