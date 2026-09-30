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
 * - 费用出入只用账单导入时的 findings 快照，不拿柜次数据复算运费；
 * - 空值表示「本行不涉及」，与显式 0 是两种写法：`null` 与 `0.00` 判为差异（涉及/不涉及冲突）；
 * - 材积分母与尺寸精度已两侧统一（28316 / 2 位），所以不存在「口径差」这一类；
 * - 收货人只是辅助对比项：这里做归一化后比较，更细的模糊阈值未定，因此不宣称「判为同一」；
 * - **所有不一致一律平等**：四个桶、各类字段之间没有主次，字段展示顺序取「账单原表列序」，
 *   任何字段都不再获得专属的位置、颜色或字号（这条是 2026-09-30 用户明确要求的，别再引入优先级）。
 *
 * 这里是读取时重算的纯函数：概览计数、清单徽标、净差小结共用同一份结果，
 * 保证「筛出来的行数」与「计数说的行数」永远一致；不落库、不缓存。
 */

export type SlhReconciliationDiffBucket = 'COD' | 'FEE' | 'QUANTITY' | 'TEXT'
/** 桶顺序与展示顺序一致；四个桶等权，顺序只是为了稳定，不代表重要性。 */
export const SLH_RECONCILIATION_DIFF_BUCKETS: readonly SlhReconciliationDiffBucket[] = ['COD', 'FEE', 'QUANTITY', 'TEXT']

export type SlhReconciliationDiffField
  = | 'warehouseReceiptReference' | 'shippingMark' | 'goodsName'
    | 'packageCount' | 'grossWeightKg' | 'lengthCm' | 'widthCm' | 'heightCm' | 'volumeCai'
    | 'codAmountTwd'
    | 'recipientName' | 'recipientPhone' | 'recipientAddress'

/**
 * 字段展示顺序＝账单原表列序（取解析器列映射 `slh-bill-parser.ts` 的 HEADERS 键序中「可比字段」这一子集）。
 * 顺序有唯一真相源，不在这里按重要性另排一份；代收款因此落在材积之后、收货人之前。
 */
export const SLH_RECONCILIATION_FIELD_ORDER: readonly SlhReconciliationDiffField[] = [
  'warehouseReceiptReference',
  'shippingMark',
  'goodsName',
  'packageCount',
  'grossWeightKg',
  'lengthCm',
  'widthCm',
  'heightCm',
  'volumeCai',
  'codAmountTwd',
  'recipientName',
  'recipientPhone',
  'recipientAddress',
]

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
  /** 全部比对过的字段，按原表列序，含一致项：对照面板要能一条不漏地看完。 */
  readonly fields: readonly SlhReconciliationFieldComparison[]
  readonly buckets: readonly SlhReconciliationDiffBucket[]
  /**
   * 不一致的「处数」：不一致字段数 + 费用条目数。
   * 中性口径——不区分桶、不区分性质，只回答「这条行有几处要处理」。
   */
  readonly differenceCount: number
  /** 挂在当前行上的账单导入快照差异（桶 FEE）。 */
  readonly findings: readonly SlhBillFindingDto[]
}

/** 可累加的字段：只有量纲上能跨行求和的字段进净差小结，逐件尺寸（长宽高）不参与。 */
export const SLH_RECONCILIATION_TOTAL_FIELDS = ['codAmountTwd', 'packageCount', 'grossWeightKg', 'volumeCai'] as const
export type SlhReconciliationTotalField = typeof SLH_RECONCILIATION_TOTAL_FIELDS[number]

export interface SlhReconciliationFieldTotal {
  readonly field: SlhReconciliationTotalField
  /** 净差（仅两侧都有值且不等的行，柜次 − 账单）；没有可比行时为 null。 */
  readonly total: string | null
  /** 两侧都有值且不等的行数。 */
  readonly computedCount: number
  /** 单侧不涉及的行数：没有两个数可减，因此不进净差，但必须照实呈现。 */
  readonly absentCount: number
}

