export interface ParsedContainerRow {
  rowKey: string
  sourceSheetName: string
  sourceRowNumber: number
  containerBatchName: string | null
  warehouseReceiptReference: string | null
  oceanShippingMarkText: string | null
  goodsName: string
  packageCount: number
  packageUnit: string | null
  grossWeightKg: string | null
  lengthCm: string | null
  widthCm: string | null
  heightCm: string | null
  reportedVolumeCai: string | null
  recipientName: string | null
  recipientPhone: string | null
  recipientAddress: string | null
  codAmountTwd: string | null
  remark: string | null
  sourceData: { cells: Record<string, { value: string | null, formula: string | null, type: string, sharedFormulaIndex: string | null, mergedFrom: string | null }> }
  errors: string[]
  warnings: string[]
}
export class ContainerWorkbookParseError extends Error {
  constructor(message = '装柜明细表格式无效，请使用有效的 .xlsx 文件') { super(message); this.name = 'ContainerWorkbookParseError' }
}
export interface WorkbookCell {
  reference: string
  value: string | null
  formula: string | null
  sharedFormulaIndex: string | null
  type: string
  mergedFrom: string | null
}
export interface WorkbookSheet {
  name: string
  index: number
  rows: Map<number, Map<number, WorkbookCell>>
}
