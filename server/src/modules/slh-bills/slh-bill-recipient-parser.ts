/**
 * 顺联航账单「收货人信息」解析器。
 *
 * 账单把收货人信息混在一行纯文本里，没有稳定分隔符：**地址 → 电话 → 姓名**（样本 53/53 行
 * 都是这个顺序）。门牌号（`37-22號`、`1666-1號`）与电话号码形态相近，因此解析顺序是：
 *
 * 1. 归一化（NFKC、折叠"整串恰好重复两遍"）；
 * 2. 扫号码片段，**先排除紧跟地址单位的片段**（`號` 只说明它前面的数字是门牌，不代表后面还有地址）；
 * 3. 把号码归一化成**国家有效号码（NSI）**后按两种形态校验（手机 9 位首 9 / 市话 8–9 位首 2–8），
 *    国际写法（`+886`、`886`、`002886`）与括号区号 `(07)` 都归一到同一形态；
 * 4. 第一个号码起点 = 地址右界，最后一个号码终点 = 姓名左界；地址尾部「姓名 + 收/称谓」归位到姓名。
 *
 * 判不了就留空、不猜：宁可字段为空，也不把门牌或地名写进电话字段。
 */

/** 紧跟这些字符的数字串属于地址（门牌/巷弄/里程），不是电话。 */
const ADDRESS_UNIT_AFTER = new Set('號号樓楼層层巷弄鄰邻段米附之村里鎮镇鄉乡區区市縣县路街')

/** 号码片段：允许 `(07)` 括号区号前缀；数字之间允许小数点与连字符/斜杠/顿号/逗号。 */
const NUMBER_RUN = /(?:[（(]\s*\d{1,4}\s*[)）])?\+?\d+(?:[.．]\d+)?(?:[-‑–—/／、，,]\d+(?:[.．]\d+)?)*/gu

/** 号码组内的号码分隔符。 */
const NUMBER_SEPARATORS = /[/／、，,]/u

/** 国际写法允许出现在号码内部的字符（空格分组必须支持：`+886 933 409583`）。 */
const INTERNATIONAL_CHARS = new Set('0123456789+')
const SEPARATOR_CHARS = new Set('-‑–—/／、，,()（）.．')
const SPACES = new Set(' \t\u3000')

/** 台湾的国际冠码是 002–009 / 019，不是简单的两个 0。 */
const IDD_PREFIX = /^(?:00[2-9]|019|00)/u
const INTERNATIONAL_LEAD = /^(?:\+|00)/u
const MOBILE_NSI = /^9\d{8}$/u
const LANDLINE_NSI = /^[2-8]\d{6,8}$/u

/** 紧跟 `號/号` 之后的收件人标记：`X收` 有样本，称谓按需求补充。 */
const ADDRESS_TAIL_RECEIVER = /(?<=[號号])([\u4E00-\u9FA5A-Za-z]{1,8}(?:收|先生|小姐|女士|太太))$/u

/** 号码片段至少这么多位数字才作为候选，用来挡掉 `附1`、`4鄰` 这类。 */
const MIN_CANDIDATE_DIGITS = 4

/** 号码/地址两端可安全去掉的分隔符。 */
const TRIM_EDGE = /^[\s\-‑–—/／、，,]+|[\s\-‑–—/／、，,]+$/gu

export interface SlhBillRecipient {
  recipientName: string | null
  /** 原文区间（含原分隔符与括号），多个号码整段保留。 */
  recipientPhones: string | null
  recipientAddress: string | null
}

interface NumberToken {
  text: string
  start: number
  end: number
}

function digitsOf(value: string): string {
  return value.replace(/\D/gu, '')
}

/**
 * 归一化成国家有效号码：去符号 → 国际写法去冠码与 886 → **去前导 0（两种写法都要做）**。
 */
export function toNationalSignificantNumber(token: string): string {
  let digits = digitsOf(token)
  if (INTERNATIONAL_LEAD.test(token.trimStart()) || digits.startsWith('00')) {
    digits = digits.replace(IDD_PREFIX, '')
    if (digits.startsWith('886')) {
      digits = digits.slice(3)
    }
  }
  return digits.replace(/^0+/u, '')
}

function isPhoneNsi(nsi: string): boolean {
  return MOBILE_NSI.test(nsi) || LANDLINE_NSI.test(nsi)
}

function scanNumberTokens(text: string): NumberToken[] {
  const tokens: NumberToken[] = []
  for (const match of text.matchAll(NUMBER_RUN)) {
    const start = match.index ?? 0
    const candidate = match[0].replace(/[-‑–—/／、，,()（） ]+$/u, '')
    const digits = digitsOf(candidate)
    // `+`/`00` 开头的片段允许少于下限：国际号码可能被空格拆成 `+886 933 409583`。
    if (digits.length < MIN_CANDIDATE_DIGITS && !INTERNATIONAL_LEAD.test(candidate.trimStart())) {
      continue
    }
    tokens.push({ end: start + candidate.length, start, text: candidate })
  }
  return tokens
}

