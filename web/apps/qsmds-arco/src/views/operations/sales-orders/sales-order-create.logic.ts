import type {
  CreateSalesOrderRequestDto,
  SalesOrderDetailDto,
  SalesOrderTemporaryDocumentDto,
} from '@/api/generated/types.gen'
import type { SalesOrderCurrency } from '@/api/modules/sales-orders'
import type { RegionSelectorValue } from '@/components/business/QsRegionSelector/types'

import { validateMoneyString } from '../../../components/base/MoneyInput/logic'

export type SalesOrderLineType = 'CATALOG' | 'CUSTOM'
export type SalesOrderFieldErrors = Readonly<Record<string, string>>
export type SalesOrderCreateStep = 0 | 1 | 2 | 3

export const SALES_ORDER_CREATE_LAST_STEP: SalesOrderCreateStep = 3

export interface SalesOrderLineFormModel {
  key: string
  lineType: SalesOrderLineType
  productId: string | null
  productNo: string | null
  name: string
  description: string
  standardUnitPriceAmount: string | null
  actualUnitPriceAmount: string | null
  quantity: string
  /** 只用于创建会话展示，构建订单 DTO 时必须显式忽略。 */
  mainImage: null | {
    readonly id: string
    readonly contentUrl: string
  }
}

export interface SalesOrderIssuanceVoucherFormModel extends SalesOrderTemporaryDocumentDto {
  key: string
  title: string
  /** 上传时生成并固定，后续自动刷新客户名时不重新计时。 */
  autoTitleTimestamp: string
}

export interface SalesOrderFormModel {
  orderDate: string
  currencyCode: SalesOrderCurrency
  customerName: string
  customerPhone: string
  region: RegionSelectorValue
  /** 仅用于客户端重复前缀校验和地址预览，正式快照由 Server 从 UUID 读取。 */
  regionNames: readonly string[]
  addressDetail: string
  lines: SalesOrderLineFormModel[]
  agreedTotalAmount: string | null
  depositDueAmount: string | null
  balanceDueAmount: string | null
  issuanceVoucher: SalesOrderIssuanceVoucherFormModel | null
  remark: string
}

export type BuildSalesOrderRequestResult
  = | { readonly valid: true, readonly request: CreateSalesOrderRequestDto }
    | { readonly valid: false, readonly fieldErrors: SalesOrderFieldErrors }

export type ValidateSalesOrderCreateStepResult
  = | { readonly valid: true }
    | { readonly valid: false, readonly fieldErrors: SalesOrderFieldErrors }

export interface SalesOrderApiFailure {
  readonly code: string | undefined
  readonly fieldErrors: SalesOrderFieldErrors
  readonly message: string
  readonly requestId: string | undefined
  readonly unknownResult: boolean
}

export interface SalesOrderEditingState {
  readonly phase: 'editing'
}

export interface SalesOrderSubmittingState {
  readonly phase: 'submitting'
  readonly authEpoch: number
  readonly requestVersion: number
  readonly idempotencyKey: string
  readonly snapshot: Readonly<CreateSalesOrderRequestDto>
}

export interface SalesOrderUnknownState extends Omit<SalesOrderSubmittingState, 'phase'> {
  readonly phase: 'unknown'
  readonly failure: SalesOrderApiFailure
}

export interface SalesOrderSuccessState {
  readonly phase: 'success'
  readonly salesOrder: Readonly<SalesOrderDetailDto>
}

