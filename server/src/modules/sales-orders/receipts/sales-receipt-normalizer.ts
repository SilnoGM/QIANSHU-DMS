import { receiptFailure } from './sales-receipt-money'

export function normalizeReceiptReason(value: string | null | undefined): string | null {
  const normalized = value?.trim().normalize('NFKC') || null
  if (normalized && [...normalized].length > 500) receiptFailure('VALIDATION_FAILED', '备注或原因不得超过500字')
  return normalized
}
