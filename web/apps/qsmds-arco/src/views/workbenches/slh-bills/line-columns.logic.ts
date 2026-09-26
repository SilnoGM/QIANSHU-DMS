import type { SlhBillLineDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import {
  formatSlhBillAmount,
  formatSlhBillDimensions,
  formatSlhBillVolume,
  formatSlhBillWeight,
  groupSlhBillCharges,
  resolveSlhBillVolumeDifference,
} from './display.logic'

/** 列定义只依赖这个最小翻译签名，用例可以直接断言列取值。 */
export type SlhBillColumnTranslate = (key: string, params?: Record<string, unknown>) => string

export interface SlhBillLineColumnOptions {
  /** 当前页第一条记录的全局序号偏移，让序号列跨页连续。 */
  sequenceOffset?: number
}

/**
 * 账单明细列在导入预览与详情页共用：两处字段完全一致，预览页只在末尾追加自己的问题列。
 * 泛型参数让预览页能用 SlhBillPreviewLineDto 保持 own 类型，避免把 preview 专属字段丢掉。
 */
export function buildSlhBillLineColumns<TData extends SlhBillLineDto = SlhBillLineDto>(
  translate: SlhBillColumnTranslate,
  options: SlhBillLineColumnOptions = {},
): QsGenericTableColumn<TData>[] {
  const missing = translate('slhBill.valueMissing')
  const cai = translate('slhBill.unit.cai')
  const sequenceOffset = Math.max(0, options.sequenceOffset ?? 0)
  const text = (value: string | null | undefined) => value === undefined || value === null || value === '' ? missing : value
  const volume = (value: string | null | undefined) => {
    const formatted = formatSlhBillVolume(value)
    return formatted === null ? missing : `${formatted} ${cai}`
  }
  const amount = (value: string | null | undefined) => formatSlhBillAmount(value) ?? missing
  // 费用明细的纯文本形态同时承担移动端与复制的兜底展示，桌面端由费用明细组件渲染。
  const chargesText = (line: SlhBillLineDto) => groupSlhBillCharges(line.charges)
    .map(group => `${group.currencyCode} ${group.items.map(item => `${translate(`slhBill.chargeType.${item.chargeType}`)} ${amount(item.amount)}`).join(' ')}`)
    .join('；')
  return [
    // 序号是列表自己的计数（从 1 开始，跨页连续）；行号是原表里的第几行，两者含义不同。
    {
      id: 'sequence',
      title: '#',
      accessorFn: (_line, index) => sequenceOffset + index + 1,
      width: 64,
      minWidth: 64,
      maxWidth: 64,
      fixed: 'left',
      align: 'right',
      cellClass: 'qs-type-meta tabular-nums',
    },
    {
      id: 'lineNumber',
      title: translate('slhBill.line.lineNumber'),
      accessorFn: line => translate('slhBill.line.lineNumberValue', { line: line.lineNumber }),
      width: 110,
      minWidth: 110,
      maxWidth: 110,
      fixed: 'left',
      align: 'left',
      cellClass: 'qs-type-data tabular-nums',
    },
    { id: 'loadingDate', title: translate('slhBill.line.loadingDate'), accessorKey: 'loadingDate', width: 130, minWidth: 130, maxWidth: 130, cellClass: 'qs-type-data whitespace-nowrap' },
    { id: 'containerBatchName', title: translate('slhBill.line.containerBatchName'), accessorFn: line => text(line.containerBatchNameText), width: 145, minWidth: 145, maxWidth: 145, align: 'right', cellClass: 'qs-type-data' },
    {
      id: 'warehouseReceiptReference',
      title: translate('slhBill.line.warehouseReceiptReference'),
      accessorFn: line => text(line.warehouseReceiptReference),
      // 入仓单号常常是多段单号拼起来的：列宽给足，超长内容由页面插槽用浮层展示。
      width: 300,
      minWidth: 300,
      maxWidth: 300,
    },
    { id: 'shippingMark', title: translate('slhBill.line.shippingMark'), accessorFn: line => text(line.shippingMarkText), width: 200, minWidth: 200, maxWidth: 200 },
    { id: 'goodsName', title: translate('slhBill.line.goodsName'), accessorFn: line => text(line.goodsName), width: 180, minWidth: 180, maxWidth: 180 },
    { id: 'packageCount', title: translate('slhBill.line.packageCount'), accessorFn: line => `${line.packageCount} ${line.packageUnit ?? ''}`.trim(), width: 110, minWidth: 110, maxWidth: 110, align: 'right', cellClass: 'qs-type-data' },
    { id: 'weight', title: translate('slhBill.line.weight'), accessorFn: line => formatSlhBillWeight(line) ?? missing, width: 130, minWidth: 130, maxWidth: 130, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    {
      id: 'dimensions',
      title: translate('slhBill.line.dimensions'),
      accessorFn: (line) => {
        const dimensions = formatSlhBillDimensions(line)
        return dimensions === null ? missing : `${dimensions} ${translate('slhBill.unit.cm')}`
      },
      width: 200,
      minWidth: 200,
      maxWidth: 200,
      align: 'right',
      cellClass: 'qs-type-data whitespace-nowrap tabular-nums',
    },
    { id: 'volumeCai', title: translate('slhBill.line.volumeCai'), accessorFn: line => volume(line.volumeCai), width: 150, minWidth: 150, maxWidth: 150, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'reportedVolumeCai', title: translate('slhBill.line.reportedVolumeCai'), accessorFn: line => volume(line.reportedVolumeCai), width: 150, minWidth: 150, maxWidth: 150, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    {
      id: 'volumeDifferenceCai',
      title: translate('slhBill.line.volumeDifferenceCai'),
      // 差异 = 系统计算材积 − 账单自报材积；正数标红（账单写少了），负数标绿。
      // 着色与占位符由页面插槽负责，本文件保持无组件依赖以便被测。
      accessorFn: (line) => {
        const difference = resolveSlhBillVolumeDifference(line)
        return difference === null || difference.tone === 'even' ? '' : `${difference.text} ${cai}`
      },
      width: 150,
      minWidth: 150,
      maxWidth: 150,
      align: 'right',
    },
    // 类别只有一个数字，列宽按一个数字加留白收窄。
    { id: 'categoryCode', title: translate('slhBill.line.categoryCode'), accessorFn: line => text(line.categoryCode), width: 72, minWidth: 72, maxWidth: 72, align: 'center' },
    { id: 'unitPriceAmount', title: translate('slhBill.line.unitPriceAmount'), accessorFn: line => amount(line.unitPriceAmount), width: 130, minWidth: 130, maxWidth: 130, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    {
      id: 'pricingBasis',
      title: translate('slhBill.line.pricingBasis'),
      accessorFn: line => line.pricingBasis ? translate(`slhBill.pricingBasis.${line.pricingBasis}`) : missing,
      // 计价方式只有两个取值，收窄到约五个中文字宽，颜色标签由页面插槽渲染。
      width: 96,
      minWidth: 96,
      maxWidth: 96,
      align: 'center',
    },
    { id: 'freightAmountCny', title: translate('slhBill.line.freightAmountCny'), accessorFn: line => amount(line.freightAmountCny), width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'codHandlingAmountCny', title: translate('slhBill.line.codHandlingAmountCny'), accessorFn: line => amount(line.codHandlingAmountCny), width: 150, minWidth: 150, maxWidth: 150, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'surchargeAmountCny', title: translate('slhBill.line.surchargeAmountCny'), accessorFn: line => amount(line.surchargeAmountCny), width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'payableAmountCny', title: translate('slhBill.line.payableAmountCny'), accessorFn: line => amount(line.payableAmountCny), width: 175, minWidth: 175, maxWidth: 175, align: 'right', cellClass: 'qs-type-data-emphasis tabular-nums' },
    { id: 'codAmountTwd', title: translate('slhBill.line.codAmountTwd'), accessorFn: line => amount(line.codAmountTwd), width: 160, minWidth: 160, maxWidth: 160, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'ntdSurchargeAmountTwd', title: translate('slhBill.line.ntdSurchargeAmountTwd'), accessorFn: line => amount(line.ntdSurchargeAmountTwd), width: 140, minWidth: 140, maxWidth: 140, align: 'right', cellClass: 'qs-type-data tabular-nums' },
    { id: 'charges', title: translate('slhBill.line.charges'), accessorFn: line => chargesText(line), width: 320, minWidth: 260 },
    { id: 'recipientInfo', title: translate('slhBill.line.recipientInfo'), accessorFn: line => text(line.recipientInfoRaw), width: 320, minWidth: 260 },
    { id: 'remark', title: translate('slhBill.line.remark'), accessorFn: line => text(line.remark), width: 220, minWidth: 220, maxWidth: 220 },
  ]
}
