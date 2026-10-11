import type { SlhBillVolumeDifference } from '../slh-bills/display.logic'
import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
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
  /** 人员行才有：交给 QsPersonDisplay 渲染的显示名；缺名时不下发，模板回落占位符文本。 */
  readonly person?: string
  /** 金额块里才有的位置标记：总额行（大号加粗）与余额行（非零时染红），其余金额行不下发。 */
  readonly emphasis?: 'total' | 'balance'
  /** 长文本字段才有：单行截断，超长时悬停给完整值（模板按需挂浮层）。 */
  readonly truncate?: true
  /** 多行值的字段（收货信息）：值按行拆开展示，`value` 仍是拼好的兜底文本。 */
  readonly lines?: readonly string[]
  /** 备注这类整段强调的短文本：值以浅色标签呈现。 */
  readonly chip?: true
}

/** 订单侧单个维度的状态标签：维度名用于无障碍朗读，标签文案与色调由本模块查表给出。 */
export interface SlhReconciliationStatusTag {
  readonly dimension: string
  readonly label: string
  readonly tone: QsStatusTagTone
}

/** 账单面板顶部的身份标签：文案自洽（如「第 31 行」），色调只决定浅色底。 */
export interface SlhReconciliationIdentityTag {
  readonly text: string
  readonly tone: QsStatusTagTone
}

/** 账单面板费用块里的一行：emphasis 决定字号与颜色，tag 是该行的费别标签（如「重货费」）。 */
export interface SlhReconciliationBillAmountRow {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly amount?: SlhReconciliationAmountValue
  /** total＝总额（大号加粗）；cod＝代收货款（大号加粗、蓝色，与核对焦点同源同色）；warning＝台币杂费。 */
  readonly emphasis?: 'cod' | 'total' | 'warning'
  readonly tag?: SlhReconciliationIdentityTag
}

/** 账单面板的一段：字段段（货物明细 / 收货与备注）或费用段（费用结算）。 */
export type SlhReconciliationBillSection
  = | {
    readonly id: 'cargo' | 'recipient'
    readonly label: string
    readonly fields: readonly SlhReconciliationLineField[]
  }
  | {
    readonly id: 'fees'
    readonly label: string
    /** 费用结算按币种分块：人民币一块（合计应付 + 三项费用）、台币一块（代收货款 + 杂费明细）。 */
    readonly blocks: readonly SlhReconciliationFeeBlock[]
  }

/** 费用结算里的一块：一个总额 + 可选的明细合计行 + 虚线之后的明细。 */
export interface SlhReconciliationFeeBlock {
  /** 块头：合计应付人民币或代收货款台币（大号）。 */
  readonly headline: SlhReconciliationBillAmountRow
  /** 明细的合计行（台币杂费合计）：排在明细之上，不参与明细列表。 */
  readonly summary?: SlhReconciliationBillAmountRow
  /** 虚线之后的明细：人民币三项费用或台币杂费逐项。 */
  readonly details: readonly SlhReconciliationBillAmountRow[]
}

/** 装柜面板里的一段：段标题 + 字段行（货物明细 / 收货与备注）。 */
export interface SlhReconciliationLoadingSection {
  readonly label: string
  readonly fields: readonly SlhReconciliationLineField[]
}

/** 装柜明细行面板：顶部信息块（入仓单号 + 匹配依据标签）＋货物明细＋代收货款块＋收货与备注。 */
export interface SlhReconciliationLoadingItemPanel {
  readonly receiptReference: SlhReconciliationLineField
  readonly tags: readonly SlhReconciliationIdentityTag[]
  readonly cargo: SlhReconciliationLoadingSection
  /** 费用详情段：目前只有代收货款块（对账焦点之一）。 */
  readonly fee: SlhReconciliationLoadingFeeSection
  readonly recipient: SlhReconciliationLoadingSection
}

/** 费用详情段：段标题 + 边框块里的金额行。 */
export interface SlhReconciliationLoadingFeeSection {
  readonly label: string
  readonly amount: SlhReconciliationBillAmountRow
}

/** 账单明细行面板：顶部信息块（入仓单号 + 身份标签）＋三段内容（货物明细 / 费用结算 / 收货与备注）。 */
export interface SlhReconciliationBillLinePanel {
  readonly receiptReference: SlhReconciliationLineField
  readonly tags: readonly SlhReconciliationIdentityTag[]
  readonly sections: readonly SlhReconciliationBillSection[]
}