export type SalesOrderSubmissionState
  = | SalesOrderEditingState
    | SalesOrderSubmittingState
    | SalesOrderUnknownState
    | SalesOrderSuccessState

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REGION_UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u
const ALL_UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const TAIWAN_TRADITIONAL_REGION_CHARACTER_PATTERN = /[國臺灣縣連門蘭雲義東蓮園]/gu
const MAXIMUM_AMOUNT_UNITS = 10n ** 30n - 1n
const MAXIMUM_QUANTITY = 2_147_483_647
const MAXIMUM_DOCUMENT_TITLE_LENGTH = 128
const AMOUNT_SCALE = 100n
const DEFAULT_FAILURE_MESSAGE = '销售订单保存失败，请检查后重试'
const TAIWAN_COUNTRY_REGION_NAME = '中国台湾'
const TAIWAN_TRADITIONAL_REGION_CHARACTER_FOLD: Readonly<Record<string, string>> = {
  國: '国',
  臺: '台',
  灣: '湾',
  縣: '县',
  連: '连',
  門: '门',
  蘭: '兰',
  雲: '云',
  義: '义',
  東: '东',
  蓮: '莲',
  園: '园',
}
const ADMINISTRATIVE_REGION_SUFFIXES = [
  '联邦直辖区',
  '聯邦直轄區',
  '特别行政区',
  '特別行政區',
  '自治区',
  '自治區',
  '自治州',
  '自治县',
  '自治縣',
  '行政区',
  '行政區',
  '地区',
  '地區',
  '省',
  '市',
  '县',
  '縣',
  '区',
  '區',
  '盟',
  '旗',
] as const

function newKey(): string {
  return crypto.randomUUID().toLowerCase()
}

export function parseSalesOrderCurrency(value: unknown): SalesOrderCurrency | null {
  return value === 'TWD' || value === 'MYR' ? value : null
}

/**
 * 表单仍在最终保存时执行完整领域校验；这里仅负责把字段错误定位到最早的可编辑步骤。
 * 未知字段不猜测归属，交由页面顶部的全局错误展示，避免错误跳到订单凭证步骤。
 */
export function resolveSalesOrderCreateStepForField(
  path: string,
): SalesOrderCreateStep | null {
  if (path === 'orderDate' || path === 'currencyCode' || path === 'issuer') {
    return 0
  }
  if (
    path.startsWith('customer.')
    || path === 'customerName'
    || path === 'customerPhone'
    || path === 'region'
    || path === 'addressDetail'
  ) {
    return 1
  }
  if (
    path === 'lines'
    || path.startsWith('lines.')
    || path === 'agreedTotalAmount'
    || path === 'depositDueAmount'
    || path === 'balanceDueAmount'
  ) {
    return 2
  }
  if (
    path === 'issuanceVoucher'
    || path.startsWith('issuanceVoucher.')
    || path === 'remark'
  ) {
    return 3
  }
  return null
}

export function resolveSalesOrderCreateStepForErrors(
  errors: SalesOrderFieldErrors,
): SalesOrderCreateStep | null {
  let earliestStep: SalesOrderCreateStep | null = null

  for (const path of Object.keys(errors)) {
    const step = resolveSalesOrderCreateStepForField(path)
    if (step !== null) {
      earliestStep = earliestStep === null
        ? step
        : Math.min(earliestStep, step) as SalesOrderCreateStep
    }
  }

  return earliestStep
}

/**
 * 新增页只展示当前认证用户，不允许业务人员改选出单人。认证上下文在刷新期间
 * 可能只有 username，因此这里与全局账户按钮保持一致，显示名缺失时回退账号。
 */
export function resolveSalesOrderIssuerLabel(
  displayName: string,
  username: string,
): string {
  return normalizeText(displayName)
    || normalizeText(username)
    || '当前用户资料不可用'
}

export function normalizeSalesOrderAddressDetail(value: string): string {
  return value.normalize('NFKC').replace(ALL_UNICODE_WHITESPACE_PATTERN, '')
}

function normalizeText(value: string): string {
  return value.trim().normalize('NFKC')
}

function optionalText(value: string): string | null {
  const normalized = normalizeText(value)
  return normalized === '' ? null : normalized
}

function codePointLength(value: string): number {
  return [...value].length
}

function padDatePart(value: number, length: number): string {
  return value.toString().padStart(length, '0')
}

/**
 * 凭证标题使用浏览器本地时间；时间戳无分隔符，既便于人工辨识，也能保持标题稳定。
 */