export interface SlhReconciliationSummary {
  readonly memberCount: number
  readonly reconciledMemberCount: number
  readonly pendingMemberCount: number
  /** 每个桶涉及的行数（FEE 也是行数，条数另用 batchFindingCount）。 */
  readonly bucketLineCounts: Readonly<Record<SlhReconciliationDiffBucket, number>>
  /** 至少命中一个桶的成员行数。 */
  readonly linesWithDifference: number
  readonly batchFindingCount: number
  readonly billFindingCount: number
  /** 按字段的净差小结：四个桶等权之后，金额不再是唯一有合计的量。 */
  readonly fieldTotals: readonly SlhReconciliationFieldTotal[]
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

/** 逐字段比对；数组顺序就是原表列序，也是对照面板的行顺序。 */
export function compareSlhReconciliationMember(member: SlhReconciliationBatchMemberDto): readonly SlhReconciliationFieldComparison[] {
  const item = member.matchedLoadingItem
  const byField: Record<SlhReconciliationDiffField, SlhReconciliationFieldComparison> = {
    codAmountTwd: compareScalar('codAmountTwd', 'COD', member.codAmountTwd, item.codAmountTwd, scalarNormalizer(MONEY_SCALE), MONEY_SCALE),
    goodsName: compareScalar('goodsName', 'TEXT', member.goodsName, item.goodsName, normalizeText, null),
    grossWeightKg: compareScalar('grossWeightKg', 'QUANTITY', member.grossWeightKg, item.grossWeightKg, scalarNormalizer(WEIGHT_SCALE), WEIGHT_SCALE),
    heightCm: compareScalar('heightCm', 'QUANTITY', member.heightCm, item.heightCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
    lengthCm: compareScalar('lengthCm', 'QUANTITY', member.lengthCm, item.lengthCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
    // 生成类型把非空列标成可选，这里把 undefined 收敛成 null，避免出现字符串 'undefined'。
    packageCount: compareScalar('packageCount', 'QUANTITY', text(member.packageCount), text(item.packageCount), value => value ?? null, 0),
    recipientAddress: compareScalar('recipientAddress', 'TEXT', member.recipientAddress, item.recipientAddress, normalizeText, null),
    recipientName: compareScalar('recipientName', 'TEXT', member.recipientName, item.recipientName, normalizeText, null),
    recipientPhone: compareScalar('recipientPhone', 'TEXT', member.recipientPhones, item.recipientPhone, normalizePhone, null),
    shippingMark: compareScalar('shippingMark', 'TEXT', member.shippingMarkText, item.oceanShippingMarkText, normalizeText, null),
    volumeCai: compareVolume(member),
    warehouseReceiptReference: compareScalar('warehouseReceiptReference', 'TEXT', member.warehouseReceiptReference, item.warehouseReceiptReference, normalizeText, null),
    widthCm: compareScalar('widthCm', 'QUANTITY', member.widthCm, item.widthCm, scalarNormalizer(DIMENSION_SCALE), DIMENSION_SCALE),
  }
  return SLH_RECONCILIATION_FIELD_ORDER.map(field => byField[field])
}

/** 按字段名取比对结果：代收款不再是特例，取用方式与其它字段完全一样。 */
export function resolveSlhReconciliationField(
  member: SlhReconciliationMemberComparison,
  field: SlhReconciliationDiffField,
): SlhReconciliationFieldComparison | null {
  return member.fields.find(item => item.field === field) ?? null
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

function buildFieldTotals(members: readonly SlhReconciliationMemberComparison[]): readonly SlhReconciliationFieldTotal[] {
  return SLH_RECONCILIATION_TOTAL_FIELDS.flatMap((field) => {
    let total: Decimal | null = null
    let computedCount = 0
    let absentCount = 0
    for (const member of members) {
      const comparison = resolveSlhReconciliationField(member, field)
      if (comparison === null) {
        continue
      }
      if (comparison.state === 'ABSENT') {
        absentCount += 1
        continue
      }
      if (comparison.state !== 'DIFFERENT' || comparison.difference === null) {
        continue
      }
      total = (total ?? new Decimal(0)).plus(new Decimal(comparison.difference))
      computedCount += 1
    }
    // 没有可比行、也没有单侧不涉及的行时，这个字段根本没参与过核对，不必出现在小结里。
    if (computedCount === 0 && absentCount === 0) {
      return []
    }
    return [{ absentCount, computedCount, field, total: total === null ? null : total.toFixed(field === 'codAmountTwd' ? MONEY_SCALE : field === 'grossWeightKg' ? WEIGHT_SCALE : field === 'volumeCai' ? VOLUME_SCALE : 0) }]
  })
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
      differenceCount: fields.filter(hasDifference).length + findings.length,
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

  return {
    billLevelFindings,
    members,
    summary: {
      // 本批次口径只数落在成员行上的条目：账单其他行的条目既不在表里，也不算本批次。
      batchFindingCount: members.reduce((sum, member) => sum + member.findings.length, 0),
      billFindingCount: input.findings.length,
      bucketLineCounts,
      fieldTotals: buildFieldTotals(members),
      linesWithDifference: members.filter(member => member.buckets.length > 0).length,
      memberCount: input.members.length,
      pendingMemberCount: input.members.filter(member => member.reconciledAt === null).length,
      reconciledMemberCount: input.members.filter(member => member.reconciledAt !== null).length,
    },
  }
}

export type SlhReconciliationSortMode = 'DIFFERENCE_FIRST' | 'LINE_NUMBER'
export type SlhReconciliationGroupMode = 'NONE' | 'BUCKET'
/** 成员行达到这个数量后默认按桶分组：低数据量保持扁平更省视线。 */
export const SLH_RECONCILIATION_BUCKET_GROUP_THRESHOLD = 30

/** 排序：`DIFFERENCE_FIRST` 只区分「有没有不一致」，不在桶之间分先后。 */
export function sortSlhReconciliationComparisons(
  members: readonly SlhReconciliationMemberComparison[],
  mode: SlhReconciliationSortMode,
): readonly SlhReconciliationMemberComparison[] {
  const byLineNumber = (left: SlhReconciliationMemberComparison, right: SlhReconciliationMemberComparison) => left.lineNumber - right.lineNumber
  if (mode === 'LINE_NUMBER') {
    return [...members].sort(byLineNumber)
  }
  return [...members].sort((left, right) => {
    const leftHas = left.buckets.length > 0 ? 0 : 1
    const rightHas = right.buckets.length > 0 ? 0 : 1
    return leftHas === rightHas ? byLineNumber(left, right) : leftHas - rightHas
  })
}

export interface SlhReconciliationBucketGroup {
  readonly bucket: SlhReconciliationDiffBucket
  /** 命中该桶的成员行；同一行命中多个桶时会出现在多个分组里。 */
  readonly members: readonly SlhReconciliationMemberComparison[]
}

/**
 * 按桶分组：同一行可以出现在多个分组里（例如同时命中代收款与费用），
 * 因此分组的行数之和大于等于去重的「不一致行数」，顶部计数仍按去重口径。
 */
export function groupSlhReconciliationComparisonsByBucket(
  members: readonly SlhReconciliationMemberComparison[],
): readonly SlhReconciliationBucketGroup[] {
  return SLH_RECONCILIATION_DIFF_BUCKETS.flatMap((bucket) => {
    const matched = members.filter(member => member.buckets.includes(bucket))
    return matched.length === 0 ? [] : [{ bucket, members: matched }]
  })
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

export function filterSlhReconciliationDifferences(
  members: readonly SlhReconciliationMemberComparison[],
): readonly SlhReconciliationMemberComparison[] {
  return members.filter(member => member.buckets.length > 0)
}

/** 「下一条不一致」：按当前顺序取当前行之后的第一个不一致行；没有下一条时返回 null。 */
export function nextSlhReconciliationDifferenceLineId(
  members: readonly SlhReconciliationMemberComparison[],
  currentLineId: string,
): string | null {
  const start = members.findIndex(member => member.lineId === currentLineId) + 1
  for (let index = Math.max(0, start); index < members.length; index += 1) {
    const member = members[index]
    if (member.buckets.length > 0) {
      return member.lineId
    }
  }
  return null
}

/** 清单行：判定结果与原始成员行的配对，避免组件各自再查一次表。 */
export interface SlhReconciliationRow {
  readonly key: string
  readonly comparison: SlhReconciliationMemberComparison
  readonly member: SlhReconciliationBatchMemberDto
}

export function buildSlhReconciliationRows(
  members: readonly SlhReconciliationBatchMemberDto[],
  comparisons: readonly SlhReconciliationMemberComparison[],
): readonly SlhReconciliationRow[] {
  const memberByLineId = new Map(members.map(member => [member.lineId, member]))
  return comparisons.flatMap((comparison) => {
    const member = memberByLineId.get(comparison.lineId)
    return member === undefined ? [] : [{ comparison, key: comparison.lineId, member }]
  })
}

export interface SlhReconciliationBucketRowGroup {
  readonly bucket: SlhReconciliationDiffBucket
  readonly rows: readonly SlhReconciliationRow[]
}

export function groupSlhReconciliationRowsByBucket(
  rows: readonly SlhReconciliationRow[],
): readonly SlhReconciliationBucketRowGroup[] {
  return SLH_RECONCILIATION_DIFF_BUCKETS.flatMap((bucket) => {
    const matched = rows.filter(row => row.comparison.buckets.includes(bucket))
    return matched.length === 0 ? [] : [{ bucket, rows: matched }]
  })
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

/** 净差小结里每个字段自己的单位；单位本身也要翻译（件/kg 在英文界面是 pcs/kg）。 */
export function resolveSlhReconciliationUnitLabelKey(field: SlhReconciliationTotalField): string {
  return `slhReconciliation.detail.unit.${field}`
}