/**
 * 订单区块（销售 / 采购）：信息块（单号 + 三个维度的状态徽章）＋关键字段行＋金额块。
 * 金额块首项是总额、末项是余额，末项非零时带 balance 标记由模板染红。
 */
export interface SlhReconciliationOrderSection {
  readonly id: 'purchase' | 'sales'
  /** 已翻译的区块标题。 */
  readonly label: string
  /** 信息块第一行：订单单号。 */
  readonly orderNo: SlhReconciliationLineField
  /** 信息块第二行：状态徽章，取值缺失的维度不出现。 */
  readonly states: readonly SlhReconciliationStatusTag[]
  /** 关键字段行：客户信息（姓名 · 电话合并）、完整地址、人员等。 */
  readonly fields: readonly SlhReconciliationLineField[]
  /** 金额块：总额 → 三项明细 → 余额。 */
  readonly amountFields: readonly SlhReconciliationLineField[]
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
  }
}

/**
 * 材积行里的括注：主值取系统计算材积，括号里给与账单自报的比较结果（一致 / 差异）；
 * 任一侧缺失就没有括注。账单面板与装柜面板共用，两侧同一行同一措辞。
 */
function volumeComparisonNote(
  difference: SlhBillVolumeDifference | null,
  translate: SlhReconciliationTranslate,
): string {
  if (difference === null) {
    return ''
  }
  return difference.tone === 'even'
    ? `（${translate('slhReconciliation.detail.billVolumeEven')}）`
    : `（${translate('slhBill.line.volumeDifferenceCai')} ${difference.text}）`
}

/**
 * 账单明细行面板：顶部信息块（入仓单号 + 行号/柜号/装柜日期）＋货物明细＋费用结算＋收货与备注。
 *
 * 取值与账单明细列同源，三处合并按对账阅读顺序重组：箱数+重量、系统材积+（自报比较）、
 * 计价方式+类别+单价；台币杂费逐项列出（合计与逐项之和逐行一致，避免同一笔钱出现两次），
 * 人民币费用并入附加费并以费别标签标注（本账单里恒为「重货费」）。
 * 字段名与费别沿用账单域既有键，保证同一事实在明细列与这里的措辞一致。
 * 对账状态与核对留痕按产品要求不在此展示，匹配依据属于柜次侧（放在装柜明细行面板）。
 */