export function formatSalesOrderDocumentTitleTimestamp(value: Date): string {
  return [
    padDatePart(value.getFullYear(), 4),
    padDatePart(value.getMonth() + 1, 2),
    padDatePart(value.getDate(), 2),
    padDatePart(value.getHours(), 2),
    padDatePart(value.getMinutes(), 2),
    padDatePart(value.getSeconds(), 2),
    padDatePart(value.getMilliseconds(), 3),
  ].join('')
}

export function createSalesOrderDocumentAutoTitle(
  customerName: string,
  timestamp: string,
): string {
  const normalizedCustomerName = normalizeText(customerName) || '未填写客户'
  const suffix = `-出单凭证-${timestamp}`
  // 服务端按 Unicode code point 限制 128 字符，因此不能用 UTF-16 length 截断中文或 emoji。
  const maximumCustomerNameLength = Math.max(
    0,
    MAXIMUM_DOCUMENT_TITLE_LENGTH - codePointLength(suffix),
  )
  return `${[...normalizedCustomerName].slice(0, maximumCustomerNameLength).join('')}${suffix}`
}

export function refreshSalesOrderDocumentAutoTitle(
  document: SalesOrderIssuanceVoucherFormModel,
  customerName: string,
): SalesOrderIssuanceVoucherFormModel {
  return {
    ...document,
    title: createSalesOrderDocumentAutoTitle(
      customerName,
      document.autoTitleTimestamp,
    ),
  }
}

function isValidDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value)
  if (match === null) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function amountMaximum(precision: number): string {
  return precision === 0
    ? '99999999999999999999999999'
    : `99999999999999999999999999.${'9'.repeat(precision)}`
}

function normalizedAmount(
  value: string | null,
  precision: number,
): string | null {
  if (value === null) {
    return null
  }
  const result = validateMoneyString(value, {
    max: amountMaximum(precision),
    min: '0',
    precision,
  })
  return result.valid ? result.normalizedValue : null
}

/**
 * 货到付款确认只处理已经通过金额校验的精确零定金。非法或空金额返回 false，
 * 继续由步骤校验显示字段错误，避免确认弹窗遮挡真正需要修正的输入问题。
 */
export function requiresSalesOrderCashOnDeliveryConfirmation(
  depositDueAmount: string | null,
  precision: number,
): boolean {
  const normalized = normalizedAmount(depositDueAmount, precision)
  return normalized !== null && /^0(?:\.0+)?$/u.test(normalized)
}

function amountUnits(value: string): bigint {
  const [integerPart = '0', fractionPart = ''] = value.split('.')
  return BigInt(integerPart) * AMOUNT_SCALE
    + BigInt(fractionPart.padEnd(2, '0'))
}

function formatAmountUnits(value: bigint): string {
  const integerPart = value / AMOUNT_SCALE
  const fractionPart = (value % AMOUNT_SCALE).toString().padStart(2, '0')
  return `${integerPart}.${fractionPart}`
}

function formatAmountUnitsForPrecision(value: bigint, precision: number): string {
  const [integerPart, fractionPart = ''] = formatAmountUnits(value).split('.')
  return precision === 0
    ? integerPart!
    : `${integerPart}.${fractionPart.slice(0, precision)}`
}

function isBlankCatalogLine(line: SalesOrderLineFormModel): boolean {
  return line.lineType === 'CATALOG'
    && line.productId === null
    && line.actualUnitPriceAmount === null
    && line.quantity === '1'
}

export function createCatalogSalesOrderLine(
  key: string = newKey(),
): SalesOrderLineFormModel {
  return {
    key,
    lineType: 'CATALOG',
    productId: null,
    productNo: null,
    name: '',
    description: '',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: null,
    quantity: '1',
    mainImage: null,
  }
}

export function createCustomSalesOrderLine(
  key: string = newKey(),
): SalesOrderLineFormModel {
  return {
    ...createCatalogSalesOrderLine(key),
    lineType: 'CUSTOM',
  }
}

