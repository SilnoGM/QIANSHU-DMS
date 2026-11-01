/**
 * 资金来源快照：只服务流水列表/详情的展示与检索，属于可重建的派生数据。
 *
 * 分类由 (sourceCode, consumerCode) 派生，业务调用方只提供内容、不能自报分类，
 * 否则同一业务在不同调用点会被标成不同来源（ORDER_SETTLEMENT 同时服务销售收款
 * 与顺联航账单结算，只按业务类型判定必然混淆）。
 *
 * detail 只接受 {label, value} 标量数组：读取端不必解析任意 JSON，也不会把
 * 批次 metadata 原样透出给运营。
 */
import type { FundPostingSourceKind } from '../../../generated/prisma/client'
import {
  FUND_POSTING_ERROR_CODES,
  FundPostingError,
} from './fund-posting.errors'

export const FUND_SOURCE_KINDS = [
  'SALES_RECEIPT',
  'PURCHASE_PAYMENT',
  'PACKAGING_COST',
  'INVOICE_REQUEST',
  'SHIPMENT_STORAGE',
  'SLH_SETTLEMENT',
  'SLH_FEE',
  'SLH_COMPANY_ALLOCATION',
  'WITHDRAWAL',
  'MANUAL_ADJUSTMENT',
  'REVERSAL',
  'UNRESOLVED',
] as const satisfies readonly FundPostingSourceKind[]

export type FundSourceKind = (typeof FUND_SOURCE_KINDS)[number]

export const FUND_SOURCE_MAXIMUM_DETAIL_ITEMS = 20
export const FUND_SOURCE_HEADLINE_MAXIMUM_CODE_POINTS = 200
export const FUND_SOURCE_NAME_MAXIMUM_CODE_POINTS = 128
export const FUND_SOURCE_DETAIL_LABEL_MAXIMUM_CODE_POINTS = 40
export const FUND_SOURCE_DETAIL_VALUE_MAXIMUM_CODE_POINTS = 200

export interface FundSourceDetailItem {
  readonly label: string
  readonly value: string
}

export interface FundSourceDescriptor {
  readonly headline: string
  readonly customerName?: string
  readonly supplierName?: string
  readonly documentNo?: string
  readonly link?: FundSourceLink
  readonly detail?: readonly FundSourceDetailItem[]
}

/**
 * 来源单据的可跳转目标。只表达“这是哪张单据”，不表达当前用户是否能打开：
 * 路由与权限都在 web 侧，服务端不做二次判断，避免两处口径漂移。
 */
export const FUND_SOURCE_LINK_KINDS = [
  'SALES_ORDER',
  'PURCHASE_ORDER',
  'SALES_RECEIPT',
  'INVOICE_REQUEST',
  'SLH_RECONCILIATION',
  'PACKAGING_COST',
  'SHIPMENT_STORAGE',
  'FUND_WITHDRAWAL',
] as const

export type FundSourceLinkKind = (typeof FUND_SOURCE_LINK_KINDS)[number]

export interface FundSourceLink {
  readonly kind: FundSourceLinkKind
  readonly id: string
}

/** 落库形态：可空字段统一为 null，缺内容时由 resolver 版本标记待补。 */
export interface FundSourceSnapshotInsert {
  readonly sourceKind: FundSourceKind
  readonly headline: string
  readonly customerName: string | null
  readonly supplierName: string | null
  readonly documentNo: string | null
  readonly linkKind: FundSourceLinkKind | null
  readonly linkId: string | null
  readonly detail: readonly FundSourceDetailItem[]
  readonly resolverVersion: number
}

/**
 * resolver_version 语义：2 = 已有业务侧描述符或已回填；1 = 只有批次摘要的降级内容。
 * 因此 `WHERE resolver_version = 1` 能直接列出待补的流水，包括历史批次。
 */
export const FUND_SOURCE_CURRENT_RESOLVER_VERSION = 2
export const FUND_SOURCE_FALLBACK_RESOLVER_VERSION = 1

