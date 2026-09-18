export type PurchaseStartPurchaseType = 'SALES_LINKED' | 'STOCK'
export type PurchaseStartProductMode = 'CATALOG' | 'CUSTOM'

export interface PurchaseStartPresetSalesOrder {
  readonly id: string
  readonly orderNo: string
}

export interface PurchaseStartSelection {
  readonly purchaseType: PurchaseStartPurchaseType
  readonly productMode: PurchaseStartProductMode
  readonly supplierValue: string | null
  readonly customSupplierName: string | null
  readonly paymentDraftKey?: string
}

export interface PurchaseStartPresetValidationResult {
  readonly eligible: boolean
  readonly message?: string | null
}

export type PurchaseStartPresetValidator = (
  selection: PurchaseStartSelection,
  presetSalesOrder: PurchaseStartPresetSalesOrder,
  signal: AbortSignal,
) => Promise<PurchaseStartPresetValidationResult>
