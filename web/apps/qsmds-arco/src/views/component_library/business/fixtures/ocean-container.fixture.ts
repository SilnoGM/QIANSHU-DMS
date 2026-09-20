import type { CurrencyDescriptor } from '@/components/base/currency'
import type { OceanContainerLine, OceanContainerSummary } from '@/components/business/QsOceanContainerList/types'

export interface DemoOceanContainerLine extends OceanContainerLine {
  recipientPhone: string
  recipientAddress: string
  remark: string | null
  grossWeightKg: string
  dimensionsCm: string
  packageCount: number
}

export const oceanContainerCurrencies: readonly CurrencyDescriptor[] = [
  { code: 'TWD', name: '新台币', symbol: 'NT$', minorUnit: 2, enabled: true },
]

const warehouseNames = [
  '顺联航-深圳南浦科技园B5仓',
  '顺联航-东莞虎门钦隆国际仓',
]

/** 仅包含演示销售员名下的行；整柜其他销售员的明细不进入组件。 */
export const oceanContainerDemoLines: Readonly<Record<string, readonly DemoOceanContainerLine[]>> = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => {
    const containerId = `demo-container-${index + 1}`
    const lineCount = index === 0 ? 23 : index === 1 || index === 2 ? 0 : 3
    return [containerId, Array.from({ length: lineCount }, (_, lineIndex): DemoOceanContainerLine => ({
      id: `${containerId}-line-${lineIndex + 1}`,
      oceanShippingMarkText: lineIndex === 0 ? 'L-010831-01~10' : `L-${String(10831 + index * 100 + lineIndex).padStart(6, '0')}`,
      goodsName: lineIndex === 1
        ? '大型工业焚烧炉（含自动送料装置、烟气处理设备及全套安装配件）'
        : ['挖掘机履带', '工业垃圾焚烧炉', '电动升降平台', '不锈钢搅拌机'][lineIndex % 4]!,
      shippingMark: `DEMO/202609${String(20 - index).padStart(2, '0')}/货件-${String(lineIndex + 1).padStart(2, '0')}`,
      salesOrderId: `${containerId}-sales-${lineIndex + 1}`,
      salesOrderNo: `SO/202609${String(20 - index).padStart(2, '0')}-${String(lineIndex + 1).padStart(5, '0')}`,
      purchaseOrderId: `${containerId}-purchase-${lineIndex + 1}`,
      purchaseOrderNo: `PO/202609${String(20 - index).padStart(2, '0')}-${String(lineIndex + 1).padStart(5, '0')}`,
      recipientName: ['林先生（演示）', '陳小姐（演示）', '王先生（演示）'][lineIndex % 3]!,
      codAmountTwd: lineIndex === 0 ? null : lineIndex === 1 ? '0.00' : '12800.00',
      recipientPhone: '0900-000-000（演示）',
      recipientAddress: lineIndex === 1
        ? '屏東縣竹田鄉鳳新路477之1號，物流園區第二棟後方卸貨區（演示地址）'
        : '高雄市鳳山區示範路100號（演示地址）',
      remark: lineIndex === 1
        ? '派送前請提前1至2天聯絡收件人，自備堆高機卸貨；到貨後需安排試機，請預留一小時等待時間。'
        : lineIndex % 2 === 0 ? '到貨前請先電話聯絡。' : null,
      grossWeightKg: lineIndex === 0 ? '180' : '1173',
      dimensionsCm: lineIndex === 0 ? '128 × 19 × 15' : '240 × 164 × 108',
      packageCount: lineIndex === 0 ? 10 : 1,
    }))]
  }),
)

export const oceanContainerDemoSummaries: readonly OceanContainerSummary[] = Array.from({ length: 12 }, (_, index) => {
  const id = `demo-container-${index + 1}`
  const datePart = `09${String(20 - index).padStart(2, '0')}`
  return {
    id,
    containerBatchNo: `CTN/2026-${String(120 - index).padStart(5, '0')}`,
    containerBatchName: index === 3 ? `${datePart}-01柜 · 大型设备与配套零件联合装柜（长名称演示）` : `${datePart}柜`,
    loadingDate: `2026-09-${String(20 - index).padStart(2, '0')}`,
    warehouseName: warehouseNames[index % warehouseNames.length]!,
    itemCount: index === 0 ? 37 : index === 2 ? 0 : 8,
    myItemCount: oceanContainerDemoLines[id]!.length,
    grossWeightKgTotal: index === 2 ? null : index === 0 ? '13280' : '4260',
    volumeCaiTotal: index === 2 ? null : index === 0 ? '1820.68' : '520.36',
  }
})
