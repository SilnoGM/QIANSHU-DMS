import type { PurchasePaymentRecordDto } from '../../../api/generated/types.gen'

export type PurchasePaymentRecordStatusFilter = 'ACTIVE' | 'ALL' | 'VOIDED'

export function canVoidPurchasePaymentRecord(
  record: PurchasePaymentRecordDto,
): boolean {
  return record.voidedAt === null
}

export function purchasePaymentRecordStatusFilterItems(
  translate: (key: string) => string,
): Array<{ label: string, value: PurchasePaymentRecordStatusFilter }> {
  return [
    { label: translate('purchasePayment.records.statusAll'), value: 'ALL' },
    { label: translate('purchasePayment.records.statusActive'), value: 'ACTIVE' },
    { label: translate('purchasePayment.records.statusVoided'), value: 'VOIDED' },
  ]
}
