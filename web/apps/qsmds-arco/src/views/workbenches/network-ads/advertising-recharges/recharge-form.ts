import type { AdvertisingRechargeStatus } from './logic'
import type { CurrencyDescriptor } from '@/components/base/currency'
import {
  ADVERTISING_RECHARGE_CURRENCY_OPTIONS,

} from './logic'

/**
 * 充值币种固定为美元与人民币两种，且都要可选：
 * 货币目录的 `enabled` 表达的是汇率可用性，不能拿它限制本业务的币种选择，
 * 因此在本地把这两个币种显式置为可选，其余目录字段仍取真实目录。
 */
export function resolveRechargeCurrencies(catalog: readonly CurrencyDescriptor[]): CurrencyDescriptor[] {
  const byCode = new Map(catalog.map(currency => [currency.code, currency]))
  return ADVERTISING_RECHARGE_CURRENCY_OPTIONS.map((code) => {
    const descriptor = byCode.get(code)
    return {
      code,
      enabled: true,
      minorUnit: descriptor?.minorUnit ?? 2,
      name: descriptor?.name ?? code,
      symbol: descriptor?.symbol ?? null,
    }
  })
}

/** 财务实付固定人民币；同样不受货币目录 enabled 影响。 */
export function resolvePaymentCurrencies(catalog: readonly CurrencyDescriptor[]): CurrencyDescriptor[] {
  const descriptor = catalog.find(currency => currency.code === 'CNY')
  return [{
    code: 'CNY',
    enabled: true,
    minorUnit: descriptor?.minorUnit ?? 2,
    name: descriptor?.name ?? 'CNY',
    symbol: descriptor?.symbol ?? null,
  }]
}

/** 运营列表与财务列表共用的状态计数归一：ALL 由各状态求和，避免多取一次列表。 */
export function sumAdvertisingRechargeCounts(
  counts: readonly { status: AdvertisingRechargeStatus, count: number }[],
): Record<string, number> {
  const result: Record<string, number> = {}
  let all = 0
  for (const entry of counts) {
    result[entry.status] = entry.count
    all += entry.count
  }
  result.ALL = all
  return result
}

export const ADVERTISING_RECHARGE_REQUIRED_FIELDS = [
  'adAccountName',
  'adAccountNo',
  'rechargeAmount',
  'paymentQr',
] as const
export type AdvertisingRechargeRequiredField = (typeof ADVERTISING_RECHARGE_REQUIRED_FIELDS)[number]

export interface AdvertisingRechargePasteResult {
  readonly adAccountName: string | null
  readonly adAccountNo: string | null
  /** 首行是纯数字且与标签后的编号不同：名称按首行、编号按标签行，需要人工核对。 */
  readonly conflictingNumbers: boolean
}

const PASTE_LABEL_PATTERN = /(?:广告|廣告)\s*(?:账户|帳戶|帐号|帳號|账号)\s*(?:编号|編號)/u
const PASTE_SHORT_LABEL_PATTERN = /编号|編號/u
/** 标题类文字（广告账户信息、账户编号等）不能当名称。 */
const PASTE_HEADING_PATTERN = /广告|廣告|账户|帳戶|帐号|帳號|编号|編號/u
const PASTE_NAME_MAX_LENGTH = 128
const PASTE_NUMBER_PATTERN = /^\d{6,32}$/u
/** 没有编号时，只有像账户编码的单行才当名称，避免误粘贴一段普通文字就填进表单。 */
const PASTE_NAME_ONLY_PATTERN = /^[A-Za-z0-9][\w.-]{0,127}$/u

/** 全角冒号/字母统一、清掉零宽字符与空行；粘贴内容的行结构是解析依据。 */
function normalizePasteLines(input: string): string[] {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => line.replace(/[\u200B-\u200D\uFEFF]/gu, '').trim())
    .filter(line => line.length > 0)
}