export function createSalesOrderFormModel(
  currencyCode: SalesOrderCurrency,
  today: string,
): SalesOrderFormModel {
  return {
    orderDate: today,
    currencyCode,
    customerName: '',
    customerPhone: '',
    region: {
      countryRegionId: null,
      provinceStateId: null,
      cityId: null,
    },
    regionNames: [],
    addressDetail: '',
    // 新增页先展示空表格，避免把尚未由用户选择的目录产品误认为真实订单明细。
    lines: [],
    agreedTotalAmount: null,
    depositDueAmount: null,
    balanceDueAmount: null,
    issuanceVoucher: null,
    remark: '',
  }
}

interface RegionNameComparisonVariant {
  readonly value: string
  readonly omittedSuffix: string | null
}

interface RegionPrefixComparisonCandidate {
  readonly value: string
  readonly omittedTerminalSuffix: string | null
}

/**
 * 当前地区真相源为台湾 22 个县市保留了官方繁体 sourceName。选择器没有公开该字段，
 * 因而这里只折叠由该真相源验证过的 12 个地区字形；绝不改写用户实际保存的地址。
 */
function foldTaiwanTraditionalRegionCharacters(value: string): string {
  return value.replace(
    TAIWAN_TRADITIONAL_REGION_CHARACTER_PATTERN,
    character => TAIWAN_TRADITIONAL_REGION_CHARACTER_FOLD[character] ?? character,
  )
}

function findAdministrativeRegionSuffix(value: string, position: 'end' | 'start'): string | null {
  return ADMINISTRATIVE_REGION_SUFFIXES.find(suffix => (
    position === 'end' ? value.endsWith(suffix) : value.startsWith(suffix)
  )) ?? null
}

function createRegionNameComparisonVariants(value: string): readonly RegionNameComparisonVariant[] {
  const suffix = findAdministrativeRegionSuffix(value, 'end')
  if (suffix === null || value.length === suffix.length) {
    return [{ value, omittedSuffix: null }]
  }
  return [
    { value, omittedSuffix: null },
    { value: value.slice(0, -suffix.length), omittedSuffix: suffix },
  ]
}

function createRegionPrefixComparisonCandidates(
  country: string,
  province: string,
  city: string,
): readonly RegionPrefixComparisonCandidate[] {
  const countryVariants = createRegionNameComparisonVariants(country)
  const provinceVariants = createRegionNameComparisonVariants(province)
  const cityVariants = createRegionNameComparisonVariants(city)
  const candidates = new Map<string, RegionPrefixComparisonCandidate>()

  for (const cityVariant of cityVariants) {
    const paths = [
      ...countryVariants.flatMap(countryVariant => (
        provinceVariants.map(provinceVariant => (
          countryVariant.value + provinceVariant.value + cityVariant.value
        ))
      )),
      ...provinceVariants.map(provinceVariant => (
        provinceVariant.value + cityVariant.value
      )),
      cityVariant.value,
    ]
    for (const value of paths) {
      if (value !== '') {
        const key = `${value}\u0000${cityVariant.omittedSuffix ?? ''}`
        candidates.set(key, {
          value,
          omittedTerminalSuffix: cityVariant.omittedSuffix,
        })
      }
    }
  }
  return [...candidates.values()]
}

function matchesRegionPrefixCandidate(
  detail: string,
  candidate: RegionPrefixComparisonCandidate,
): boolean {
  if (!detail.startsWith(candidate.value)) {
    return false
  }
  if (candidate.omittedTerminalSuffix === null) {
    return true
  }

  // 简称后若明确填写了另一个行政后缀，说明它是不同地区。例如选“新竹县”时，
  // “台湾新竹市…”不能因为共同前缀“新竹”被误拦截。
  const remainder = detail.slice(candidate.value.length)
  const explicitSuffix = findAdministrativeRegionSuffix(remainder, 'start')
  return explicitSuffix === null || explicitSuffix === candidate.omittedTerminalSuffix
}

