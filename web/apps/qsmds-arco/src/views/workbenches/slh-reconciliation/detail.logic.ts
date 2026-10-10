import type { SlhBillLineChargeDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import type {
  QsReconciliationLineSwitcherItem,
  QsReconciliationLineSwitcherTone,
} from '@/components/business/QsReconciliationLineSwitcher/types'
import type { QsStatusTagTone } from '@/utils/status-tag-tone'
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

/** 金额字段额外下发的原始值：模板据此改用 AmountDisplay，空值仍走占位符。 */
export interface SlhReconciliationAmountValue {
  readonly value: string | null
  readonly currency: string
}

export interface SlhReconciliationLineField {
  readonly id: string
  /** 已翻译的字段名。 */
  readonly label: string
  /** 文本形态：列表、复制与用例统一断言它；金额行由模板改用 amount 渲染。 */
  readonly value: string
  /** 金额行才有：原始金额与币种（由 AmountDisplay 负责符号、千分位与币种精度）。 */
  readonly amount?: SlhReconciliationAmountValue
  /** 状态行才有：一行里的多个彩色状态标签（文案与色调都由这里下发，模板只负责渲染）。 */
  readonly tags?: readonly SlhReconciliationStatusTag[]
  /** 人员行才有：交给 QsPersonDisplay 渲染的显示名；缺名时不下发，模板回落占位符文本。 */
  readonly person?: string
}

/** 订单侧单个维度的状态标签：维度名用于无障碍朗读，标签文案与色调由本模块查表给出。 */
export interface SlhReconciliationStatusTag {
  readonly dimension: string
  readonly label: string
  readonly tone: QsStatusTagTone
}

/** 面板内的分组：目前只有「销售与采购信息」需要（采购 / 销售）。 */
export interface SlhReconciliationFieldGroup {
  readonly id: string
  readonly label: string
  readonly fields: readonly SlhReconciliationLineField[]
}

/**
 * 三个面板共用的格式化口径，与账单明细列同源：
 * 金额 2 位小数、材积带「材」、尺寸 `215×137×113 CM`、重量带单位、费用明细按币种分组；
 * 空值与「本行不涉及」同义，一律占位符，不回显原始 null。
 */
function createFieldFormatters(translate: SlhReconciliationTranslate) {
  const missing = translate('slhBill.valueMissing')
  const cai = translate('slhBill.unit.cai')
  const text = (value: string | null | undefined) => (
    value === null || value === undefined || value.trim() === '' ? missing : value
  )
  return {
    missing,
    text,
    amount: (value: string | null | undefined) => formatSlhBillAmount(value) ?? missing,
    /** 金额行下发给模板的原始值；缺失（本行不涉及）时返回 undefined，让模板回落到占位符文本。 */
    amountValue: (value: string | null | undefined, currency: string): SlhReconciliationAmountValue | undefined => (
      value === null || value === undefined || value.trim() === '' ? undefined : { value, currency }
    ),
    volume: (value: string | null | undefined) => {
      const formatted = formatSlhBillVolume(value)
      return formatted === null ? missing : `${formatted} ${cai}`
    },
    /** 人员行：有名字时下发 person 让模板改用 QsPersonDisplay，缺名字仍走占位符。 */
    person: (name: string | null | undefined): { readonly value: string, readonly person?: string } => {
      const displayName = text(name)
      return displayName === missing ? { value: displayName } : { value: displayName, person: displayName }
    },
    /** 收费材积在装柜行是整数材数，与其它材积字段一样带单位展示。 */
    chargeableVolume: (value: number | null | undefined) => (
      value === null || value === undefined ? missing : `${value} ${cai}`
    ),
    dimensions: (line: Pick<SlhReconciliationBatchMemberDto, 'lengthCm' | 'widthCm' | 'heightCm'>) => {
      const dimensions = formatSlhBillDimensions(line)
      return dimensions === null ? missing : `${dimensions} ${translate('slhBill.unit.cm')}`
    },
    weight: (line: Pick<SlhReconciliationBatchMemberDto, 'grossWeightKg' | 'weightUnit'>) => (
      formatSlhBillWeight(line) ?? missing
    ),
    charges: (charges: readonly SlhBillLineChargeDto[]) => {
      const text = groupSlhBillCharges(charges)
        .map(group => `${group.currencyCode} ${group.items
          .map(item => `${translate(`slhBill.chargeType.${item.chargeType}`)} ${formatSlhBillAmount(item.amount) ?? missing}`)
          .join(' ')}`)
        .join('；')
      return text === '' ? missing : text
    },
  }
}

/**
 * 账单明细行信息：账单行自身字段，按「对账要看的顺序」分段。
 * 代收货款台币是对账焦点之一，提到段首；金额类单列一段，收货与备注收尾。
 * 对账状态与核对留痕按产品要求不在此展示，匹配依据属于柜次侧（放在装柜明细行面板）。
 */
export function buildSlhReconciliationBillLineFieldGroups(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationFieldGroup[] {
  const { missing, text, amount, amountValue, volume, dimensions, weight, charges } = createFieldFormatters(translate)
  const difference = resolveSlhBillVolumeDifference(member)
  return [
    {
      id: 'billLine',
      label: translate('slhReconciliation.detail.groupBillLine'),
      fields: [
        {
          id: 'lineNumber',
          label: translate('slhBill.line.lineNumber'),
          // 与账单明细列一致：行号指的是原表行号，不是批次内的顺序。
          value: translate('slhBill.line.lineNumberValue', { line: member.sourceRowNumber }),
        },
        { id: 'loadingDate', label: translate('slhBill.line.loadingDate'), value: text(member.loadingDate) },
        { id: 'containerBatchName', label: translate('slhBill.line.containerBatchName'), value: text(member.containerBatchNameText) },
        // 对账焦点：与顶部核对焦点区的「账单代收货款」同源。
        { id: 'codAmountTwd', label: translate('slhReconciliation.detail.billCodAmount'), value: amount(member.codAmountTwd), amount: amountValue(member.codAmountTwd, 'TWD') },
        { id: 'warehouseReceiptReference', label: translate('slhBill.line.warehouseReceiptReference'), value: text(member.warehouseReceiptReference) },
        { id: 'shippingMark', label: translate('slhBill.line.shippingMark'), value: text(member.shippingMarkText) },
        { id: 'goodsName', label: translate('slhBill.line.goodsName'), value: text(member.goodsName) },
        { id: 'packageCount', label: translate('slhBill.line.packageCount'), value: `${member.packageCount} ${member.packageUnit ?? ''}`.trim() },
        { id: 'weight', label: translate('slhBill.line.weight'), value: weight(member) },
        { id: 'dimensions', label: translate('slhBill.line.dimensions'), value: dimensions(member) },
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
      ],
    },
    {
      id: 'amounts',
      label: translate('slhReconciliation.detail.groupAmounts'),
      fields: [
        { id: 'freightAmountCny', label: translate('slhBill.line.freightAmountCny'), value: amount(member.freightAmountCny), amount: amountValue(member.freightAmountCny, 'CNY') },
        { id: 'codHandlingAmountCny', label: translate('slhBill.line.codHandlingAmountCny'), value: amount(member.codHandlingAmountCny), amount: amountValue(member.codHandlingAmountCny, 'CNY') },
        { id: 'surchargeAmountCny', label: translate('slhBill.line.surchargeAmountCny'), value: amount(member.surchargeAmountCny), amount: amountValue(member.surchargeAmountCny, 'CNY') },
        { id: 'payableAmountCny', label: translate('slhBill.line.payableAmountCny'), value: amount(member.payableAmountCny), amount: amountValue(member.payableAmountCny, 'CNY') },
        { id: 'ntdSurchargeAmountTwd', label: translate('slhBill.line.ntdSurchargeAmountTwd'), value: amount(member.ntdSurchargeAmountTwd), amount: amountValue(member.ntdSurchargeAmountTwd, 'TWD') },
      ],
    },
    {
      id: 'recipient',
      label: translate('slhReconciliation.detail.groupRecipient'),
      fields: [
        { id: 'recipientInfo', label: translate('slhBill.line.recipientInfo'), value: text(member.recipientInfoRaw) },
        { id: 'remark', label: translate('slhBill.line.remark'), value: text(member.remark) },
        { id: 'charges', label: translate('slhBill.line.charges'), value: charges(member.charges) },
      ],
    },
  ]
}

/**
 * 装柜明细行信息：先给本批次的匹配依据（怎么找到这一行的），再给装柜行自己的可比字段。
 * 代收货款台币是对账焦点之一，放在装柜行资料段首；字段名沿用账单侧的叫法，
 * 让同一页里两侧的同一概念用同一个词，只有与账单侧重名的那一项加「装柜」前缀区分。
 */
export function buildSlhReconciliationLoadingItemFieldGroups(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationFieldGroup[] {
  const { text, amount, amountValue, volume, chargeableVolume, dimensions, weight } = createFieldFormatters(translate)
  const item = member.matchedLoadingItem
  return [
    {
      id: 'matchEvidence',
      label: translate('slhReconciliation.detail.groupMatchEvidence'),
      fields: [
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
        { id: 'shipmentNo', label: translate('slhReconciliation.detail.shipmentNo'), value: text(item.shipmentNo) },
      ],
    },
    {
      id: 'loadingItem',
      label: translate('slhReconciliation.detail.groupLoadingItem'),
      fields: [
        // 对账焦点：与顶部核对焦点区的「装柜代收货款」同源。
        { id: 'codAmountTwd', label: translate('slhReconciliation.detail.loadingCodAmount'), value: amount(item.codAmountTwd), amount: amountValue(item.codAmountTwd, 'TWD') },
        { id: 'warehouseReceiptReference', label: translate('slhBill.line.warehouseReceiptReference'), value: text(item.warehouseReceiptReference) },
        { id: 'shippingMark', label: translate('slhBill.line.shippingMark'), value: text(item.oceanShippingMarkText) },
        { id: 'goodsName', label: translate('slhBill.line.goodsName'), value: text(item.goodsName) },
        { id: 'packageCount', label: translate('slhBill.line.packageCount'), value: `${item.packageCount} ${item.packageUnit ?? ''}`.trim() },
        { id: 'weight', label: translate('slhBill.line.weight'), value: weight(item) },
        { id: 'dimensions', label: translate('slhBill.line.dimensions'), value: dimensions(item) },
        { id: 'volumeCai', label: translate('slhBill.line.volumeCai'), value: volume(item.volumeCai) },
        { id: 'chargeableVolumeCai', label: translate('slhReconciliation.detail.chargeableVolume'), value: chargeableVolume(item.chargeableVolumeCai) },
        { id: 'reportedVolumeCai', label: translate('slhBill.line.reportedVolumeCai'), value: volume(item.reportedVolumeCai) },
        { id: 'recipientName', label: translate('slhReconciliation.detail.recipientName'), value: text(item.recipientName) },
        { id: 'recipientPhone', label: translate('slhReconciliation.detail.recipientPhone'), value: text(item.recipientPhone) },
        { id: 'recipientAddress', label: translate('slhReconciliation.detail.recipientAddress'), value: text(item.recipientAddress) },
        { id: 'remark', label: translate('slhBill.line.remark'), value: text(item.remark) },
      ],
    },
  ]
}

/** 采购订单三维状态色调：与 purchase-order-desc.logic 的既有口径一致（取消红、待审黄、其余绿）。 */
const PURCHASE_STATUS_TONES = {
  order: { PENDING_REVIEW: 'warning', CONFIRMED: 'success', COMPLETED: 'success', CANCELLED: 'danger' },
  fulfillment: { ORDERED: 'info', PREPARING: 'warning', PARTIALLY_SHIPPED: 'warning', SHIPPED: 'info', SIGNED: 'success' },
  payment: { UNPAID: 'danger', PARTIALLY_PAID: 'warning', PAID: 'success' },
} as const satisfies Record<string, Readonly<Record<string, QsStatusTagTone>>>

/** 销售订单三维状态色调：项目里没有既有映射，按同一套语义给出（草稿中性、待对账黄、完成绿、取消红）。 */
const SALES_STATUS_TONES = {
  order: { DRAFT: 'neutral', CONFIRMED: 'success', PENDING_RECONCILIATION: 'warning', COMPLETED: 'success', CANCELLED: 'danger' },
  fulfillment: { PENDING: 'info', PREPARING: 'warning', LAND_TRANSIT: 'info', WAREHOUSE_ARRIVED: 'info', SEA_TRANSIT: 'info', SIGNED: 'success' },
  payment: { UNPAID: 'danger', PARTIALLY_PAID: 'warning', PAID: 'success' },
} as const satisfies Record<string, Readonly<Record<string, QsStatusTagTone>>>

/**
 * 销售与采购信息：装柜行匹配到的货件 → 采购订单 → 销售订单，与匹配合格判定同一条链路。
 *
 * 销售组排在采购组之前。采购保留单号、供应商、金额三项（采购金额/定金/尾款）、状态一行与采购唛头；
 * 销售保留单号、金额五项（销售金额/定金/尾款/实际已收款/实际待收款）、客户三项（姓名/电话/地址）、
 * 状态一行与出单人。金额按各自币种标注并统一两位小数展示（销售侧源数据是四位小数），
 * 枚举取值与字段名沿用采购/销售页面那套键，保证同一事实在两个页面上的措辞一致。
 * 来源缺失（历史或损坏数据）时整组走占位符，不猜也不留空。
 */
export function buildSlhReconciliationOrderFieldGroups(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationFieldGroup[] {
  const { missing, text, amount, amountValue, person } = createFieldFormatters(translate)
  // 契约上两个来源都是可选且可空：先归一成 null，后面只判一种缺失形态。
  const purchase = member.purchaseOrder ?? null
  const sales = member.salesOrder ?? null
  const money = (currency: string, value: string | undefined) => (
    value === undefined ? missing : `${currency} ${amount(value)}`
  )
  const tag = (
    dimensionKey: string,
    statusGroup: 'purchaseOrderDrawer' | 'salesOrderDrawer',
    tones: Readonly<Record<string, QsStatusTagTone>>,
    value: string | undefined,
  ): SlhReconciliationStatusTag | null => (
    value === undefined
      ? null
      : {
          dimension: translate(dimensionKey),
          label: translate(`${statusGroup}.statuses.${value}`),
          tone: tones[value] ?? 'neutral',
        }
  )
  /** 三维状态合并成一行：模板按 tags 渲染彩色标签，纯文本形态供用例与无障碍兜底。 */
  const stateField = (
    id: string,
    labelKey: string,
    tags: readonly (SlhReconciliationStatusTag | null)[],
  ): SlhReconciliationLineField => {
    const resolved = tags.filter((item): item is SlhReconciliationStatusTag => item !== null)
    return {
      id,
      label: translate(labelKey),
      value: resolved.length === 0 ? missing : resolved.map(item => item.label).join(' / '),
      tags: resolved,
    }
  }
  return [
    {
      id: 'sales',
      label: translate('slhReconciliation.detail.salesGroup'),
      // 销售信息排在采购之前；尾款是与装柜/账单代收货款并列核对的值，故紧跟单号。
      fields: [
        { id: 'salesOrderNo', label: translate('slhReconciliation.detail.salesOrderNo'), value: text(sales?.orderNo) },
        { id: 'balanceDueAmount', label: translate('slhReconciliation.detail.salesBalance'), value: money(sales?.currencyCode ?? '', sales?.balanceDueAmount), amount: amountValue(sales?.balanceDueAmount, sales?.currencyCode ?? '') },
        { id: 'receivedAmount', label: translate('slhReconciliation.detail.receivedAmount'), value: money(sales?.currencyCode ?? '', sales?.receivedAmount), amount: amountValue(sales?.receivedAmount, sales?.currencyCode ?? '') },
        { id: 'outstandingAmount', label: translate('slhReconciliation.detail.outstandingAmount'), value: money(sales?.currencyCode ?? '', sales?.outstandingAmount), amount: amountValue(sales?.outstandingAmount, sales?.currencyCode ?? '') },
        { id: 'salesTotalAmount', label: translate('slhReconciliation.detail.salesTotalAmount'), value: money(sales?.currencyCode ?? '', sales?.agreedTotalAmount), amount: amountValue(sales?.agreedTotalAmount, sales?.currencyCode ?? '') },
        { id: 'depositDueAmount', label: translate('slhReconciliation.detail.salesDeposit'), value: money(sales?.currencyCode ?? '', sales?.depositDueAmount), amount: amountValue(sales?.depositDueAmount, sales?.currencyCode ?? '') },
        { id: 'customer', label: translate('salesOrderDesc.fields.customerName'), value: text(sales?.customerName) },
        { id: 'customerPhone', label: translate('salesOrderDesc.fields.customerPhone'), value: text(sales?.customerPhone) },
        { id: 'customerFullAddress', label: translate('salesOrderDesc.fields.fullAddress'), value: text(sales?.customerFullAddress) },
        stateField('salesState', 'slhReconciliation.detail.salesOrderState', [
          tag('slhReconciliation.detail.salesOrderStatus', 'salesOrderDrawer', SALES_STATUS_TONES.order, sales?.orderStatus),
          tag('slhReconciliation.detail.fulfillmentStatus', 'salesOrderDrawer', SALES_STATUS_TONES.fulfillment, sales?.fulfillmentStatus),
          tag('slhReconciliation.detail.paymentStatus', 'salesOrderDrawer', SALES_STATUS_TONES.payment, sales?.paymentStatus),
        ]),
        // 出单人是人员信息：交给 QsPersonDisplay（头像位 + 名称截断），文案仍取销售域键。
        { id: 'issuer', label: translate('salesOrderDesc.fields.issuer'), ...person(sales?.issuerDisplayName) },
      ],
    },
    {
      id: 'purchase',
      label: translate('slhReconciliation.detail.purchaseGroup'),
      fields: [
        { id: 'purchaseOrderNo', label: translate('slhReconciliation.detail.purchaseOrderNo'), value: text(purchase?.orderNo) },
        { id: 'supplier', label: translate('slhReconciliation.detail.supplier'), value: text(purchase?.supplier.label) },
        { id: 'purchaseTotalAmount', label: translate('slhReconciliation.detail.purchaseTotalAmount'), value: money('CNY', purchase?.purchaseTotalAmount), amount: amountValue(purchase?.purchaseTotalAmount, 'CNY') },
        { id: 'depositDueAmount', label: translate('slhReconciliation.detail.purchaseDeposit'), value: money('CNY', purchase?.depositDueAmount), amount: amountValue(purchase?.depositDueAmount, 'CNY') },
        // 采购侧也有「尾款」，与销售的尾款同名不同币种：加来源前缀消歧（对账要核的是销售尾款）。
        { id: 'balanceDueAmount', label: translate('slhReconciliation.detail.purchaseBalance'), value: money('CNY', purchase?.balanceDueAmount), amount: amountValue(purchase?.balanceDueAmount, 'CNY') },
        // 实际已付款/未付款与采购列表「实际付款」列同口径（未作废付款累加、未付＝采购金额 − 已付）。
        { id: 'paidAmount', label: translate('slhReconciliation.detail.purchasePaidAmount'), value: money('CNY', purchase?.paidAmount), amount: amountValue(purchase?.paidAmount, 'CNY') },
        { id: 'outstandingAmount', label: translate('slhReconciliation.detail.purchaseOutstandingAmount'), value: money('CNY', purchase?.outstandingAmount), amount: amountValue(purchase?.outstandingAmount, 'CNY') },
        stateField('purchaseState', 'slhReconciliation.detail.purchaseOrderState', [
          tag('slhReconciliation.detail.purchaseOrderStatus', 'purchaseOrderDrawer', PURCHASE_STATUS_TONES.order, purchase?.orderStatus),
          tag('slhReconciliation.detail.fulfillmentStatus', 'purchaseOrderDrawer', PURCHASE_STATUS_TONES.fulfillment, purchase?.fulfillmentStatus),
          tag('slhReconciliation.detail.paymentStatus', 'purchaseOrderDrawer', PURCHASE_STATUS_TONES.payment, purchase?.paymentStatus),
        ]),
        { id: 'shippingMark', label: translate('purchaseOrderDesc.fields.shippingMark'), value: text(purchase?.shippingMarkText) },
        // 采购人＝采购订单的创建人，与销售侧出单人一样交给 QsPersonDisplay。
        { id: 'purchaseCreator', label: translate('slhReconciliation.detail.purchaseCreator'), ...person(purchase?.creatorDisplayName) },
      ],
    },
  ]
}

export interface SlhReconciliationFocusValue {
  readonly id: string
  /** 来源标签：写明这是哪一侧的哪个字段（同名字段借此区分）。 */
  readonly sourceLabel: string
  /** 原始金额字符串；为空（本行不涉及）时模板走占位符分支，绝不出现 0.00 之外的替代值。 */
  readonly value: string | null
  readonly currency: string
  /** 身份色：三张卡各自的渐变基色，纯装饰、不承载任何判定语义。 */
  readonly accent: 'emerald' | 'amber' | 'blue'
  /** 身份图案：与来源同域的装饰性图标（购物车 / 船 / 纸币），仅作视觉标记。 */
  readonly motif: string
  readonly isEmpty: boolean
}

/**
 * 核对焦点：把三个跨域的金额并排放在一处供人工比对。
 *
 * 只做并列展示——不给一致/不一致结论、不给差异值、不做币种换算；
 * 币种跟随各自的来源（销售尾款是订单币种，两个代收恒为台币），标在来源标签里，
 * 空值（本行不涉及）与 0 必须在视觉上可区分，因此空值只下发占位符与说明文案。
 */
export function buildSlhReconciliationFocusValues(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationFocusValue[] {
  const sales = member.salesOrder ?? null
  const item = member.matchedLoadingItem
  const salesBalance = sales?.balanceDueAmount ?? null
  const loadingCod = item.codAmountTwd ?? null
  const billCod = member.codAmountTwd ?? null
  const sourceLabel = (key: string, currency: string) => (
    currency === ''
      ? translate(key)
      : translate('slhReconciliation.detail.focusSourceWithCurrency', { source: translate(key), currency })
  )
  return [
    {
      id: 'salesBalance',
      sourceLabel: sourceLabel('slhReconciliation.detail.focusSalesBalance', sales?.currencyCode ?? ''),
      value: salesBalance,
      currency: sales?.currencyCode ?? '',
      accent: 'emerald',
      motif: 'i-lucide:shopping-cart',
      isEmpty: salesBalance === null,
    },
    {
      id: 'loadingCod',
      sourceLabel: sourceLabel('slhReconciliation.detail.focusLoadingCod', 'TWD'),
      value: loadingCod,
      currency: 'TWD',
      accent: 'amber',
      motif: 'i-lucide:ship',
      isEmpty: loadingCod === null,
    },
    {
      id: 'billCod',
      sourceLabel: sourceLabel('slhReconciliation.detail.focusBillCod', 'TWD'),
      value: billCod,
      currency: 'TWD',
      accent: 'blue',
      motif: 'i-lucide:banknote',
      isEmpty: billCod === null,
    },
  ]
}
