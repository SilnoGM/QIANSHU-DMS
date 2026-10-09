/**
 * 账单明细行与顺联航柜次行的匹配规则（唯一定义处）。
 *
 * 一次对账只核对「当前能匹配到合格柜次行」的明细行，因此匹配结果在建批次时冻结。
 * 两条定位路径：
 * 1. 名称路径：账单柜号形如 `MMDD柜` / `MMDD-NN柜`，年份取该明细行装柜日期的年份；
 * 2. 唛头辅助路径：名称定位不到时，取唛头连字符后的四位月日，序号按 1（唛头不携带柜次序号）。
 *
 * 年份绝不能取当前年份或账单期间年份：柜次名称本身不含年份，跨年同名柜次合法共存
 * （唯一键是「仓库 + 装柜日期 + 当日序号」），同一张账单里就可能同时出现 12 月与次年 1 月的柜次。
 * 命中不唯一时一律判为不合格，不做猜测。
 */

/** 匹配来源：与持久化枚举 slh_bill_line_match_source 取值一致。 */
export type SlhBillLineMatchSource = 'NAME' | 'MARK'

/** 不合格原因：按「柜次定位 → 柜次行 → 货件与来源」三层给出。 */
export type SlhBillLineUnmatchedReason =
  | 'MISSING_CONTAINER_REFERENCE'
  | 'INVALID_CONTAINER_NAME'
  | 'CONTAINER_NOT_FOUND'
  | 'CONTAINER_AMBIGUOUS'
  | 'MISSING_SHIPPING_MARK'
  | 'MARK_NOT_FOUND_IN_CONTAINER'
  | 'LOADING_ITEM_AMBIGUOUS'
  | 'SHIPMENT_NOT_MATCHED'
  | 'PURCHASE_SOURCE_MISSING'
  | 'SALES_SOURCE_MISSING'

/** 原因码清单：DTO 枚举镜像它，单测断言两者一致，避免接口层与规则层漂移。 */
export const SLH_BILL_LINE_UNMATCHED_REASONS = [
  'MISSING_CONTAINER_REFERENCE',
  'INVALID_CONTAINER_NAME',
  'CONTAINER_NOT_FOUND',
  'CONTAINER_AMBIGUOUS',
  'MISSING_SHIPPING_MARK',
  'MARK_NOT_FOUND_IN_CONTAINER',
  'LOADING_ITEM_AMBIGUOUS',
  'SHIPMENT_NOT_MATCHED',
  'PURCHASE_SOURCE_MISSING',
  'SALES_SOURCE_MISSING',
] as const satisfies readonly SlhBillLineUnmatchedReason[]

export interface SlhBillContainerItemInput {
  id: string
  oceanShippingMarkText: string | null
  /** null 表示柜次行没有匹配货件；有货件时再校验采购来源与销售来源。 */
  shipment: { purchaseOrderId: string | null, salesOrderId: string | null } | null
}

export interface SlhBillContainerBatchInput {
  id: string
  /** 柜次装柜日期（ISO 日期），与柜次名称中的月日一致。 */
  loadingDate: string
  sequenceInDay: number
  items: readonly SlhBillContainerItemInput[]
}

export interface SlhBillLineMatchInput {
  lineId: string
  /** 该明细行的装柜日期，是定位年份的唯一来源。 */
  loadingDate: string
  /** 账单「柜号」列原文。 */
  containerBatchText: string | null
  /** 账单「嘜頭」列原文。 */
  shippingMarkText: string | null
}

export interface SlhBillLineMatchResult {
  lineId: string
  status: 'MATCHED' | 'UNMATCHED'
  source: SlhBillLineMatchSource | null
  loadingItemId: string | null
  reason: SlhBillLineUnmatchedReason | null
}

/** 柜号解析结果：月日 + 当日柜次序号（缺省 1）。 */
export interface SlhBillContainerCycle {
  month: number
  day: number
  sequenceInDay: number
}