const SOURCE_KIND_BY_SOURCE_CONSUMER: Readonly<Record<string, FundSourceKind>> = Object.freeze({
  'SALES_RECEIPT/SALES_RECEIPT.APPROVE': 'SALES_RECEIPT',
  'PACKAGING_COST/PACKAGING_COST.PAY': 'PACKAGING_COST',
  'SHIPMENT_STORAGE/SHIPMENT_STORAGE.RELEASE': 'SHIPMENT_STORAGE',
  'SHIPMENT_STORAGE/SHIPMENT_STORAGE.CLAIM': 'SHIPMENT_STORAGE',
  'PURCHASE_PAYMENT/PURCHASE_PAYMENT.PAY': 'PURCHASE_PAYMENT',
  'PURCHASE_PAYMENT/PURCHASE_PAYMENT.STOCK_PAY': 'PURCHASE_PAYMENT',
  'SLH_BILL_FINANCE_SETTLEMENT/SLH_BILL_FINANCE_SETTLEMENT.RECONCILE': 'SLH_SETTLEMENT',
  'SLH_BILL_FINANCE_SETTLEMENT/SLH_BILL_FINANCE_SETTLEMENT.FEE': 'SLH_FEE',
  'SLH_BILL_FINANCE_SETTLEMENT_COMPANY/SLH_BILL_FINANCE_SETTLEMENT_COMPANY.ALLOCATION':
    'SLH_COMPANY_ALLOCATION',
  'SLH_BILL_FINANCE_SETTLEMENT_COMPANY_FEE/SLH_BILL_FINANCE_SETTLEMENT_COMPANY_FEE.FEE':
    'SLH_COMPANY_ALLOCATION',
  'INVOICE_REQUEST/INVOICE_REQUEST.SETTLE': 'INVOICE_REQUEST',
  'FUND_WITHDRAWAL/FUND_WITHDRAWAL.APPROVE': 'WITHDRAWAL',
})

/**
 * 未登记的来源组合返回 null，由调用方降级为 UNRESOLVED；
 * 不能回退成某个默认类型，否则新接入的业务会被悄悄算进旧分类。
 */
export function resolveFundSourceKind(
  sourceCode: string,
  consumerCode: string,
): FundSourceKind | null {
  return SOURCE_KIND_BY_SOURCE_CONSUMER[`${sourceCode}/${consumerCode}`] ?? null
}

const DESCRIPTOR_KEYS = new Set([
  'headline',
  'customerName',
  'supplierName',
  'documentNo',
  'link',
  'detail',
])
const DETAIL_KEYS = new Set(['label', 'value'])
const LINK_KEYS = new Set(['kind', 'id'])
const LINK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u

function sourceInvalid(): never {
  throw new FundPostingError(
    FUND_POSTING_ERROR_CODES.VALIDATION_FAILED,
    'source',
  )
}

function codePointLength(value: string): number {
  return [...value].length
}

function readSafeRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return sourceInvalid()
  }

  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return sourceInvalid()
  }

  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    return sourceInvalid()
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const values: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]
    if (
      descriptor === undefined
      || !descriptor.enumerable
      || !('value' in descriptor)
    ) {
      return sourceInvalid()
    }
    values[key] = descriptor.value
  }
  return values
}

function normalizeText(
  value: unknown,
  maximumCodePoints: number,
): string {
  if (typeof value !== 'string') return sourceInvalid()
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0 || codePointLength(normalized) > maximumCodePoints) {
    return sourceInvalid()
  }
  return normalized
}

function normalizeOptionalText(
  value: unknown,
  maximumCodePoints: number,
): string | undefined {
  if (value === undefined) return undefined
  return normalizeText(value, maximumCodePoints)
}

function normalizeDetail(value: unknown): readonly FundSourceDetailItem[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > FUND_SOURCE_MAXIMUM_DETAIL_ITEMS) {
    return sourceInvalid()
  }

  return Object.freeze(value.map((item: unknown) => {
    const record = readSafeRecord(item, DETAIL_KEYS)
    return Object.freeze({
      label: normalizeText(
        record.label,
        FUND_SOURCE_DETAIL_LABEL_MAXIMUM_CODE_POINTS,
      ),
      value: normalizeText(
        record.value,
        FUND_SOURCE_DETAIL_VALUE_MAXIMUM_CODE_POINTS,
      ),
    })
  }))
}

function normalizeLink(value: unknown): FundSourceLink | undefined {
  if (value === undefined) return undefined
  const record = readSafeRecord(value, LINK_KEYS)
  const kind = record.kind
  const id = record.id
  if (
    typeof kind !== 'string'
    || !(FUND_SOURCE_LINK_KINDS as readonly string[]).includes(kind)
    || typeof id !== 'string'
    || !LINK_ID_PATTERN.test(id)
  ) {
    return sourceInvalid()
  }
  return Object.freeze({ kind: kind as FundSourceLinkKind, id })
}