/** 去掉空格/连字符后是 6–32 位纯数字才算编号，避免把名称里的数字当账户 id。 */
function digitsOf(line: string): string | null {
  const digits = line.replace(/[\s-]/gu, '')
  return PASTE_NUMBER_PATTERN.test(digits) ? digits : null
}

/** 标签后的数字：先剥掉标签本身，避免把标签里偶然出现的数字带进结果。 */
function labeledNumber(line: string): string | null {
  const label = line.match(PASTE_LABEL_PATTERN) ?? line.match(PASTE_SHORT_LABEL_PATTERN)
  if (label === null || label.index === undefined) {
    return null
  }
  const tail = line.slice(label.index + label[0].length)
  const digits = tail.match(/\d[\d\s-]*/u)
  return digits === null ? null : digitsOf(digits[0])
}

/**
 * 解析运营从广告后台/群聊里复制的内容。格式不要求名称是固定编码：
 * - 首行是名称（即使它是纯数字，也按用户约定当作名称）；
 * - 编号优先取「廣告帳號編號：」这类标签后的数字，没有标签时取纯数字行；
 * - 只有单独一行标签时只得到编号，只有一行编码时只得到名称。
 */
export function parseAdvertisingRechargePaste(input: string): AdvertisingRechargePasteResult {
  const lines = normalizePasteLines(input)
  if (lines.length === 0) {
    return { adAccountName: null, adAccountNo: null, conflictingNumbers: false }
  }

  let number: string | null = null
  let numberLineIndex = -1
  for (const [index, line] of lines.entries()) {
    const candidate = labeledNumber(line)
    if (candidate !== null) {
      number = candidate
      numberLineIndex = index
      break
    }
  }
  if (number === null) {
    for (const [index, line] of lines.entries()) {
      const candidate = digitsOf(line)
      if (candidate !== null) {
        number = candidate
        numberLineIndex = index
        break
      }
    }
  }

  const nameLineIndex = lines.findIndex((line, index) => (
    index !== numberLineIndex
    && !PASTE_HEADING_PATTERN.test(line)
    && !line.endsWith(':')
  ))
  const nameCandidate = nameLineIndex === -1 ? null : lines[nameLineIndex]!
  const name = nameCandidate !== null
    && (number !== null || PASTE_NAME_ONLY_PATTERN.test(nameCandidate))
    ? nameCandidate.slice(0, PASTE_NAME_MAX_LENGTH)
    : null
  const nameDigits = name === null ? null : digitsOf(name)

  return {
    adAccountName: name,
    adAccountNo: number,
    conflictingNumbers: Boolean(
      nameDigits !== null
      && number !== null
      && nameDigits !== number,
    ),
  }
}

/**
 * 提交前只判断「视觉上真正缺失」的字段：金额用规范化文本判断，个人户才要求二维码。
 * 返回稳定顺序，调用方据此聚焦第一个缺失项并给出汇总提示；金额的精度等格式问题
 * 由服务端校验兜底，避免前端复制一遍金额规则。
 */
export function resolveAdvertisingRechargeMissingFields(input: {
  readonly accountType: 'PERSONAL' | 'NON_PERSONAL'
  readonly adAccountName: string
  readonly adAccountNo: string
  readonly rechargeAmount: string | null
  readonly paymentQrMediaAssetId: string | null
}): AdvertisingRechargeRequiredField[] {
  const missing: AdvertisingRechargeRequiredField[] = []
  if (input.adAccountName.trim().length === 0) {
    missing.push('adAccountName')
  }
  if (input.adAccountNo.trim().length === 0) {
    missing.push('adAccountNo')
  }
  if (input.rechargeAmount === null || input.rechargeAmount.trim().length === 0) {
    missing.push('rechargeAmount')
  }
  if (input.accountType === 'PERSONAL' && input.paymentQrMediaAssetId === null) {
    missing.push('paymentQr')
  }
  return missing
}