/** 全角数字、全角连字符与全角空格在账单里很常见，先做兼容性归一化再解析。 */
function toHalfWidth(value: string): string {
  return value.normalize('NFKC')
}

function normalizeReferenceText(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const normalized = toHalfWidth(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return normalized === '' ? null : normalized
}

/** 唛头比较用归一化：忽略大小写与空白差异，不改动落库原值。 */
function normalizeMark(value: string | null): string | null {
  const normalized = normalizeReferenceText(value)
  return normalized === null ? null : normalized.replace(/\s+/gu, '').toUpperCase()
}

function resolveYear(loadingDate: string): number | null {
  const matched = loadingDate.match(/^(\d{4})-\d{2}-\d{2}$/u)
  if (matched === null) {
    return null
  }
  const year = Number(matched[1])
  return Number.isSafeInteger(year) && year >= 1900 && year <= 9999 ? year : null
}

/** 用明细行的年份与解析出的月日拼出真实存在的日期；2 月 30 日这类组合判为不可用。 */
function composeDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

/** 解析账单柜号：接受 `MMDD柜` / `MMDD-NN柜`，也容忍缺「柜」字与全角写法。 */
export function parseContainerCycle(value: string | null): SlhBillContainerCycle | null {
  const text = normalizeReferenceText(value)?.replace(/櫃/gu, '柜')
  if (text === undefined || text === null) {
    return null
  }
  // 前导非数字 + 结尾非数字两处边界，避免把 5 位以上的序列号（如 Excel 日期序列 46002）切成月日。
  const matched = text.match(/(?:^|\D)(\d{2})(\d{2})(?:-(\d{2}))?柜?(?:子)?(?!\d)/u)
  if (matched === null) {
    return null
  }
  const month = Number(matched[1])
  const day = Number(matched[2])
  const sequenceInDay = Number(matched[3] ?? 1)
  if (month < 1 || month > 12 || day < 1 || day > 31 || sequenceInDay < 1 || sequenceInDay > 99) {
    return null
  }
  return { month, day, sequenceInDay }
}

/** 从唛头推断月日：取连字符（含全角与长短横）后的四位数字，如 `J-022634` → 2 月 26 日。 */
export function parseShippingMarkCycle(value: string | null): { month: number, day: number } | null {
  const text = normalizeReferenceText(value)
  if (text === null) {
    return null
  }
  const matched = text.match(/[-–—]\s*(\d{2})(\d{2})/u)
  if (matched === null) {
    return null
  }
  const month = Number(matched[1])
  const day = Number(matched[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  return { month, day }
}

/**
 * 需要预加载的柜次日期集合：名称路径与唛头路径可能的日期并集。
 * 服务端据此一次查库，规则判定仍只在 matchSlhBillLines 里进行。
 */
export function collectContainerCandidateDates(lines: readonly SlhBillLineMatchInput[]): string[] {
  const dates = new Set<string>()
  for (const line of lines) {
    const year = resolveYear(line.loadingDate)
    if (year === null) {
      continue
    }
    const nameCycle = parseContainerCycle(line.containerBatchText)
    if (nameCycle !== null) {
      const date = composeDate(year, nameCycle.month, nameCycle.day)
      if (date !== null) {
        dates.add(date)
      }
    }
    const markCycle = parseShippingMarkCycle(line.shippingMarkText)
    if (markCycle !== null) {
      const date = composeDate(year, markCycle.month, markCycle.day)
      if (date !== null) {
        dates.add(date)
      }
    }
  }
  return [...dates].sort()
}

function unmatched(lineId: string, reason: SlhBillLineUnmatchedReason): SlhBillLineMatchResult {
  return { lineId, status: 'UNMATCHED', source: null, loadingItemId: null, reason }
}

/**
 * 合格三条件：有货件匹配、有采购来源、有销售来源。
 * 匹配与「确认核对」前的复检共用这一处判定，避免两边口径漂移。
 */
export function resolveLoadingItemIneligibility(item: SlhBillContainerItemInput): SlhBillLineUnmatchedReason | null {
  if (item.shipment === null) {
    return 'SHIPMENT_NOT_MATCHED'
  }
  // 采购来源在库结构上必填（货件必有采购订单），此处仍显式判定，规则不依赖库表形状。
  if (item.shipment.purchaseOrderId === null || item.shipment.purchaseOrderId === '') {
    return 'PURCHASE_SOURCE_MISSING'
  }
  if (item.shipment.salesOrderId === null || item.shipment.salesOrderId === '') {
    return 'SALES_SOURCE_MISSING'
  }
  return null
}

/** 找不到柜次时区分「根本没有可用的月日参照」与「有参照但没有对应柜次」。 */
function resolveUnlocatedReason(line: SlhBillLineMatchInput, nameCycle: SlhBillContainerCycle | null): SlhBillLineUnmatchedReason {
  if (nameCycle === null && parseShippingMarkCycle(line.shippingMarkText) === null) {
    return normalizeReferenceText(line.containerBatchText) === null ? 'MISSING_CONTAINER_REFERENCE' : 'INVALID_CONTAINER_NAME'
  }
  return 'CONTAINER_NOT_FOUND'
}

function matchLine(line: SlhBillLineMatchInput, containers: readonly SlhBillContainerBatchInput[]): SlhBillLineMatchResult {
  const year = resolveYear(line.loadingDate)
  const nameCycle = parseContainerCycle(line.containerBatchText)
  let located: SlhBillContainerBatchInput | null = null
  let source: SlhBillLineMatchSource | null = null

  if (year !== null && nameCycle !== null) {
    const date = composeDate(year, nameCycle.month, nameCycle.day)
    if (date !== null) {
      const found = containers.filter(candidate => candidate.loadingDate === date && candidate.sequenceInDay === nameCycle.sequenceInDay)
      if (found.length > 1) {
        return unmatched(line.lineId, 'CONTAINER_AMBIGUOUS')
      }
      if (found.length === 1) {
        located = found[0]!
        source = 'NAME'
      }
    }
  }

  if (located === null && year !== null) {
    const markCycle = parseShippingMarkCycle(line.shippingMarkText)
    if (markCycle !== null) {
      const date = composeDate(year, markCycle.month, markCycle.day)
      if (date !== null) {
        // 唛头只带月日，柜次序号按 1；序号不为 1 的柜次要靠名称路径命中。
        const found = containers.filter(candidate => candidate.loadingDate === date && candidate.sequenceInDay === 1)
        if (found.length > 1) {
          return unmatched(line.lineId, 'CONTAINER_AMBIGUOUS')
        }
        if (found.length === 1) {
          located = found[0]!
          source = 'MARK'
        }
      }
    }
  }

  if (located === null || source === null) {
    return unmatched(line.lineId, resolveUnlocatedReason(line, nameCycle))
  }

  const mark = normalizeMark(line.shippingMarkText)
  if (mark === null) {
    return unmatched(line.lineId, 'MISSING_SHIPPING_MARK')
  }
  const matchedItems = located.items.filter(item => normalizeMark(item.oceanShippingMarkText) === mark)
  if (matchedItems.length === 0) {
    return unmatched(line.lineId, 'MARK_NOT_FOUND_IN_CONTAINER')
  }
  if (matchedItems.length > 1) {
    return unmatched(line.lineId, 'LOADING_ITEM_AMBIGUOUS')
  }

  const item = matchedItems[0]
  const ineligibility = resolveLoadingItemIneligibility(item)
  if (ineligibility !== null) {
    return unmatched(line.lineId, ineligibility)
  }
  return { lineId: line.lineId, status: 'MATCHED', source, loadingItemId: item.id, reason: null }
}

/** 批量匹配；结果与入参顺序一一对应。 */
export function matchSlhBillLines(input: {
  lines: readonly SlhBillLineMatchInput[]
  containers: readonly SlhBillContainerBatchInput[]
}): SlhBillLineMatchResult[] {
  return input.lines.map(line => matchLine(line, input.containers))
}