/**
 * 业务侧描述符的边界校验。未提供时返回 null，由落库层写入 UNRESOLVED 投影，
 * 这样漏接的调用点能被一条 SQL 查出来，而不是表现为“流水详情空白”。
 */
export function normalizeFundSourceDescriptor(
  value: unknown,
): FundSourceDescriptor | null {
  if (value === undefined) return null

  const record = readSafeRecord(value, DESCRIPTOR_KEYS)
  const headline = normalizeText(
    record.headline,
    FUND_SOURCE_HEADLINE_MAXIMUM_CODE_POINTS,
  )
  const customerName = normalizeOptionalText(
    record.customerName,
    FUND_SOURCE_NAME_MAXIMUM_CODE_POINTS,
  )
  const supplierName = normalizeOptionalText(
    record.supplierName,
    FUND_SOURCE_NAME_MAXIMUM_CODE_POINTS,
  )
  const documentNo = normalizeOptionalText(
    record.documentNo,
    FUND_SOURCE_NAME_MAXIMUM_CODE_POINTS,
  )
  const detail = normalizeDetail(record.detail)
  const link = normalizeLink(record.link)

  return Object.freeze({
    headline,
    ...(customerName === undefined ? {} : { customerName }),
    ...(supplierName === undefined ? {} : { supplierName }),
    ...(documentNo === undefined ? {} : { documentNo }),
    ...(link === undefined ? {} : { link }),
    ...(detail === undefined ? {} : { detail }),
  })
}

/**
 * 投影 headline 列是 VARCHAR(200)，比批次 summary(500) 短；
 * 超长时按 code point 截断，避免展示层派生失败把整笔入账回滚。
 */
export function truncateFundSourceHeadline(value: string): string {
  return truncateFundSourceText(value, FUND_SOURCE_HEADLINE_MAXIMUM_CODE_POINTS)
}

/** detail 值有 200 code point 上限，业务侧长文本（备注等）按同一口径截断。 */
export function truncateFundSourceText(
  value: string,
  maximumCodePoints = FUND_SOURCE_DETAIL_VALUE_MAXIMUM_CODE_POINTS,
): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  const characters = [...(normalized.length === 0 ? '资金动账' : normalized)]
  return characters.slice(0, maximumCodePoints).join('')
}

/**
 * 业务入账的投影内容。描述符缺失时不放弃分类：仍按来源组合落已知类型，
 * 只把内容降级为批次摘要并标记 resolver_version = 1，避免整类流水变成“未知”。
 */
export function buildFundSourceSnapshot(input: {
  readonly sourceKind: FundSourceKind
  readonly descriptor: FundSourceDescriptor | null
  readonly summary: string
}): FundSourceSnapshotInsert {
  const descriptor = input.descriptor
  if (descriptor === null) {
    return Object.freeze({
      sourceKind: input.sourceKind,
      headline: truncateFundSourceHeadline(input.summary),
      customerName: null,
      supplierName: null,
      documentNo: null,
      linkKind: null,
      linkId: null,
      detail: Object.freeze([]),
      resolverVersion: FUND_SOURCE_FALLBACK_RESOLVER_VERSION,
    })
  }

  return Object.freeze({
    sourceKind: input.sourceKind,
    headline: descriptor.headline,
    customerName: descriptor.customerName ?? null,
    supplierName: descriptor.supplierName ?? null,
    documentNo: descriptor.documentNo ?? null,
    linkKind: descriptor.link?.kind ?? null,
    linkId: descriptor.link?.id ?? null,
    detail: descriptor.detail ?? Object.freeze([]),
    resolverVersion: FUND_SOURCE_CURRENT_RESOLVER_VERSION,
  })
}

/** 管理员调账没有业务单据，原因本身就是唯一的说明。 */
export function buildManualAdjustmentSourceSnapshot(
  reason: string,
): FundSourceSnapshotInsert {
  return Object.freeze({
    sourceKind: 'MANUAL_ADJUSTMENT',
    headline: truncateFundSourceHeadline(reason),
    customerName: null,
    supplierName: null,
    documentNo: null,
    linkKind: null,
    linkId: null,
    detail: Object.freeze([]),
    resolverVersion: FUND_SOURCE_CURRENT_RESOLVER_VERSION,
  })
}
