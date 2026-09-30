import type { SlhBillFindingDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'

/** 生成类型把非空字段标成可选：统一收敛成 null，避免把 undefined 当成字符串比较。 */
function text(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value)
}

/**
 * 对账详情页的差异判定：账单行（对方口径）与匹配到的柜次装柜行（我方口径）逐字段比对。
 *
 * 判定口径（用户 2026-09-30 的决定，别在这里改口径）：
 * - 代收款是唯一两侧都有原始值的金额字段，因此也是唯一能给出差额的差异；
 * - 费用出入只用账单导入时的 findings 快照，不拿柜次数据复算运费；
 * - 空值表示「本行不涉及」，与显式 0 是两种写法：`null` 与 `0.00` 判为差异（涉及/不涉及冲突）；
 * - 材积分母与尺寸精度已两侧统一（28316 / 2 位），所以不存在「口径差」这一类；
 * - 收货人只是辅助对比项：这里做归一化后比较，更细的模糊阈值未定，因此不宣称「判为同一」。
 *
 * 这里是读取时重算的纯函数：筛选条计数、行徽标、Hero 合计共用同一份结果，
 * 保证「筛出来的行数」与「计数说的行数」永远一致；不落库、不缓存。
 */

export type SlhReconciliationDiffBucket = 'COD' | 'FEE' | 'QUANTITY' | 'TEXT'
/** 顺序即界面顺序：代收款（主目标）在前，费用与其余参考项在后。 */
export const SLH_RECONCILIATION_DIFF_BUCKETS: readonly SlhReconciliationDiffBucket[] = ['COD', 'FEE', 'QUANTITY', 'TEXT']

export type SlhReconciliationDiffField
  = | 'codAmountTwd'
    | 'packageCount' | 'grossWeightKg' | 'lengthCm' | 'widthCm' | 'heightCm' | 'volumeCai'
    | 'goodsName' | 'shippingMark' | 'warehouseReceiptReference'
    | 'recipientName' | 'recipientPhone' | 'recipientAddress'

/** 字段级结果：SAME 一致、DIFFERENT 两侧都有值但不等、ABSENT 单侧不涉及、BOTH_ABSENT 都不涉及。 */
export type SlhReconciliationFieldState = 'SAME' | 'DIFFERENT' | 'ABSENT' | 'BOTH_ABSENT'

export interface SlhReconciliationFieldComparison {
  readonly field: SlhReconciliationDiffField
  readonly bucket: Exclude<SlhReconciliationDiffBucket, 'FEE'>
  readonly state: SlhReconciliationFieldState
  /** 账单侧值，已归一到该字段的记录精度；null 表示本行不涉及。 */
  readonly bill: string | null
  readonly container: string | null
  /** 可计算的差值：约定为「柜次 − 账单」，只在该字段两侧都有值且不等时给出。 */
  readonly difference: string | null
}

export interface SlhReconciliationMemberComparison {
  readonly lineId: string
  readonly lineNumber: number
  /** 全部比对过的字段，含一致项：展开面板要能一条不漏地看完。 */
  readonly fields: readonly SlhReconciliationFieldComparison[]
  readonly cod: SlhReconciliationFieldComparison
  readonly buckets: readonly SlhReconciliationDiffBucket[]
  /** 挂在当前行上的账单导入快照差异（桶 FEE）。 */
  readonly findings: readonly SlhBillFindingDto[]
}

export interface SlhReconciliationSummary {
  readonly memberCount: number
  readonly reconciledMemberCount: number
  readonly pendingMemberCount: number
  /** 代收款两侧都有值且不等的行数。 */
  readonly codDifferentCount: number
  /** 代收款单侧不涉及的行数：没有差额可算，必须单独计数才能被完整统计。 */
  readonly codConflictCount: number
  /** 代收款可计算差额合计（仅两侧都有值的行，柜次 − 账单）；没有可比行时为 null。 */
  readonly codDifferenceTotal: string | null
  /** 两侧有值合计，口径为「null 按 0 计入」，所以两个合计不能直接相减。 */
  readonly billCodTotal: string
  readonly containerCodTotal: string
  /** 每个桶涉及的行数（FEE 也是行数，条数另用 batchFindingCount）。 */
  readonly bucketLineCounts: Readonly<Record<SlhReconciliationDiffBucket, number>>
  /** 至少命中一个桶的成员行数。 */
  readonly linesWithDifference: number
  readonly batchFindingCount: number
  readonly billFindingCount: number
}

export interface SlhReconciliationComparison {
  readonly members: readonly SlhReconciliationMemberComparison[]
  readonly summary: SlhReconciliationSummary
  /** 账单级（不挂在任何行上）的差异项，按口径只计数、不混进桶内。 */
  readonly billLevelFindings: readonly SlhBillFindingDto[]
}