export function buildSlhReconciliationBillLinePanel(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): SlhReconciliationBillLinePanel {
  const { missing, text, amount, amountValue, volume, dimensions, weight } = createFieldFormatters(translate)
  const difference = resolveSlhBillVolumeDifference(member)
  const chargeGroups = groupSlhBillCharges(member.charges)
  const chargeItems = (currencyCode: string) => chargeGroups
    .filter(group => group.currencyCode === currencyCode)
    .flatMap(group => group.items)
  // 附加费的费别标签：账单里的人民币费用已经并进附加费列，标签说明这笔钱是什么费。
  const cnyChargeTypes = [...new Set(chargeItems('CNY').map(item => item.chargeType))]
  const surchargeTag: SlhReconciliationIdentityTag | undefined = member.surchargeAmountCny === null || cnyChargeTypes.length === 0
    ? undefined
    : {
        text: cnyChargeTypes.map(type => translate(`slhBill.chargeType.${type}`)).join('、'),
        tone: 'warning',
      }
  // 台币杂费逐项：费别 + 金额（与账单明细列同一精度），整行橙红强调。
  // 合计来自账单列而不是费用行推导，所以它恒作明细的合计行单独展示；没有费用行时就是这一行的值。
  const twdChargeRows: SlhReconciliationBillAmountRow[] = chargeItems('TWD').map((item, index) => ({
    id: `charge-${item.chargeType}-${index}`,
    label: translate(`slhBill.chargeType.${item.chargeType}`),
    value: amount(item.amount) ?? missing,
    amount: amountValue(item.amount, 'TWD'),
    emphasis: 'warning',
  }))
  const volumeNote = volumeComparisonNote(difference, translate)
  const recipientLines = [member.recipientName, member.recipientAddress, member.recipientPhones]
    .map(value => text(value))
    .filter(value => value !== missing)
  return {
    receiptReference: {
      id: 'warehouseReceiptReference',
      label: translate('slhBill.line.warehouseReceiptReference'),
      // 承运方与序号都在原始值里（如「500229791776（安能） -1」）：原样展示，不解析。
      value: text(member.warehouseReceiptReference),
    },
    tags: [
      // 行号沿用账单明细列的模板键：它说的就是原表行号，不是批次内顺序。
      { text: translate('slhBill.line.lineNumberValue', { line: member.sourceRowNumber }), tone: 'info' },
      { text: text(member.containerBatchNameText), tone: 'info' },
      { text: text(member.loadingDate), tone: 'neutral' },
    ],
    sections: [
      {
        id: 'cargo',
        label: translate('slhReconciliation.detail.billCargoGroup'),
        fields: [
          { id: 'goodsName', label: translate('slhBill.line.goodsName'), value: text(member.goodsName), truncate: true },
          { id: 'shippingMark', label: translate('slhBill.line.shippingMark'), value: text(member.shippingMarkText), truncate: true },
          { id: 'packageCount', label: translate('slhBill.line.packageCount'), value: `${member.packageCount} ${member.packageUnit ?? ''}`.trim() },
          { id: 'weight', label: translate('slhBill.line.weight'), value: weight(member) },
          { id: 'dimensions', label: translate('slhBill.line.dimensions'), value: dimensions(member) },
          { id: 'volumeCai', label: translate('slhBill.line.volumeCai'), value: `${volume(member.volumeCai)}${volumeNote}` },
          {
            id: 'chargeRule',
            label: translate('slhReconciliation.detail.billChargeRule'),
            value: [
              // 契约标的是可选，服务端实际会对缺失回 null：真值判断与账单明细列同一写法。
              member.pricingBasis ? translate(`slhBill.pricingBasis.${member.pricingBasis}`) : missing,
              `${translate('slhBill.line.categoryCode')} ${text(member.categoryCode)}`,
              `${translate('slhBill.line.unitPriceAmount')} ${text(member.unitPriceAmount)}`,
            ].join(' | '),
          },
        ],
      },
      {
        id: 'fees',
        label: translate('slhReconciliation.detail.billFeeGroup'),
        blocks: [
          {
            // 人民币块：合计应付＋基础运费/附加费/代收手续费（三者之和恒等于合计）。
            headline: {
              id: 'payableAmountCny',
              label: translate('slhBill.line.payableAmountCny'),
              value: amount(member.payableAmountCny) ?? missing,
              amount: amountValue(member.payableAmountCny, 'CNY'),
              emphasis: 'total',
            },
            details: [
              {
                id: 'freightAmountCny',
                label: translate('slhBill.line.freightAmountCny'),
                value: amount(member.freightAmountCny) ?? missing,
                amount: amountValue(member.freightAmountCny, 'CNY'),
              },
              {
                id: 'surchargeAmountCny',
                label: translate('slhBill.line.surchargeAmountCny'),
                value: amount(member.surchargeAmountCny) ?? missing,
                amount: amountValue(member.surchargeAmountCny, 'CNY'),
                tag: surchargeTag,
              },
              {
                id: 'codHandlingAmountCny',
                label: translate('slhBill.line.codHandlingAmountCny'),
                value: amount(member.codHandlingAmountCny) ?? missing,
                amount: amountValue(member.codHandlingAmountCny, 'CNY'),
              },
            ],
          },
          {
            // 台币块：代收货款＋台币杂费合计（明细的合计行）＋杂费逐项。
            headline: {
              // 与核对焦点区的「账单代收货款」同一字段、同一组件：蓝色身份也一致。
              id: 'codAmountTwd',
              label: translate('slhBill.line.codAmountTwd'),
              value: amount(member.codAmountTwd) ?? missing,
              amount: amountValue(member.codAmountTwd, 'TWD'),
              emphasis: 'cod',
            },
            summary: {
              id: 'ntdSurchargeAmountTwd',
              label: translate('slhBill.line.ntdSurchargeAmountTwd'),
              value: amount(member.ntdSurchargeAmountTwd) ?? missing,
              amount: amountValue(member.ntdSurchargeAmountTwd, 'TWD'),
            },
            details: twdChargeRows,
          },
        ],
      },
      {
        id: 'recipient',
        label: translate('slhReconciliation.detail.groupRecipient'),
        fields: [
          {
            id: 'recipientInfo',
            label: translate('slhBill.line.recipientInfo'),
            // 收货信息按名称 / 地址 / 电话叠三行展示：原始串仍可在账单明细列查到。
            value: recipientLines.length === 0 ? missing : recipientLines.join(' / '),
            lines: recipientLines,
          },
          // 备注按正文文本呈现，不铺底色（与账单原表的「备注」列观感一致）。
          { id: 'remark', label: translate('slhBill.line.remark'), value: text(member.remark) },
        ],
      },
    ],
  }
}