function addressContainsSelectedRegion(
  detail: string,
  regionNames: readonly string[],
): boolean {
  if (regionNames.length !== 3) {
    return false
  }
  const [rawCountry = '', rawProvince = '', rawCity = ''] = regionNames.map(name =>
    normalizeSalesOrderAddressDetail(name))
  const isTaiwan = foldTaiwanTraditionalRegionCharacters(rawCountry)
    === TAIWAN_COUNTRY_REGION_NAME
  const comparison = (value: string) => isTaiwan
    ? foldTaiwanTraditionalRegionCharacters(value)
    : value
  const country = comparison(rawCountry)
  const province = comparison(rawProvince)
  const city = comparison(rawCity)
  const comparisonDetail = comparison(detail)

  return createRegionPrefixComparisonCandidates(country, province, city)
    .some(candidate => matchesRegionPrefixCandidate(comparisonDetail, candidate))
}

function normalizeQuantity(value: string): number | null {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) {
    return null
  }
  const quantity = Number(value)
  return Number.isSafeInteger(quantity)
    && quantity <= MAXIMUM_QUANTITY
    ? quantity
    : null
}

function validateLine(
  line: SalesOrderLineFormModel,
  index: number,
  precision: number,
  errors: Record<string, string>,
): { readonly dto: CreateSalesOrderRequestDto['lines'][number], readonly totalUnits: bigint } | null {
  const field = `lines.${index}`
  const quantity = normalizeQuantity(line.quantity)
  if (quantity === null) {
    errors[`${field}.quantity`] = '产品数量必须是正整数'
  }
  const price = normalizedAmount(line.actualUnitPriceAmount, precision)
  if (price === null) {
    errors[`${field}.actualUnitPriceAmount`] = '请输入有效的真实售价'
  }

  let dto: CreateSalesOrderRequestDto['lines'][number] | null = null
  if (line.lineType === 'CATALOG') {
    if (line.productId === null || !UUID_V4_PATTERN.test(line.productId)) {
      errors[`${field}.productId`] = '请选择当前币种下的数据库产品'
    }
    else if (price !== null && quantity !== null) {
      dto = {
        lineType: 'CATALOG',
        productId: line.productId,
        actualUnitPriceAmount: formatAmountUnitsForPrecision(
          amountUnits(price),
          precision,
        ),
        quantity,
      }
    }
  }
  else {
    const name = normalizeText(line.name)
    if (name === '' || codePointLength(name) > 128) {
      errors[`${field}.name`] = '临时产品名称不能为空且最多 128 个字符'
    }
    const description = optionalText(line.description)
    if (description !== null && codePointLength(description) > 1000) {
      errors[`${field}.description`] = '临时产品说明最多 1000 个字符'
    }
    if (
      name !== ''
      && codePointLength(name) <= 128
      && (description === null || codePointLength(description) <= 1000)
      && price !== null
      && quantity !== null
    ) {
      dto = {
        lineType: 'CUSTOM',
        name,
        description,
        actualUnitPriceAmount: formatAmountUnitsForPrecision(
          amountUnits(price),
          precision,
        ),
        quantity,
      }
    }
  }

  if (dto === null || price === null || quantity === null) {
    return null
  }
  const totalUnits = amountUnits(price) * BigInt(quantity)
  if (totalUnits > MAXIMUM_AMOUNT_UNITS) {
    errors[`${field}.quantity`] = '数量与真实售价的乘积超过订单金额上限'
    return null
  }
  return { dto, totalUnits }
}

export function calculateSalesOrderLineSubtotal(
  lines: readonly SalesOrderLineFormModel[],
  precision: number,
): string | null {
  const errors: Record<string, string> = {}
  let total = 0n
  for (const [index, line] of lines.entries()) {
    const validated = validateLine(line, index, precision, errors)
    if (validated === null) {
      return null
    }
    total += validated.totalUnits
    if (total > MAXIMUM_AMOUNT_UNITS) {
      return null
    }
  }
  return formatAmountUnitsForPrecision(total, precision)
}