const MONEY_SCALE = 2
const WEIGHT_SCALE = 3
const DIMENSION_SCALE = 2
const VOLUME_SCALE = 2
const PHONE_SEPARATORS = /[\s()\-–—·.]/gu

function parse(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  try {
    return new Decimal(value.trim())
  }
  catch {
    return null
  }
}

/** 数值按记录精度归一；非法值退化为原样文本，交给比较层判为不等而不是静默当作缺失。 */
function normalizeScalar(value: string | null | undefined, scale: number): string | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null
  }
  const parsed = parse(value)
  return parsed === null ? value.trim() : parsed.toFixed(scale)
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const collapsed = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return collapsed === '' ? null : collapsed
}

/** 电话只忽略分隔符，冠码与位数保持原样：更细的等价规则属于待定的模糊匹配口径。 */
function normalizePhone(value: string | null | undefined): string | null {
  const text = normalizeText(value)
  return text === null ? null : text.replace(PHONE_SEPARATORS, '')
}

function compareScalar(
  field: SlhReconciliationDiffField,
  bucket: Exclude<SlhReconciliationDiffBucket, 'FEE'>,
  billRaw: string | null | undefined,
  containerRaw: string | null | undefined,
  normalize: (value: string | null | undefined) => string | null,
  scale: number | null,
): SlhReconciliationFieldComparison {
  const bill = normalize(billRaw)
  const container = normalize(containerRaw)
  if (bill === null && container === null) {
    return { bill: null, bucket, container: null, difference: null, field, state: 'BOTH_ABSENT' }
  }
  if (bill === null || container === null) {
    return { bill, bucket, container, difference: null, field, state: 'ABSENT' }
  }
  if (bill === container) {
    return { bill, bucket, container, difference: null, field, state: 'SAME' }
  }
  const difference = scale === null ? null : new Decimal(container).minus(new Decimal(bill)).toFixed(scale)
  return { bill, bucket, container, difference, field, state: 'DIFFERENT' }
}

const scalarNormalizer = (scale: number) => (value: string | null | undefined) => normalizeScalar(value, scale)

/**
 * 材积按计价方式配对：按材积计价时账单的 volumeCai 是向上取整后的计费量，
 * 语义上对应柜次的 chargeableVolumeCai；按重量计价时两侧比的都是记录值。
 */
function compareVolume(member: SlhReconciliationBatchMemberDto): SlhReconciliationFieldComparison {
  const container = member.pricingBasis === 'VOLUME'
    ? (member.matchedLoadingItem.chargeableVolumeCai ?? member.matchedLoadingItem.volumeCai)
    : member.matchedLoadingItem.volumeCai
  return compareScalar('volumeCai', 'QUANTITY', member.volumeCai, text(container), scalarNormalizer(VOLUME_SCALE), VOLUME_SCALE)
}