/**
 * 装柜明细行信息：顶部信息块（装柜侧入仓单号 + 匹配依据标签）＋货物明细＋代收货款块＋收货与备注。
 *
 * 匹配依据（匹配方式 / 匹配柜号 / 货件号）从字段段升为顶部标签：它们是「怎么找到这一行的」，
 * 与单号同属这一行的身份；段标题与账单侧同名（货物明细 / 收货与备注），两侧同名行便于逐项对照。
 * 代收货款台币是对账焦点之一，单独成块并与核对焦点区同源；字段名沿用账单侧的叫法，
 * 让同一页里两侧的同一概念用同一个词，只有与账单侧重名的那一项加「装柜」前缀区分。
 */
export function buildSlhReconciliationLoadingItemPanel(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): SlhReconciliationLoadingItemPanel {
  const { missing, text, amount, amountValue, volume, chargeableVolume, dimensions, weight } = createFieldFormatters(translate)
  const item = member.matchedLoadingItem
  const volumeNote = volumeComparisonNote(resolveSlhBillVolumeDifference(item), translate)
  const recipientLines = [item.recipientName, item.recipientAddress, item.recipientPhone]
    .map(value => text(value))
    .filter(value => value !== missing)
  return {
    receiptReference: {
      id: 'warehouseReceiptReference',
      label: translate('slhBill.line.warehouseReceiptReference'),
      value: text(item.warehouseReceiptReference),
    },
    tags: [
      // 标签只给值：匹配方式、柜号与货件号放在同一行本就是一组身份信息，前缀说明是重复的。
      { text: translate(`slhReconciliation.detail.matchSourceValue.${member.matchSource}`), tone: 'info' },
      { text: `${member.matchedContainerBatchName} #${member.matchedLoadingItemLineNumber}`, tone: 'info' },
      // 缺失时与其它字段一样走占位符。
      { text: text(item.shipmentNo), tone: 'neutral' },
    ],
    cargo: {
      // 与账单侧同名：两侧同一段内容用同一个词，便于左右逐项对照。
      label: translate('slhReconciliation.detail.billCargoGroup'),
      fields: [
        { id: 'goodsName', label: translate('slhBill.line.goodsName'), value: text(item.goodsName), truncate: true },
        { id: 'shippingMark', label: translate('slhBill.line.shippingMark'), value: text(item.oceanShippingMarkText), truncate: true },
        { id: 'packageCount', label: translate('slhBill.line.packageCount'), value: `${item.packageCount} ${item.packageUnit ?? ''}`.trim() },
        { id: 'weight', label: translate('slhBill.line.weight'), value: weight(item) },
        { id: 'dimensions', label: translate('slhBill.line.dimensions'), value: dimensions(item) },
        // 与账单面板同款：系统计算材积带与账单自报的比较括注，收费材积单独一行。
        { id: 'volumeCai', label: translate('slhBill.line.volumeCai'), value: `${volume(item.volumeCai)}${volumeNote}` },
        { id: 'chargeableVolumeCai', label: translate('slhReconciliation.detail.chargeableVolume'), value: chargeableVolume(item.chargeableVolumeCai) },
      ],
    },
    fee: {
      label: translate('slhReconciliation.detail.loadingFeeGroup'),
      amount: {
        // 与核对焦点区的「装柜代收货款」同一字段、同一组件、同一格式。
        id: 'codAmountTwd',
        label: translate('slhReconciliation.detail.loadingCodAmount'),
        value: amount(item.codAmountTwd) ?? missing,
        amount: amountValue(item.codAmountTwd, 'TWD'),
        emphasis: 'total',
      },
    },
    recipient: {
      label: translate('slhReconciliation.detail.groupRecipient'),
      fields: [
        {
          id: 'recipientInfo',
          label: translate('slhBill.line.recipientInfo'),
          // 名称 / 地址 / 电话叠三行，与账单侧的收货信息同一形态。
          value: recipientLines.length === 0 ? missing : recipientLines.join(' / '),
          lines: recipientLines,
        },
        { id: 'remark', label: translate('slhBill.line.remark'), value: text(item.remark), chip: true },
      ],
    },
  }
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

/** 地址开头的国家前缀：地址快照按「国家+省+市+详情」拼，顺联航的地址国家名恒为「中国台湾」。 */
const ADDRESS_COUNTRY_PREFIX = /^(?:中国台湾|中國台灣)\s*/u

/**
 * 去掉完整地址开头的国家前缀「中国台湾」：这一页是内部对账，重复的国家名只占宽度；
 * 只剥离落在开头的一处，地址正文里的同名文字原样保留。
 */
function withoutAddressCountryPrefix(address: string | null | undefined): string | null {
  const value = address?.trim()
  if (!value) {
    return null
  }
  const stripped = value.replace(ADDRESS_COUNTRY_PREFIX, '')
  return stripped === '' ? null : stripped
}

/** 金额字符串是否为「零」：决定余额行要不要染红（0 视为已结清，染红会被读成异常）。 */
function isZeroAmount(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^0*(?:\.0*)?$/u.test(value.trim())
}

/**
 * 销售与采购区块：装柜行匹配到的货件 → 采购订单 → 销售订单，与匹配合格判定同一条链路。
 *
 * 每个区块＝信息块（单号一行 + 状态徽章一行）＋关键字段行＋金额块（总额、三项明细、余额）。
 * 销售排在采购之前；客户姓名与电话合并成一行（只有其一就只显示存在的那个）；金额按各自币种
 * 标注并统一两位小数展示（销售侧源数据是四位小数）；枚举取值与字段名沿用采购/销售页面那套键，
 * 保证同一事实在两个页面上的措辞一致。来源缺失（历史或损坏数据）时走占位符，不猜也不留空。
 */
export function buildSlhReconciliationOrderSections(
  member: SlhReconciliationBatchMemberDto,
  translate: SlhReconciliationTranslate,
): readonly SlhReconciliationOrderSection[] {
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
  /** 金额块的一行：总额行与余额行带位置标记，余额为零时不下发标记（模板据此决定染不染红）。 */
  const amountField = (
    id: string,
    labelKey: string,
    currency: string,
    value: string | undefined,
    position?: 'balance' | 'total',
  ): SlhReconciliationLineField => {
    const amount = amountValue(value, currency)
    const field: SlhReconciliationLineField = {
      id,
      label: translate(labelKey),
      value: money(currency, value),
      amount,
    }
    // 标记只跟着真实金额走：缺失（本行不涉及）时既不下发 amount 也不下发 emphasis。
    const emphasis = amount === undefined || (position === 'balance' && isZeroAmount(value))
      ? undefined
      : position
    return emphasis === undefined ? field : { ...field, emphasis }
  }
  /**
   * 客户信息合并成一行：姓名与电话都用「 · 」连接，只有其一就只显示存在的那个，
   * 两个都缺才走占位符（避免出现孤立的点号）。
   */
  const merged = (
    id: string,
    labelKey: string,
    parts: readonly (string | null | undefined)[],
  ): SlhReconciliationLineField => {
    const values = parts.map(part => text(part)).filter(value => value !== missing)
    // 姓名 + 电话拼起来容易超长：单行截断，超长时悬停看完整值。
    return {
      id,
      label: translate(labelKey),
      value: values.length === 0 ? missing : values.join(' · '),
      truncate: true,
    }
  }
  /** 三个维度的状态徽章统一在这里装配：维度名用于无障碍朗读，色调由对应域的查表给出。 */
  const states = (
    orderStatusKey: string,
    statusGroup: 'purchaseOrderDrawer' | 'salesOrderDrawer',
    tones: {
      readonly fulfillment: Readonly<Record<string, QsStatusTagTone>>
      readonly order: Readonly<Record<string, QsStatusTagTone>>
      readonly payment: Readonly<Record<string, QsStatusTagTone>>
    },
    row: { readonly fulfillmentStatus: string, readonly orderStatus: string, readonly paymentStatus: string } | null,
  ): readonly SlhReconciliationStatusTag[] => [
    tag(orderStatusKey, statusGroup, tones.order, row?.orderStatus),
    tag('slhReconciliation.detail.fulfillmentStatus', statusGroup, tones.fulfillment, row?.fulfillmentStatus),
    tag('slhReconciliation.detail.paymentStatus', statusGroup, tones.payment, row?.paymentStatus),
  ].filter((item): item is SlhReconciliationStatusTag => item !== null)
  const salesCurrency = sales?.currencyCode ?? ''
  return [
    {
      id: 'sales',
      label: translate('slhReconciliation.detail.salesGroup'),
      orderNo: { id: 'salesOrderNo', label: translate('slhReconciliation.detail.salesOrderNo'), value: text(sales?.orderNo) },
      states: states('slhReconciliation.detail.salesOrderStatus', 'salesOrderDrawer', SALES_STATUS_TONES, sales),
      fields: [
        merged('customer', 'salesOrderDesc.sections.customer', [sales?.customerName, sales?.customerPhone]),
        { id: 'customerFullAddress', label: translate('salesOrderDesc.fields.fullAddress'), value: text(withoutAddressCountryPrefix(sales?.customerFullAddress)), truncate: true },
        // 出单人是人员信息：交给 QsPersonDisplay（头像位 + 名称截断），文案仍取销售域键。
        { id: 'issuer', label: translate('salesOrderDesc.fields.issuer'), ...person(sales?.issuerDisplayName) },
      ],
      amountFields: [
        amountField('salesTotalAmount', 'slhReconciliation.detail.salesTotalAmount', salesCurrency, sales?.agreedTotalAmount, 'total'),
        amountField('depositDueAmount', 'slhReconciliation.detail.salesDeposit', salesCurrency, sales?.depositDueAmount),
        amountField('balanceDueAmount', 'slhReconciliation.detail.salesBalance', salesCurrency, sales?.balanceDueAmount),
        amountField('receivedAmount', 'slhReconciliation.detail.receivedAmount', salesCurrency, sales?.receivedAmount),
        amountField('outstandingAmount', 'slhReconciliation.detail.outstandingAmount', salesCurrency, sales?.outstandingAmount, 'balance'),
      ],
    },
    {
      id: 'purchase',
      label: translate('slhReconciliation.detail.purchaseGroup'),
      orderNo: { id: 'purchaseOrderNo', label: translate('slhReconciliation.detail.purchaseOrderNo'), value: text(purchase?.orderNo) },
      states: states('slhReconciliation.detail.purchaseOrderStatus', 'purchaseOrderDrawer', PURCHASE_STATUS_TONES, purchase),
      fields: [
        { id: 'supplier', label: translate('slhReconciliation.detail.supplier'), value: text(purchase?.supplier.label), truncate: true },
        { id: 'shippingMark', label: translate('purchaseOrderDesc.fields.shippingMark'), value: text(purchase?.shippingMarkText), truncate: true },
        // 采购人＝采购订单的创建人，与销售侧出单人一样交给 QsPersonDisplay。
        { id: 'purchaseCreator', label: translate('slhReconciliation.detail.purchaseCreator'), ...person(purchase?.creatorDisplayName) },
      ],
      amountFields: [
        amountField('purchaseTotalAmount', 'slhReconciliation.detail.purchaseTotalAmount', 'CNY', purchase?.purchaseTotalAmount, 'total'),
        amountField('depositDueAmount', 'slhReconciliation.detail.purchaseDeposit', 'CNY', purchase?.depositDueAmount),
        // 采购侧也有「尾款」，与销售的尾款同名不同币种：加来源前缀消歧（对账要核的是销售尾款）。
        amountField('balanceDueAmount', 'slhReconciliation.detail.purchaseBalance', 'CNY', purchase?.balanceDueAmount),
        amountField('paidAmount', 'slhReconciliation.detail.purchasePaidAmount', 'CNY', purchase?.paidAmount),
        amountField('outstandingAmount', 'slhReconciliation.detail.purchaseOutstandingAmount', 'CNY', purchase?.outstandingAmount, 'balance'),
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
