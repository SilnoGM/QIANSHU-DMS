import { formatDecimal, parseDecimal } from '../ocean-freight-calculation/ocean-decimal'
import { SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, slhNormalizeAmount } from './slh-bill-calculation'

export type SlhChargeTypeValue =
  | 'FREIGHT' | 'COD_HANDLING' | 'HEAVY_CARGO' | 'DELIVERY' | 'REDELIVERY' | 'TRANSFER_DELIVERY'
  | 'REMOTE_AREA' | 'UNLOADING' | 'STORAGE' | 'WAITING' | 'OVERSIZE' | 'INSPECTION' | 'FORKLIFT'
  | 'MINIMUM_CHARGE' | 'OTHER'

export type SlhChargeCurrency = 'CNY' | 'TWD'

export interface SlhParsedCharge {
  chargeType: SlhChargeTypeValue
  currencyCode: SlhChargeCurrency
  amount: string
  sourceRemarkText: string
}

export interface SlhParsedRemarks {
  charges: SlhParsedCharge[]
  /** 没有金额、因而不能成为费用明细的文本片段；保留原文供人工核对。 */
  notes: string[]
}

/**
 * 费别关键词。顺联航备注在繁简与写法上都不统一（寄仓费/寄倉費、等待費/等待费），
 * 因此同一费别登记多个别名；匹配取金额之前最近的一个关键词。
 */
const CHARGE_KEYWORDS: ReadonlyArray<readonly [SlhChargeTypeValue, readonly string[]]> = [
  ['COD_HANDLING', ['代收手续费', '代收手續費']],
  ['TRANSFER_DELIVERY', ['转派费', '轉派費']],
  ['REDELIVERY', ['二次派送费', '二次派送費', '二派费', '二派費']],
  ['HEAVY_CARGO', ['重货费', '重貨費']],
  ['DELIVERY', ['派送费', '派送費']],
  ['REMOTE_AREA', ['偏远费', '偏遠費']],
  ['UNLOADING', ['卸货费', '卸貨費']],
  ['STORAGE', ['寄仓费', '寄倉費', '仓储费', '倉儲費']],
  ['WAITING', ['等待费', '等待費']],
  ['OVERSIZE', ['超尺寸费', '超尺寸費', '超尺费', '超尺費']],
  ['INSPECTION', ['验机费', '驗機費']],
  ['FORKLIFT', ['堆高机费', '堆高機費', '堆高机', '堆高機']],
  ['MINIMUM_CHARGE', ['最低消费', '最低消費', '低消']],
]

const AMOUNT_PATTERN = /\d+(?:\.\d+)?/gu
/** 金额后缀的单位只影响币种判定，不参与金额本身。 */
const CURRENCY_MARKERS: ReadonlyArray<readonly [SlhChargeCurrency, readonly string[]]> = [
  ['TWD', ['NTD', 'NT$', 'NT', '台币', '台幣', '新台币', '新台幣']],
  ['CNY', ['RMB', '人民币', '人民幣', '元']],
]

function lastKeyword(segment: string): { type: SlhChargeTypeValue, index: number } | null {
  let found: { type: SlhChargeTypeValue, index: number } | null = null
  for (const [type, aliases] of CHARGE_KEYWORDS) {
    for (const alias of aliases) {
      const index = segment.lastIndexOf(alias)
      if (index >= 0 && (found === null || index > found.index)) found = { type, index }
    }
  }
  return found
}

/** 读出紧跟金额的币种标记及其长度，便于跳过标记而不把它当作下一个费别的上下文。 */
function currencyAt(remark: string, endIndex: number): { currencyCode: SlhChargeCurrency, length: number } {
  const window = remark.slice(endIndex, endIndex + 8).toUpperCase()
  for (const [currencyCode, markers] of CURRENCY_MARKERS) {
    for (const marker of markers) {
      if (window.startsWith(marker.toUpperCase())) return { currencyCode, length: marker.length }
    }
  }
  // 账单里没有单位标记的附加费一律是人民币（对方把 NTD 金额都标了 NT 或台币）。
  return { currencyCode: 'CNY', length: 0 }
}

/**
 * 按备注原文拆解费用明细。
 *
 * 只对带金额的片段生成费用行：费别取该金额之前最近的一个关键词，找不到费别时记为「其他」
 * 并保留原文。没有金额的片段（如「优待免收低消」）作为说明保留，不生成金额为零的费用行。
 */
export function parseSlhRemarks(remark: string | null): SlhParsedRemarks {
  const charges: SlhParsedCharge[] = []
  const notes: string[] = []
  if (remark === null || remark.trim() === '') return { charges, notes }

  let boundary = 0
  for (const amount of remark.matchAll(AMOUNT_PATTERN)) {
    const start = amount.index ?? 0
    const end = start + amount[0].length
    const segment = remark.slice(boundary, start)
    const keyword = lastKeyword(segment)
    const { currencyCode, length } = currencyAt(remark, end)
    charges.push({
      chargeType: keyword?.type ?? 'OTHER',
      currencyCode,
      amount: slhNormalizeAmount(amount[0]),
      sourceRemarkText: remark.slice(boundary, end + length).trim(),
    })
    // 关键词之前的文字（如「补」）是性质说明而不是费别，保留为说明。
    const prefix = segment.slice(0, keyword?.index ?? segment.length).trim()
    if (prefix) notes.push(prefix)
    boundary = end + length
  }

  const trailing = remark.slice(boundary).trim()
  if (trailing) notes.push(trailing)
  return { charges, notes }
}

/** 每个币种的费用合计；用于与账单聚合列做完整性比对。 */
export function sumSlhCharges(charges: readonly SlhParsedCharge[], currencyCode: SlhChargeCurrency): string {
  return formatDecimal(
    charges.filter(charge => charge.currencyCode === currencyCode)
      .reduce((sum, charge) => sum + parseDecimal(charge.amount, SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'amount', true), 0n),
    SLH_AMOUNT_PRECISION, SLH_AMOUNT_SCALE, 'chargeTotal',
  )
}