/**
 * 单个号码的 NSI：先按本地/省区号写法解释，不合法再按"遗留的 886 前缀"解释。
 * 先本地后国际是刻意的：`08-86331234` 的本地 NSI 恰好以 886 开头，先国际会被误解。
 */
function resolveSingleNumber(token: string): string | null {
  const local = toNationalSignificantNumber(token)
  if (isPhoneNsi(local)) {
    return local
  }
  const digits = digitsOf(token).replace(/^0+/u, '')
  if (digits.startsWith('886')) {
    const withoutCountryCode = digits.slice(3).replace(/^0+/u, '')
    if (isPhoneNsi(withoutCountryCode)) {
      return withoutCountryCode
    }
  }
  return null
}

/** 号码组内每个号码都要能独立判为电话：`0933-409583/0926-343555` 不能整串一起判。 */
function resolvePhoneGroup(token: string): { ok: boolean } {
  const parts = token.split(NUMBER_SEPARATORS).filter(part => part !== '')
  const numbers = parts.length > 0 ? parts : [token]
  return { ok: numbers.every(part => resolveSingleNumber(part) !== null) }
}

/**
 * 国际写法整段摄取：从 `+`/`00` 起连续吃数字/分隔符/空格，直到遇到其它字符。
 * 不能依赖号码片段扫描——`+886 933 409583` 中间的 `933` 只有 3 位，会低于片段下限。
 */
function absorbInternational(text: string, start: number): string {
  let cursor = start
  while (cursor < text.length) {
    const char = text[cursor] ?? ''
    if (!INTERNATIONAL_CHARS.has(char) && !SEPARATOR_CHARS.has(char) && !SPACES.has(char)) {
      break
    }
    cursor += 1
  }
  let end = cursor
  while (end > start) {
    const char = text[end - 1] ?? ''
    if (!SEPARATOR_CHARS.has(char) && !SPACES.has(char)) {
      break
    }
    end -= 1
  }
  return text.slice(start, end)
}

function endsAtAddressUnit(text: string, position: number): boolean {
  return ADDRESS_UNIT_AFTER.has(text[position] ?? '')
}

function trimEdges(value: string): string {
  return value.replace(TRIM_EDGE, '')
}

/** 整串恰好重复两遍时折叠成一遍（`測試倉庫測試倉庫` → `測試倉庫`）；不做模糊去重。 */
function collapseWholeRepeat(value: string): string {
  const half = value.length / 2
  if (Number.isInteger(half) && value.slice(0, half) === value.slice(half)) {
    return value.slice(0, half)
  }
  return value
}

export function parseSlhBillRecipient(raw: string | null | undefined): SlhBillRecipient {
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') {
    return { recipientAddress: null, recipientName: null, recipientPhones: null }
  }
  const text = collapseWholeRepeat(trimmed.normalize('NFKC'))
  const tokens = scanNumberTokens(text)

  const phoneSpans: Array<{ end: number, start: number }> = []
  let cursor = 0
  while (cursor < tokens.length) {
    const token = tokens[cursor]
    if (INTERNATIONAL_LEAD.test(token.text.trimStart())) {
      // 国际写法：先按原文整段摄取（含空格分组），再用归一化结果校验。
      const span = absorbInternational(text, token.start)
      const end = token.start + span.length
      if (isPhoneNsi(toNationalSignificantNumber(span)) && !endsAtAddressUnit(text, end)) {
        phoneSpans.push({ end, start: token.start })
        cursor += 1
        while (cursor < tokens.length && (tokens[cursor]).start < end) {
          cursor += 1
        }
        continue
      }
    }
    else if (resolvePhoneGroup(token.text).ok && !endsAtAddressUnit(text, token.end)) {
      phoneSpans.push({ end: token.end, start: token.start })
      cursor += 1
      continue
    }
    cursor += 1
  }

  if (phoneSpans.length === 0) {
    // 有数字但没有合法号码：整串留存到地址，姓名与电话留空，由上层标记"待确认"。
    return { recipientAddress: text, recipientName: null, recipientPhones: null }
  }

  const first = phoneSpans[0]
  const last = phoneSpans[phoneSpans.length - 1]
  let address = trimEdges(text.slice(0, first.start))
  const name = trimEdges(text.slice(last.end))
  const phones = text.slice(first.start, last.end)

  // 地址尾部出现「姓名 + 收/称谓」时把它从地址里摘出来（样本：`…21號王小明收915000000王小明`）。
  const tail = address.match(ADDRESS_TAIL_RECEIVER)
  const movedName = tail?.[1] ?? null
  if (tail && tail.index !== undefined) {
    address = trimEdges(address.slice(0, tail.index))
  }

  return {
    recipientAddress: address === '' ? null : address,
    recipientName: (name === '' ? movedName : name) ?? null,
    recipientPhones: phones === '' ? null : phones,
  }
}
