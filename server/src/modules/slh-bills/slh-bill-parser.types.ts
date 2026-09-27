import type { SlhParsedCharge } from './slh-bill-charge-parser'
import type { SlhPricingBasisValue } from './slh-bill-calculation'
import type { WorkbookCell } from '../container-batches/import-parser.types'

/**
 * 复算与账单的出入项。差异与告警共用一张表，靠 severity 区分：
 * difference 表示两边数字对不上，warning 表示来源需要留意但不构成出入。
 */
export type SlhBillFindingKind =
  | 'FREIGHT_MISMATCH'
  | 'PAYABLE_MISMATCH'
  | 'VOLUME_MISMATCH'
  | 'CHARGE_MISMATCH'
  | 'SUBTOTAL_MISMATCH'
  | 'NET_AMOUNT_MISMATCH'
  | 'DIMENSION_PRECISION'
  | 'RATE_MISSING'
  | 'REMARK_NOTE'

export type SlhBillFindingSeverity = 'difference' | 'warning'

export interface SlhBillFinding {
  kind: SlhBillFindingKind
  severity: SlhBillFindingSeverity
  /** 行级出问题时的明细行序号（账单内第几行）；账单级问题为 null。 */
  lineNumber: number | null
  /** 同一行在原表里的行号，与界面上「行号」列一致；账单级问题为 null。 */
  sourceRowNumber: number | null
  message: string
}

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
  /** 收货人信息解析结果；解析不出时为 null，原文仍完整保留在 recipientInfoRaw。 */
  recipientName: string | null
  recipientPhones: string | null
  recipientAddress: string | null
  remark: string | null
  charges: SlhParsedCharge[]
  /** 无法按字段长度或格式落库的问题；存在时整张账单拒绝入库。 */
  errors: string[]
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
    /** 账单「小计」行的应付金额、代收货款与 NTD 杂费；缺失时为空。 */
    subtotalPayableAmountCny: string | null
    subtotalCodAmountTwd: string | null
    subtotalNtdSurchargeAmountTwd: string | null
    payableAmountCny: string | null
    netAmountTwd: string | null
    netAmountFormula: string | null
    embeddedForeignUnitsPerCny: string | null
  }
  lines: ParsedSlhBillLine[]
  /** 全部差异与告警；行级与账单级视图都由这一份数据派生。 */
  findings: SlhBillFinding[]
}

export class SlhBillWorkbookParseError extends Error {
  constructor(message = '顺联航账单格式无效，请使用对方提供的 .xlsx 对账单') {
    super(message)
    this.name = 'SlhBillWorkbookParseError'
  }
}

export type SlhWorkbookCell = WorkbookCell
