import type { SlhParsedCharge } from './slh-bill-charge-parser'
import type { SlhPricingBasisValue } from './slh-bill-calculation'
import type { WorkbookCell } from '../container-batches/import-parser.types'

export interface ParsedSlhBillLine {
  lineNumber: number
  sourceSheetName: string
  sourceRowNumber: number
  loadingDate: string
  containerBatchName: string
  warehouseReceiptReference: string | null
  shippingMarkText: string | null
  goodsName: string
  packageCount: number
  packageUnit: string | null
  grossWeightKg: string | null
  weightUnit: string | null
  lengthCm: string | null
  widthCm: string | null
  heightCm: string | null
  reportedVolumeCai: string | null
  volumeCai: string | null
  categoryCode: string | null
  unitPriceAmount: string | null
  pricingBasis: SlhPricingBasisValue | null
  freightAmountCny: string
  codHandlingAmountCny: string
  surchargeAmountCny: string
  payableAmountCny: string
  codAmountTwd: string
  ntdSurchargeAmountTwd: string
  recipientInfoRaw: string | null
  remark: string | null
  charges: SlhParsedCharge[]
  /** 备注里没有金额、不能成为费用行的片段。 */
  notes: string[]
  /** 复算值与账单缓存值不一致之处；不阻断入库。 */
  differences: string[]
  /** 无法按字段长度或格式落库的问题；存在时整张账单拒绝入库。 */
  errors: string[]
  warnings: string[]
  sourceData: { cells: Record<string, { value: string | null, formula: string | null, type: string, sharedFormulaIndex: string | null, mergedFrom: string | null }> }
}

export interface ParsedSlhBillTotals {
  freightTotalAmountCny: string
  codHandlingTotalAmountCny: string
  surchargeTotalAmountCny: string
  payableTotalAmountCny: string
  codTotalAmountTwd: string
  ntdSurchargeTotalAmountTwd: string
  reportedNetAmountTwd: string
}

export interface ParsedSlhBill {
  periodStart: string
  periodEnd: string
  containerBatchNames: string[]
  totals: ParsedSlhBillTotals
  reported: {
    subtotalPayableAmountCny: string | null
    payableAmountCny: string | null
    netAmountTwd: string | null
    netAmountFormula: string | null
    embeddedForeignUnitsPerCny: string | null
  }
  lines: ParsedSlhBillLine[]
  differences: string[]
  warnings: string[]
}

export class SlhBillWorkbookParseError extends Error {
  constructor(message = '顺联航账单格式无效，请使用对方提供的 .xlsx 对账单') {
    super(message)
    this.name = 'SlhBillWorkbookParseError'
  }
}

export type SlhWorkbookCell = WorkbookCell