function requireText(
  value: string,
  field: string,
  label: string,
  maximum: number,
  errors: Record<string, string>,
): string | null {
  const normalized = normalizeText(value)
  if (normalized === '' || codePointLength(normalized) > maximum) {
    errors[field] = `${label}不能为空且最多 ${maximum} 个字符`
    return null
  }
  return normalized
}

export function buildCreateSalesOrderRequest(
  model: SalesOrderFormModel,
  precision: number,
  today: string = model.orderDate,
): BuildSalesOrderRequestResult {
  const errors: Record<string, string> = {}
  if (!isValidDate(model.orderDate) || model.orderDate > today) {
    errors.orderDate = '出单日期只能选择今天或历史日期'
  }
  const customerName = requireText(
    model.customerName,
    'customer.name',
    '客户姓名',
    128,
    errors,
  )
  const customerPhone = requireText(
    model.customerPhone,
    'customer.phone',
    '客户电话',
    64,
    errors,
  )
  const { countryRegionId, provinceStateId, cityId } = model.region
  for (const [field, value] of [
    ['countryRegionId', countryRegionId],
    ['provinceStateId', provinceStateId],
    ['cityId', cityId],
  ] as const) {
    // 地区种子使用可重现的 UUID v5；产品、媒体和幂等聚合 ID 仍限 v4。
    if (value === null || !REGION_UUID_PATTERN.test(value)) {
      errors[`customer.${field}`] = '请选择完整的三级地区'
    }
  }
  const addressDetail = normalizeSalesOrderAddressDetail(model.addressDetail)
  if (addressDetail === '' || codePointLength(addressDetail) > 1000) {
    errors['customer.addressDetail'] = '详细地址不能为空且最多 1000 个字符'
  }
  else if (addressContainsSelectedRegion(addressDetail, model.regionNames)) {
    errors['customer.addressDetail'] = '详细地址请勿重复填写已选地区'
  }

  const lineDtos: CreateSalesOrderRequestDto['lines'] = []
  let lineSubtotalUnits = 0n
  if (model.lines.length < 1 || model.lines.length > 100) {
    errors.lines = '产品明细必须为 1 至 100 行'
  }
  else {
    for (const [index, line] of model.lines.entries()) {
      const validated = validateLine(line, index, precision, errors)
      if (validated !== null) {
        lineDtos.push(validated.dto)
        lineSubtotalUnits += validated.totalUnits
      }
    }
    if (lineSubtotalUnits > MAXIMUM_AMOUNT_UNITS) {
      errors.lines = '产品明细汇总超过订单金额上限'
    }
  }

  const normalizedAgreed = normalizedAmount(model.agreedTotalAmount, precision)
  const normalizedDeposit = normalizedAmount(model.depositDueAmount, precision)
  const normalizedBalance = normalizedAmount(model.balanceDueAmount, precision)
  if (normalizedAgreed === null) {
    errors.agreedTotalAmount = '请输入有效的销售总价'
  }
  if (normalizedDeposit === null) {
    errors.depositDueAmount = '请输入有效的定金'
  }
  if (normalizedBalance === null) {
    errors.balanceDueAmount = '请输入有效的尾款'
  }
  if (
    normalizedAgreed !== null
    && lineDtos.length === model.lines.length
    && amountUnits(normalizedAgreed) !== lineSubtotalUnits
  ) {
    errors.agreedTotalAmount = '手填销售总价必须与产品明细汇总一致'
  }
  if (
    normalizedAgreed !== null
    && normalizedDeposit !== null
    && normalizedBalance !== null
    && amountUnits(normalizedDeposit) + amountUnits(normalizedBalance)
    !== amountUnits(normalizedAgreed)
  ) {
    errors.balanceDueAmount = '定金与尾款之和必须等于销售总价'
  }

  if (model.issuanceVoucher === null) {
    errors.issuanceVoucher = '出单凭证必须上传且只能上传一份'
  }
  else if (!UUID_V4_PATTERN.test(model.issuanceVoucher.mediaAssetId)) {
    errors['issuanceVoucher.mediaAssetId'] = '出单凭证上传状态无效'
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, fieldErrors: Object.freeze(errors) }
  }

  return {
    valid: true,
    request: {
      orderDate: model.orderDate,
      currencyCode: model.currencyCode,
      customer: {
        name: customerName as string,
        phone: customerPhone as string,
        countryRegionId: countryRegionId as string,
        provinceStateId: provinceStateId as string,
        cityId: cityId as string,
        addressDetail,
      },
      lines: lineDtos,
      agreedTotalAmount: formatAmountUnits(amountUnits(normalizedAgreed as string)),
      depositDueAmount: formatAmountUnits(amountUnits(normalizedDeposit as string)),
      balanceDueAmount: formatAmountUnits(amountUnits(normalizedBalance as string)),
      issuanceVoucher: {
        mediaAssetId: (model.issuanceVoucher as SalesOrderIssuanceVoucherFormModel)
          .mediaAssetId,
      },
      remark: optionalText(model.remark),
    },
  }
}

