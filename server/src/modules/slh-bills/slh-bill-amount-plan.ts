/**
 * 账单金额空值回填的判定：只决定「哪些单元格该从 0.00 改成 NULL」，不碰 I/O。
 *
 * 为什么必须重新解析原件：`source_data` 只保留行内单元格（按单元格引用），没有「字段 → 列」映射，
 * 而旧口径把空单元格与来源里的显式 0 都写成 0.00——单看库里已经无法区分。所以判定改为
 * 「库里现值 vs 重解析值」逐格比对：库里 0.00 且重解析为空 → 空单元格，改 NULL；
 * 库里 0.00 且重解析也是 0 → 来源里真的写了零，保持 0.00。
 *
 * 任何一格对不上都整张账单跳过（不猜、不部分写入），交由调用方人工介入。
 */

/** 空值口径涉及的六列；与迁移 20260930190000 放宽 NOT NULL 的范围一致。 */
export const SLH_BILL_AMOUNT_COLUMNS = [
  'freightAmountCny', 'codHandlingAmountCny', 'surchargeAmountCny',
  'payableAmountCny', 'codAmountTwd', 'ntdSurchargeAmountTwd',
] as const

export type SlhBillAmountColumn = typeof SLH_BILL_AMOUNT_COLUMNS[number]
export type SlhBillAmountValues = Record<SlhBillAmountColumn, string | null>

export interface SlhBillAmountStoredLine {
  readonly id: string
  readonly lineNumber: number
  readonly sourceRowNumber: number
  readonly values: SlhBillAmountValues
}

export interface SlhBillAmountParsedLine {
  readonly lineNumber: number
  readonly sourceRowNumber: number
  readonly values: SlhBillAmountValues
}

export type SlhBillAmountSkipReason =
  | 'LINE_COUNT_MISMATCH'
  | 'LINE_IDENTITY_MISMATCH'
  | 'STORED_VALUE_INVALID'
  | 'PARSED_VALUE_INVALID'
  | 'VALUE_MISMATCH'
  | 'STORED_NULL_WITH_PARSED_VALUE'

export interface SlhBillAmountUpdate {
  readonly lineId: string
  readonly lineNumber: number
  readonly columns: readonly SlhBillAmountColumn[]
  /** 变更前的六列原值（已归一为两位小数），写入回滚文件用。 */
  readonly previous: SlhBillAmountValues
}

export interface SlhBillAmountPlan {
  readonly updates: readonly SlhBillAmountUpdate[]
  /** 旧口径写成 0.00、重解析为空 → 待改 NULL 的单元格数。 */
  readonly blankToNull: number
  /** 来源里确实是 0、库里也是 0.00 → 保持不动的单元格数。 */
  readonly explicitZeroKept: number
  /** 两侧一致且非零的单元格数。 */
  readonly unchanged: number
  readonly skip: SlhBillAmountSkipReason | null
}

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u
const ZERO = '0.00'

/** 归一结果用显式 ok 区分「空」与「非法」，避免把异常值当成空值静默改 NULL。 */
type NormalizedAmount = { readonly ok: true, readonly value: string | null } | { readonly ok: false }

/** 归一为两位小数字符串：空串按 null，整数补 .00，超过两位且非零的小数视为非法。 */
export function normalizeSlhBillAmount(raw: string | null): NormalizedAmount {
  if (raw === null) return { ok: true, value: null }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!DECIMAL_PATTERN.test(trimmed)) return { ok: false }
  const [whole, fraction = ''] = trimmed.split('.')
  if (fraction.length > 2 && !/^0*$/u.test(fraction.slice(2))) return { ok: false }
  return { ok: true, value: `${whole}.${`${fraction}00`.slice(0, 2)}` }
}

function emptyPlan(skip: SlhBillAmountSkipReason): SlhBillAmountPlan {
  return { blankToNull: 0, explicitZeroKept: 0, skip, unchanged: 0, updates: [] }
}

/**
 * 逐行逐列比对库内现值与重解析值，产出待改单元格。
 * 行身份按 (行号, 原表行号) 双键对齐：任一缺失或错位即整张跳过，避免把 A 行的空值写到 B 行。
 */
export function planSlhBillAmountBackfill(input: {
  readonly stored: readonly SlhBillAmountStoredLine[]
  readonly parsed: readonly SlhBillAmountParsedLine[]
}): SlhBillAmountPlan {
  if (input.stored.length !== input.parsed.length) return emptyPlan('LINE_COUNT_MISMATCH')
  const parsedByLineNumber = new Map(input.parsed.map(line => [line.lineNumber, line]))
  if (parsedByLineNumber.size !== input.parsed.length) return emptyPlan('LINE_IDENTITY_MISMATCH')

  const updates: SlhBillAmountUpdate[] = []
  let blankToNull = 0
  let explicitZeroKept = 0
  let unchanged = 0

  for (const storedLine of input.stored) {
    const parsedLine = parsedByLineNumber.get(storedLine.lineNumber)
    if (!parsedLine || parsedLine.sourceRowNumber !== storedLine.sourceRowNumber) return emptyPlan('LINE_IDENTITY_MISMATCH')

    const columns: SlhBillAmountColumn[] = []
    const previous: Partial<SlhBillAmountValues> = {}
    for (const column of SLH_BILL_AMOUNT_COLUMNS) {
      const stored = normalizeSlhBillAmount(storedLine.values[column])
      if (!stored.ok) return emptyPlan('STORED_VALUE_INVALID')
      const parsed = normalizeSlhBillAmount(parsedLine.values[column])
      if (!parsed.ok) return emptyPlan('PARSED_VALUE_INVALID')
      previous[column] = stored.value

      if (stored.value === null) {
        // 库里已是 NULL：重解析也必须是空，否则说明文件或解析器已变，不能继续。
        if (parsed.value !== null) return emptyPlan('STORED_NULL_WITH_PARSED_VALUE')
        continue
      }
      if (parsed.value === null) {
        // 只有「库里是 0.00」才可能是旧口径的空单元格；非零值对不上说明数据已变。
        if (stored.value !== ZERO) return emptyPlan('VALUE_MISMATCH')
        columns.push(column)
        blankToNull += 1
        continue
      }
      if (stored.value !== parsed.value) return emptyPlan('VALUE_MISMATCH')
      if (stored.value === ZERO) explicitZeroKept += 1
      else unchanged += 1
    }

    if (columns.length > 0) {
      updates.push({ columns, lineId: storedLine.id, lineNumber: storedLine.lineNumber, previous: previous as SlhBillAmountValues })
    }
  }

  return { blankToNull, explicitZeroKept, skip: null, unchanged, updates }
}
