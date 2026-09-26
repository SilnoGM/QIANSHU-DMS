import type { SlhBillLineDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { formatSlhBillDimensions, formatSlhBillVolume, formatSlhBillWeight, groupSlhBillCharges } from './display.logic'

/**
 * 账单明细列在导入预览与详情页共用：两处字段完全一致，预览页只在末尾追加自己的问题列。
 * 泛型参数让预览页能用 SlhBillPreviewLineDto 保持 own 类型，避免把 preview 专属字段丢掉。
 */
export function buildSlhBillLineColumns<TData extends SlhBillLineDto = SlhBillLineDto>(
  translate: (key: string) => string,
): QsGenericTableColumn<TData>[] {
  const unknown = translate('slhBill.unknown')
  const text = (value: string | null | undefined) => value === undefined || value === null || value === '' ? unknown : value
  const volume = (value: string | null | undefined) => formatSlhBillVolume(value) ?? unknown
  // 费用明细的纯文本形态同时承担移动端与复制的兜底展示，桌面端由费用明细组件渲染。
  const chargesText = (line: SlhBillLineDto) => groupSlhBillCharges(line.charges)
    .map(group => `${group.currencyCode} ${group.items.map(item => `${translate(`slhBill.chargeType.${item.chargeType}`)} ${item.amount}`).join(' ')}`)
    .join('；')
  return [
    { id: 'lineNumber', title: translate('slhBill.line.lineNumber'), accessorKey: 'lineNumber', width: 80, minWidth: 80, maxWidth: 80, fixed: 'left', align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'loadingDate', title: translate('slhBill.line.loadingDate'), accessorKey: 'loadingDate', width: 130, minWidth: 130, maxWidth: 130, cellClass: 'qs-type-data whitespace-nowrap' },
    { id: 'containerBatchName', title: translate('slhBill.line.containerBatchName'), accessorFn: line => text(line.containerBatchNameText), width: 145, minWidth: 145, maxWidth: 145, cellClass: 'qs-type-data' },
    { id: 'warehouseReceiptReference', title: translate('slhBill.line.warehouseReceiptReference'), accessorFn: line => text(line.warehouseReceiptReference), width: 220, minWidth: 220, maxWidth: 220 },
    { id: 'shippingMark', title: translate('slhBill.line.shippingMark'), accessorFn: line => text(line.shippingMarkText), width: 200, minWidth: 200, maxWidth: 200 },
    { id: 'goodsName', title: translate('slhBill.line.goodsName'), accessorFn: line => text(line.goodsName), width: 180, minWidth: 180, maxWidth: 180 },
    { id: 'packageCount', title: translate('slhBill.line.packageCount'), accessorFn: line => `${line.packageCount} ${line.packageUnit ?? ''}`.trim(), width: 110, minWidth: 110, maxWidth: 110, align: 'right', cellClass: 'qs-type-data' },
    { id: 'weight', title: translate('slhBill.line.weight'), accessorFn: line => formatSlhBillWeight(line) ?? unknown, width: 130, minWidth: 130, maxWidth: 130, align: 'right', cellClass: 'qs-type-data' },
    { id: 'dimensions', title: translate('slhBill.line.dimensions'), accessorFn: line => formatSlhBillDimensions(line) ?? unknown, width: 190, minWidth: 190, maxWidth: 190, cellClass: 'qs-type-data whitespace-nowrap' },
    { id: 'volumeCai', title: translate('slhBill.line.volumeCai'), accessorFn: line => volume(line.volumeCai), width: 130, minWidth: 130, maxWidth: 130, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'reportedVolumeCai', title: translate('slhBill.line.reportedVolumeCai'), accessorFn: line => volume(line.reportedVolumeCai), width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'volumeDifferenceCai', title: translate('slhBill.line.volumeDifferenceCai'), accessorFn: line => volume(line.volumeDifferenceCai), width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'categoryCode', title: translate('slhBill.line.categoryCode'), accessorFn: line => text(line.categoryCode), width: 130, minWidth: 130, maxWidth: 130 },
    { id: 'unitPriceAmount', title: translate('slhBill.line.unitPriceAmount'), accessorFn: line => text(line.unitPriceAmount), width: 130, minWidth: 130, maxWidth: 130, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'pricingBasis', title: translate('slhBill.line.pricingBasis'), accessorFn: line => line.pricingBasis ? translate(`slhBill.pricingBasis.${line.pricingBasis}`) : unknown, width: 130, minWidth: 130, maxWidth: 130 },
    { id: 'freightAmountCny', title: translate('slhBill.line.freightAmountCny'), accessorFn: line => line.freightAmountCny, width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'codHandlingAmountCny', title: translate('slhBill.line.codHandlingAmountCny'), accessorFn: line => line.codHandlingAmountCny, width: 150, minWidth: 150, maxWidth: 150, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'surchargeAmountCny', title: translate('slhBill.line.surchargeAmountCny'), accessorFn: line => line.surchargeAmountCny, width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'payableAmountCny', title: translate('slhBill.line.payableAmountCny'), accessorFn: line => line.payableAmountCny, width: 175, minWidth: 175, maxWidth: 175, align: 'right', cellClass: 'qs-type-data-emphasis tabular-nums' },
    { id: 'codAmountTwd', title: translate('slhBill.line.codAmountTwd'), accessorFn: line => line.codAmountTwd, width: 160, minWidth: 160, maxWidth: 160, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'ntdSurchargeAmountTwd', title: translate('slhBill.line.ntdSurchargeAmountTwd'), accessorFn: line => line.ntdSurchargeAmountTwd, width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'charges', title: translate('slhBill.line.charges'), accessorFn: line => chargesText(line), width: 320, minWidth: 260 },
    { id: 'recipientInfo', title: translate('slhBill.line.recipientInfo'), accessorFn: line => text(line.recipientInfoRaw), width: 320, minWidth: 260 },
    { id: 'remark', title: translate('slhBill.line.remark'), accessorFn: line => text(line.remark), width: 220, minWidth: 220, maxWidth: 220 },
  ]
}
