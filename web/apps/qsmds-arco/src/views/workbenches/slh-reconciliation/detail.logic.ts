import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import type {
  QsReconciliationLineSwitcherItem,
  QsReconciliationLineSwitcherTone,
} from '@/components/business/QsReconciliationLineSwitcher/types'
import {
  formatSlhBillAmount,
  formatSlhBillDimensions,
  formatSlhBillVolume,
  formatSlhBillWeight,
  groupSlhBillCharges,
  resolveSlhBillVolumeDifference,
} from '../slh-bills/display.logic'

/** 文案键是动态拼的，类型检查管不到；用例按同一签名断言键与参数拼接规则。 */
export type SlhReconciliationTranslate = (key: string, params?: Record<string, unknown>) => string

/**
 * 明细行两态 → 切换器语义色。与 reconciliation-status.logic 的红/绿口径一致：
 * 未对账红、已对账绿，未登记状态由切换器回落中性灰。
 */
export const SLH_RECONCILIATION_LINE_TONES: Readonly<Record<string, QsReconciliationLineSwitcherTone>> = {
  PENDING: 'danger',
  RECONCILED: 'success',
}

/**
 * 冻结成员 → 切换器项。`value` 用明细行 id（创建范围比对与核对动作都以它为准），
 * `label` 用唛头，缺唛头时与账单明细列同一口径显示占位符。
 */
export function buildSlhReconciliationLineItems(
  members: readonly SlhReconciliationBatchMemberDto[],
  translate: SlhReconciliationTranslate,
): readonly QsReconciliationLineSwitcherItem[] {
  const missing = translate('slhBill.valueMissing')
  return members.map(member => ({
    value: member.lineId,
    label: member.shippingMarkText === null
      || member.shippingMarkText === undefined
      || member.shippingMarkText.trim() === ''
      ? missing
      : member.shippingMarkText,
    status: member.reconciliationStatus,
    statusLabel: translate(`slhBill.reconciliationStatus.${member.reconciliationStatus}`),
  }))
}

/** 选中值由页面持有；成员被替换或清空时解析为 null，由页面负责校正模型值。 */
export function resolveSlhReconciliationSelectedMember(
  members: readonly SlhReconciliationBatchMemberDto[],
  selectedLineId: string | null,
): SlhReconciliationBatchMemberDto | null {
  if (selectedLineId === null) {
    return null
  }
  return members.find(member => member.lineId === selectedLineId) ?? null
}

export interface SlhReconciliationLineField {
  readonly id: string
  /** 已翻译的字段名。 */
  readonly label: string
  /** 已格式化的字段值；缺值统一为占位符。 */
  readonly value: string
}

/**
 * 当前明细行的字段清单（先给纯字段，对照工作台后续再做）。
 *
 * 格式化与账单明细列同源：金额 2 位小数、材积带「材」、尺寸 `215×137×113 CM`、重量带单位、
 * 费用明细按币种分组。空值与「本行不涉及」同义，一律占位符，不回显原始 null。
 */
