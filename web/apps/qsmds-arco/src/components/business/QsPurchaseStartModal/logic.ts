import type {
  PurchaseStartProductMode,
  PurchaseStartPurchaseType,
  PurchaseStartSelection,
} from './types'

export interface PurchaseStartSupplierDraft {
  readonly supplierValue: string | null
  readonly customSupplierName: string
}

export interface PurchaseStartDraft extends PurchaseStartSupplierDraft {
  readonly productMode: PurchaseStartProductMode | null
}

export interface PurchaseStartDraftValidation {
  readonly valid: boolean
  readonly message: string | null
}

export function normalizeCustomSupplierName(value: string): string {
  return value.normalize('NFKC').trim()
}

export function resetPurchaseStartSupplierDraft(): PurchaseStartSupplierDraft {
  return {
    supplierValue: null,
    customSupplierName: '',
  }
}

export function validatePurchaseStartDraft(
  draft: PurchaseStartDraft,
): PurchaseStartDraftValidation {
  if (draft.productMode === null) {
    return { valid: false, message: '请选择采购产品类型' }
  }
  if (draft.productMode === 'CATALOG') {
    return draft.supplierValue?.trim()
      ? { valid: true, message: null }
      : { valid: false, message: '请选择供应商' }
  }

  const name = normalizeCustomSupplierName(draft.customSupplierName)
  if (!name) {
    return { valid: false, message: '请填写供应商名称' }
  }
  if ([...name].length > 128) {
    return { valid: false, message: '供应商名称不能超过 128 个字符' }
  }
  return { valid: true, message: null }
}

export function createPurchaseStartSelection(
  draft: PurchaseStartDraft & { readonly purchaseType: PurchaseStartPurchaseType },
): PurchaseStartSelection {
  if (draft.productMode === null) {
    throw new Error('Purchase product mode is required')
  }
  if (draft.productMode === 'CATALOG') {
    const supplierValue = draft.supplierValue?.trim()
    if (!supplierValue) {
      throw new Error('Catalog supplier is required')
    }
    return {
      purchaseType: draft.purchaseType,
      productMode: 'CATALOG',
      supplierValue,
      customSupplierName: null,
    }
  }

  const customSupplierName = normalizeCustomSupplierName(draft.customSupplierName)
  if (!customSupplierName || [...customSupplierName].length > 128) {
    throw new Error('Custom supplier name is invalid')
  }
  return {
    purchaseType: draft.purchaseType,
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName,
  }
}