/** 逐字段比对；顺序就是展开面板的行顺序，先主目标后参考项。 */
export function compareSlhReconciliationMember(member: SlhReconciliationBatchMemberDto): readonly SlhReconciliationFieldComparison[] {
  const item = member.matchedLoadingItem
  return [
    compareScalar('codAmountTwd', 'COD', member.codAmountTwd, item.codAmountTwd, scalarNormalizer(MONEY_SCALE), MONEY_SCALE),
    // 生成类型把非空列标成可选，这里把 undefined 收敛成 null，避免出现字符串 'undefined'。
    compareScalar('packageCount', 'QUANTITY', text(member.packageCount), text(item.packageCount), value => value ?? null, 0),
    compareScalar('grossWeightKg', 'QUANTITY', member.grossWeightKg, item.grossWeightKg, scalarNormalizer(WEIGHT_SCALE), WEIGHT_SCALE),
    compareScalar('lengthCm', 'QUANTITY', member.lengthCm, item.lengthCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
    compareScalar('widthCm', 'QUANTITY', member.widthCm, item.widthCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
    compareScalar('heightCm', 'QUANTITY', member.heightCm, item.heightCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
    compareVolume(member),
    compareScalar('goodsName', 'TEXT', member.goodsName, item.goodsName, normalizeText, null),
    compareScalar('shippingMark', 'TEXT', member.shippingMarkText, item.oceanShippingMarkText, normalizeText, null),
    compareScalar('warehouseReceiptReference', 'TEXT', member.warehouseReceiptReference, item.warehouseReceiptReference, normalizeText, null),
    compareScalar('recipientName', 'TEXT', member.recipientName, item.recipientName, normalizeText, null),
    compareScalar('recipientPhone', 'TEXT', member.recipientPhones, item.recipientPhone, normalizePhone, null),
    compareScalar('recipientAddress', 'TEXT', member.recipientAddress, item.recipientAddress, normalizeText, null),
  ]
}

/** 差异只认 DIFFERENT 与 ABSENT：单侧不涉及同样是必须处理的信息，不能因为「没数」被略过。 */
function hasDifference(comparison: SlhReconciliationFieldComparison): boolean {
  return comparison.state === 'DIFFERENT' || comparison.state === 'ABSENT'
}

function bucketsOf(fields: readonly SlhReconciliationFieldComparison[], findings: readonly SlhBillFindingDto[]): readonly SlhReconciliationDiffBucket[] {
  const buckets: SlhReconciliationDiffBucket[] = []
  for (const bucket of SLH_RECONCILIATION_DIFF_BUCKETS) {
    if (bucket === 'FEE') {
      if (findings.length > 0) {
        buckets.push(bucket)
      }
      continue
    }
    if (fields.some(field => field.bucket === bucket && hasDifference(field))) {
      buckets.push(bucket)
    }
  }
  return buckets
}

export function buildSlhReconciliationComparisons(input: {
  readonly members: readonly SlhReconciliationBatchMemberDto[]
  readonly findings: readonly SlhBillFindingDto[]
}): SlhReconciliationComparison {
  const findingsByLine = new Map<number, SlhBillFindingDto[]>()
  const billLevelFindings: SlhBillFindingDto[] = []
  for (const finding of input.findings) {
    const lineNumber = finding.lineNumber
    if (lineNumber === null || lineNumber === undefined) {
      billLevelFindings.push(finding)
      continue
    }
    const bucket = findingsByLine.get(lineNumber)
    if (bucket === undefined) {
      findingsByLine.set(lineNumber, [finding])
    }
    else { bucket.push(finding) }
  }

  const members: SlhReconciliationMemberComparison[] = input.members.map((member) => {
    const fields = compareSlhReconciliationMember(member)
    const findings = findingsByLine.get(member.lineNumber) ?? []
    return {
      buckets: bucketsOf(fields, findings),
      cod: fields[0],
      fields,
      findings,
      lineId: member.lineId,
      lineNumber: member.lineNumber,
    }
  })

  const bucketLineCounts = { COD: 0, FEE: 0, QUANTITY: 0, TEXT: 0 }
  for (const member of members) {
    for (const bucket of member.buckets) {
      bucketLineCounts[bucket] += 1
    }
  }

  const codDifferent = members.filter(member => member.cod.state === 'DIFFERENT')
  const codConflictCount = members.filter(member => member.cod.state === 'ABSENT').length
  const codDifferenceTotal = codDifferent.length === 0
    ? null
    : codDifferent.reduce((sum, member) => sum.plus(new Decimal(member.cod.difference!)), new Decimal(0)).toFixed(MONEY_SCALE)
  // 合计口径：null（本行不涉及）按 0 计入，所以合计是「有值项之和」，两侧不能直接相减。
  const sumCod = (value: (member: SlhReconciliationBatchMemberDto) => string | null | undefined) => input.members
    .reduce((sum, member) => sum.plus(parse(value(member)) ?? new Decimal(0)), new Decimal(0))
    .toFixed(MONEY_SCALE)

  return {
    billLevelFindings,
    members,
    summary: {
      // 本批次口径只数落在成员行上的条目：账单其他行的条目既不在表里，也不算本批次。
      batchFindingCount: members.reduce((sum, member) => sum + member.findings.length, 0),
      billCodTotal: sumCod(member => member.codAmountTwd),
      billFindingCount: input.findings.length,
      bucketLineCounts,
      codConflictCount,
      codDifferenceTotal,
      codDifferentCount: codDifferent.length,
      containerCodTotal: sumCod(member => member.matchedLoadingItem.codAmountTwd),
      linesWithDifference: members.filter(member => member.buckets.length > 0).length,
      memberCount: input.members.length,
      pendingMemberCount: input.members.filter(member => member.reconciledAt === null).length,
      reconciledMemberCount: input.members.filter(member => member.reconciledAt !== null).length,
    },
  }
}

export function filterSlhReconciliationComparisons(
  members: readonly SlhReconciliationMemberComparison[],
  bucket: SlhReconciliationDiffBucket | 'all',
): readonly SlhReconciliationMemberComparison[] {
  if (bucket === 'all') {
    return members
  }
  return members.filter(member => member.buckets.includes(bucket))
}

export function resolveSlhReconciliationBucketLabelKey(bucket: SlhReconciliationDiffBucket): string {
  return `slhReconciliation.detail.bucket.${bucket}`
}

export function resolveSlhReconciliationFieldLabelKey(field: SlhReconciliationDiffField): string {
  return `slhReconciliation.detail.field.${field}`
}

export function resolveSlhReconciliationFieldStateLabelKey(state: SlhReconciliationFieldState): string {
  return `slhReconciliation.detail.fieldState.${state}`
}

export function resolveSlhReconciliationFindingLabelKey(kind: SlhBillFindingDto['kind']): string {
  return `slhReconciliation.detail.finding.${kind}`
}