export function buildSlhReconciliationLineFields(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationLineField[] {
  const missing = translate('slhBill.valueMissing')
  const text = (value: string | null | undefined) => (
    value === null || value === undefined || value.trim() === '' ? missing : value
  )
  const amount = (value: string | null | undefined) => formatSlhBillAmount(value) ?? missing
  const volume = (value: string | null | undefined) => {
    const formatted = formatSlhBillVolume(value)
    return formatted === null ? missing : `${formatted} ${translate('slhBill.unit.cai')}`
  }
  const dimensions = formatSlhBillDimensions(member)
  const weight = formatSlhBillWeight(member)
  const difference = resolveSlhBillVolumeDifference(member)
  const charges = groupSlhBillCharges(member.charges)
    .map(group => `${group.currencyCode} ${group.items
      .map(item => `${translate(`slhBill.chargeType.${item.chargeType}`)} ${amount(item.amount)}`)
      .join(' ')}`)
    .join('；')

  return [
    {
      id: 'lineNumber',
      label: translate('slhBill.line.lineNumber'),
      // 与账单明细列一致：行号指的是原表行号，不是批次内的顺序。
      value: translate('slhBill.line.lineNumberValue', { line: member.sourceRowNumber }),
    },
    { id: 'loadingDate', label: translate('slhBill.line.loadingDate'), value: text(member.loadingDate) },
    { id: 'containerBatchName', label: translate('slhBill.line.containerBatchName'), value: text(member.containerBatchNameText) },
    { id: 'warehouseReceiptReference', label: translate('slhBill.line.warehouseReceiptReference'), value: text(member.warehouseReceiptReference) },
    { id: 'shippingMark', label: translate('slhBill.line.shippingMark'), value: text(member.shippingMarkText) },
    { id: 'goodsName', label: translate('slhBill.line.goodsName'), value: text(member.goodsName) },
    { id: 'packageCount', label: translate('slhBill.line.packageCount'), value: `${member.packageCount} ${member.packageUnit ?? ''}`.trim() },
    { id: 'weight', label: translate('slhBill.line.weight'), value: weight ?? missing },
    {
      id: 'dimensions',
      label: translate('slhBill.line.dimensions'),
      value: dimensions === null ? missing : `${dimensions} ${translate('slhBill.unit.cm')}`,
    },
    { id: 'volumeCai', label: translate('slhBill.line.volumeCai'), value: volume(member.volumeCai) },
    { id: 'reportedVolumeCai', label: translate('slhBill.line.reportedVolumeCai'), value: volume(member.reportedVolumeCai) },
    {
      id: 'volumeDifferenceCai',
      label: translate('slhBill.line.volumeDifferenceCai'),
      value: difference === null || difference.text === '' ? missing : difference.text,
    },
    { id: 'categoryCode', label: translate('slhBill.line.categoryCode'), value: text(member.categoryCode) },
    { id: 'unitPriceAmount', label: translate('slhBill.line.unitPriceAmount'), value: text(member.unitPriceAmount) },
    {
      id: 'pricingBasis',
      label: translate('slhBill.line.pricingBasis'),
      // 契约标的是可选，服务端实际会对缺失回 null：真值判断与账单明细列同一写法。
      value: member.pricingBasis ? translate(`slhBill.pricingBasis.${member.pricingBasis}`) : missing,
    },
    { id: 'freightAmountCny', label: translate('slhBill.line.freightAmountCny'), value: amount(member.freightAmountCny) },
    { id: 'codHandlingAmountCny', label: translate('slhBill.line.codHandlingAmountCny'), value: amount(member.codHandlingAmountCny) },
    { id: 'surchargeAmountCny', label: translate('slhBill.line.surchargeAmountCny'), value: amount(member.surchargeAmountCny) },
    { id: 'payableAmountCny', label: translate('slhBill.line.payableAmountCny'), value: amount(member.payableAmountCny) },
    { id: 'codAmountTwd', label: translate('slhBill.line.codAmountTwd'), value: amount(member.codAmountTwd) },
    { id: 'ntdSurchargeAmountTwd', label: translate('slhBill.line.ntdSurchargeAmountTwd'), value: amount(member.ntdSurchargeAmountTwd) },
    { id: 'recipientInfo', label: translate('slhBill.line.recipientInfo'), value: text(member.recipientInfoRaw) },
    { id: 'remark', label: translate('slhBill.line.remark'), value: text(member.remark) },
    {
      id: 'reconciliationStatus',
      label: translate('slhBill.line.reconciliationStatus'),
      value: translate(`slhBill.reconciliationStatus.${member.reconciliationStatus}`),
    },
    { id: 'charges', label: translate('slhBill.line.charges'), value: charges === '' ? missing : charges },
    {
      id: 'matchSource',
      label: translate('slhReconciliation.detail.matchSource'),
      value: translate(`slhReconciliation.detail.matchSourceValue.${member.matchSource}`),
    },
    {
      id: 'matchedContainer',
      label: translate('slhReconciliation.detail.matchedContainer'),
      value: `${member.matchedContainerBatchName} #${member.matchedLoadingItemLineNumber}`,
    },
    { id: 'reconciledAt', label: translate('slhReconciliation.detail.reconciledAt'), value: text(member.reconciledAt) },
    { id: 'reconciledBy', label: translate('slhReconciliation.detail.reconciledBy'), value: text(member.reconciledByDisplayName) },
  ]
}
