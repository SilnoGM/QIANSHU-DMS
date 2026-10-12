import type { PurchaseOrderDocumentType, PurchaseOrderPaymentType } from '../../generated/prisma/enums'
import {
  formatPurchaseOrderAmountUnits,
  parsePurchaseOrderAmountUnits,
  sumPurchaseOrderPaidUnits,
} from './domain/purchase-order-decimal'

interface ChangeRecord {
  readonly id: string
  readonly changedAt: Date
  readonly reason: string | null
}

/** 列表只选择摘要必要字段；详情可传入完整记录，统一执行有效性及金额口径。 */
interface RecordSource {
  readonly payments: readonly {
    readonly paymentType: PurchaseOrderPaymentType
    readonly amount: { toFixed(places: number): string }
    readonly voidedAt: Date | null
  }[]
  readonly documents: readonly {
    readonly documentType: PurchaseOrderDocumentType
    readonly detachedAt: Date | null
  }[]
  readonly statusHistory: readonly ChangeRecord[]
  readonly amountRevisions: readonly ChangeRecord[]
  readonly _count: { readonly payments: number, readonly statusHistory: number, readonly amountRevisions: number }
}

export interface PurchaseOrderRecordSummaries {
  readonly paidAmount: string
  readonly paymentRecordSummary: {
    readonly totalCount: number
    readonly count: number
    readonly byType: readonly { readonly paymentType: PurchaseOrderPaymentType, readonly count: number, readonly amount: string }[]
  }
  readonly documentSummary: {
    readonly count: number
    readonly byType: readonly { readonly documentType: PurchaseOrderDocumentType, readonly count: number }[]
  }
  readonly changeSummary: {
    readonly statusCount: number
    readonly amountCount: number
    readonly latest: { readonly kind: 'STATUS' | 'AMOUNT', readonly changedAt: string, readonly reason: string | null } | null
  }
}

const PAYMENT_TYPES = ['DEPOSIT', 'BALANCE', 'OTHER'] as const
const DOCUMENT_TYPES = ['ORDER_ISSUANCE_VOUCHER', 'PAYMENT_VOUCHER', 'DELIVERY_RECEIPT'] as const

export function summarizePurchaseOrderRecords(source: RecordSource): PurchaseOrderRecordSummaries {
  const payments = source.payments.filter(payment => payment.voidedAt === null)
  const byPaymentType = PAYMENT_TYPES.map(paymentType => {
    const matching = payments.filter(payment => payment.paymentType === paymentType)
    // 读取四位原值后校验分精度，避免 toFixed(2) 掩盖未迁移的非零厘/毫。
    const amount = matching.reduce((sum, payment) => sum + parsePurchaseOrderAmountUnits(payment.amount.toFixed(4)), 0n)
    return { paymentType, count: matching.length, amount: formatPurchaseOrderAmountUnits(amount) }
  })
  const documents = source.documents.filter(document => document.detachedAt === null)
  // SQL 已按 changedAt / id 排序并只取每类最新项；详情同样保持该顺序。
  // 时间相同再比较带 kind 的稳定键，避免两个历史表具有相同 id 时产生随机结果。
  const candidates = [
    ...source.statusHistory.slice(0, 1).map(record => ({ kind: 'STATUS' as const, record })),
    ...source.amountRevisions.slice(0, 1).map(record => ({ kind: 'AMOUNT' as const, record })),
  ].sort((left, right) => {
    const time = right.record.changedAt.getTime() - left.record.changedAt.getTime()
    if (time !== 0) return time
    const leftKey = `${left.kind}:${left.record.id}`
    const rightKey = `${right.kind}:${right.record.id}`
    return leftKey === rightKey ? 0 : leftKey < rightKey ? 1 : -1
  })
  const latest = candidates[0]
  return {
    paidAmount: formatPurchaseOrderAmountUnits(sumPurchaseOrderPaidUnits(source.payments)),
    // 浏览记录总数包含作废历史；有效数量和金额继续只取未作废付款。
    paymentRecordSummary: { totalCount: source._count.payments, count: payments.length, byType: byPaymentType },
    documentSummary: {
      count: documents.length,
      byType: DOCUMENT_TYPES.map(documentType => ({
        documentType, count: documents.filter(document => document.documentType === documentType).length,
      })),
    },
    changeSummary: {
      statusCount: source._count.statusHistory,
      amountCount: source._count.amountRevisions,
      latest: latest === undefined ? null : {
        kind: latest.kind, changedAt: latest.record.changedAt.toISOString(), reason: latest.record.reason,
      },
    },
  }
}