/**
 * “下一步”复用最终保存的同一套领域校验，只筛选当前步骤的字段错误。
 * 这样既能提前硬拦截，又不会把尚未填写的后续步骤错误带到当前页面。
 */
export function validateSalesOrderCreateStep(
  model: SalesOrderFormModel,
  step: SalesOrderCreateStep,
  precision: number,
  today: string = model.orderDate,
): ValidateSalesOrderCreateStepResult {
  const result = buildCreateSalesOrderRequest(model, precision, today)
  if (result.valid) {
    return { valid: true }
  }

  const fieldErrors = Object.fromEntries(
    Object.entries(result.fieldErrors).filter(([path]) => (
      resolveSalesOrderCreateStepForField(path) === step
    )),
  )
  return Object.keys(fieldErrors).length === 0
    ? { valid: true }
    : { valid: false, fieldErrors: Object.freeze(fieldErrors) }
}

export function hasSalesOrderChanges(model: SalesOrderFormModel, today: string): boolean {
  return model.orderDate !== today
    || model.customerName !== ''
    || model.customerPhone !== ''
    || model.region.countryRegionId !== null
    || model.addressDetail !== ''
    || model.agreedTotalAmount !== null
    || model.depositDueAmount !== null
    || model.balanceDueAmount !== null
    || model.issuanceVoucher !== null
    || model.remark !== ''
    || model.lines.length !== 1
    || !isBlankCatalogLine(model.lines[0]!)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFirstMessage(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string'
    ? value[0]
    : undefined
}

function allowedFieldPath(path: string): boolean {
  return /^(?:orderDate|currencyCode|agreedTotalAmount|depositDueAmount|balanceDueAmount|remark|lines|issuanceVoucher)$/u.test(path)
    || /^customer\.(?:name|phone|countryRegionId|provinceStateId|cityId|addressDetail)$/u.test(path)
    || /^lines\.(?:\d|[1-9]\d)\.(?:lineType|productId|name|description|actualUnitPriceAmount|quantity)$/u.test(path)
    || /^issuanceVoucher\.mediaAssetId$/u.test(path)
}

const RULE_CODE_FIELDS: Readonly<Record<string, string>> = {
  ADDRESS_DETAIL_CONTAINS_SELECTED_REGION: 'customer.addressDetail',
  SALES_ORDER_CURRENCY_UNAVAILABLE: 'currencyCode',
  SALES_ORDER_DOCUMENT_UNAVAILABLE: 'issuanceVoucher',
  SALES_ORDER_PAYMENT_TERMS_MISMATCH: 'balanceDueAmount',
  SALES_ORDER_PRODUCT_UNAVAILABLE: 'lines',
  SALES_ORDER_REGION_UNAVAILABLE: 'customer.cityId',
  SALES_ORDER_TOTAL_MISMATCH: 'agreedTotalAmount',
}

export function getSalesOrderApiFailure(error: unknown): SalesOrderApiFailure {
  const fallback: SalesOrderApiFailure = {
    code: undefined,
    fieldErrors: {},
    message: DEFAULT_FAILURE_MESSAGE,
    requestId: undefined,
    unknownResult: false,
  }
  if (!isRecord(error)) {
    return fallback
  }
  if (error.kind === 'network') {
    return {
      ...fallback,
      message: typeof error.message === 'string' ? error.message : '网络连接失败，请稍后重试',
      unknownResult: true,
    }
  }
  const status = typeof error.status === 'number' ? error.status : undefined
  const body = isRecord(error.body) ? error.body : undefined
  const code = typeof body?.code === 'string' ? body.code : undefined
  const fieldErrors: Record<string, string> = {}
  if (isRecord(body?.fieldErrors)) {
    for (const [field, messages] of Object.entries(body.fieldErrors)) {
      const message = readFirstMessage(messages)
      if (message !== undefined && allowedFieldPath(field)) {
        fieldErrors[field] = message
      }
    }
  }
  if (code !== undefined && RULE_CODE_FIELDS[code] !== undefined) {
    fieldErrors[RULE_CODE_FIELDS[code]] = typeof body?.message === 'string'
      ? body.message
      : DEFAULT_FAILURE_MESSAGE
  }
  return {
    code,
    fieldErrors: Object.freeze(fieldErrors),
    message: typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : DEFAULT_FAILURE_MESSAGE,
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
    unknownResult: status === undefined || status >= 500,
  }
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return value
}

export function createSalesOrderSubmissionState(): SalesOrderEditingState {
  return Object.freeze({ phase: 'editing' })
}

export function beginSalesOrderSubmission(
  state: SalesOrderEditingState,
  request: CreateSalesOrderRequestDto,
  context: { readonly authEpoch: number, readonly requestVersion: number },
  keyFactory: () => string = newKey,
): SalesOrderSubmittingState {
  if (state.phase !== 'editing') {
    throw new TypeError('只有编辑状态可以开始提交')
  }
  return Object.freeze({
    ...context,
    phase: 'submitting',
    idempotencyKey: keyFactory(),
    snapshot: deepFreeze(structuredClone(request)),
  })
}

export function resolveSalesOrderSubmissionFailure(
  state: SalesOrderSubmittingState,
  failure: SalesOrderApiFailure,
): SalesOrderEditingState | SalesOrderUnknownState {
  return failure.unknownResult
    ? Object.freeze({
        authEpoch: state.authEpoch,
        failure,
        idempotencyKey: state.idempotencyKey,
        phase: 'unknown',
        requestVersion: state.requestVersion,
        snapshot: state.snapshot,
      })
    : createSalesOrderSubmissionState()
}

export function replayUnknownSalesOrderSubmission(
  state: SalesOrderUnknownState,
  context: { readonly authEpoch: number, readonly requestVersion: number },
): SalesOrderSubmittingState {
  if (state.authEpoch !== context.authEpoch) {
    throw new TypeError('身份域变化后不能重放旧的销售订单请求')
  }
  return Object.freeze({
    authEpoch: state.authEpoch,
    idempotencyKey: state.idempotencyKey,
    phase: 'submitting',
    requestVersion: context.requestVersion,
    snapshot: state.snapshot,
  })
}

export function abandonUnknownSalesOrderSubmission(
  state: SalesOrderUnknownState,
): SalesOrderEditingState {
  if (state.phase !== 'unknown') {
    throw new TypeError('只能放弃未知结果')
  }
  return createSalesOrderSubmissionState()
}

export function resolveSalesOrderSubmissionSuccess(
  state: SalesOrderSubmittingState,
  salesOrder: SalesOrderDetailDto,
): SalesOrderSuccessState {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能完成提交中的请求')
  }
  return Object.freeze({
    phase: 'success',
    salesOrder: deepFreeze(structuredClone(salesOrder)),
  })
}

export function canApplySalesOrderResponse(input: {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly requestVersion: number
  readonly latestRequestVersion: number
}): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

export function isSalesOrderAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    ))
}
