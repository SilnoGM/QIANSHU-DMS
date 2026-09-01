import type {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderProductOptionDto,
  PurchaseOrderProductOptionsDto,
  PurchaseOrderSourceSalesOrderLineDto,
} from '../../../api/generated/types.gen'
import type { OrderProductLineModel } from '../../../components/business/QsOrderProductLineEditor/types'
import type { ProductSelectorPage } from '../../../components/business/QsProductSelector/types'

export type PurchaseOrderCreateType = 'SALES_LINKED' | 'STOCK'
export type PurchaseOrderCreateStep = 0 | 1 | 2 | 3
export type PurchaseOrderFormStep = Exclude<PurchaseOrderCreateStep, 3>

export interface PurchaseOrderSourceShortcut {
  readonly salesOrderId: string
  readonly salesOrderNo: string
}

export const PURCHASE_ORDER_CREATE_REVIEW_STEP: PurchaseOrderCreateStep = 3

export interface PurchaseOrderCreateSource {
  readonly balanceDueAmount: string | null
  readonly depositDueAmount: string | null
  readonly lines: readonly OrderProductLineModel[]
  readonly maximumQuantityByKey: Readonly<Record<string, number | undefined>>
  readonly orderDate: string
  readonly purchaseType: PurchaseOrderCreateType
  readonly remark: string
  readonly salesOrderId: string | null
  readonly shippingMarkText: string
  readonly sourceSalesOrderLineIdByKey: Readonly<Record<string, string | undefined>>
  readonly supplierValue: string
  readonly today: string
}

export type PurchaseOrderCreateBuildResult
  = | {
    readonly valid: true
    readonly fieldErrors: Readonly<Record<string, never>>
    readonly purchaseTotalAmount: string
    readonly request: CreatePurchaseOrderRequestDto
  }
  | {
    readonly valid: false
    readonly fieldErrors: Readonly<Record<string, string>>
    readonly purchaseTotalAmount: string | null
  }

export type ValidatePurchaseOrderCreateStepResult
  = | { readonly valid: true }
    | {
      readonly valid: false
      readonly fieldErrors: Readonly<Record<string, string>>
    }

export interface PurchaseOrderSourceSynchronizationResult {
  readonly exhaustedCount: number
  readonly incompatibleCatalogCount: number
  readonly lines: readonly OrderProductLineModel[]
  readonly maximumQuantityByKey: Readonly<Record<string, number>>
  readonly sourceSalesOrderLineIdByKey: Readonly<Record<string, string>>
}

export interface PurchaseOrderMutationFailure {
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId?: string
  readonly unknownResult: boolean
}

export interface PurchaseOrderEditingState {
  readonly phase: 'editing'
}

export interface PurchaseOrderSubmittingState {
  readonly authEpoch: number
  readonly idempotencyKey: string
  readonly phase: 'submitting'
  readonly requestVersion: number
  readonly snapshot: Readonly<CreatePurchaseOrderRequestDto>
}

export interface PurchaseOrderUnknownState {
  readonly authEpoch: number
  readonly failure: PurchaseOrderMutationFailure
  readonly idempotencyKey: string
  readonly phase: 'unknown'
  readonly requestVersion: number
  readonly snapshot: Readonly<CreatePurchaseOrderRequestDto>
}

export interface PurchaseOrderSuccessState {
  readonly phase: 'success'
  readonly purchaseOrder: Readonly<PurchaseOrderDetailDto>
}

export type PurchaseOrderSubmissionState
  = | PurchaseOrderEditingState
    | PurchaseOrderSubmittingState
    | PurchaseOrderSuccessState
    | PurchaseOrderUnknownState

const USER_AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u
const QUANTITY_PATTERN = /^[1-9]\d*$/u
const MAXIMUM_QUANTITY = 2_147_483_647
const MAXIMUM_LINES = 100
const AMOUNT_SCALE = 100n

interface NormalizedAmount {
  readonly normalized: string
  readonly units: bigint
}

function normalizeUserAmount(value: string | null): NormalizedAmount | null {
  if (value === null) {
    return null
  }
  const match = USER_AMOUNT_PATTERN.exec(value.trim())
  if (match === null) {
    return null
  }
  const integerPart = match[1]!
  const fractionPart = (match[2] ?? '').padEnd(2, '0')
  return {
    normalized: `${integerPart}.${fractionPart}`,
    units: BigInt(integerPart) * AMOUNT_SCALE + BigInt(fractionPart),
  }
}

function formatAmountUnits(units: bigint): string {
  const integerPart = units / AMOUNT_SCALE
  const fractionPart = (units % AMOUNT_SCALE).toString().padStart(2, '0')
  return `${integerPart}.${fractionPart}`
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim().normalize('NFKC')
  return normalized === '' ? null : normalized
}

function unicodeLength(value: string): number {
  return Array.from(value).length
}

function validQuantity(value: string): number | null {
  if (!QUANTITY_PATTERN.test(value)) {
    return null
  }
  const quantity = Number(value)
  return Number.isSafeInteger(quantity) && quantity <= MAXIMUM_QUANTITY
    ? quantity
    : null
}

export function parsePurchaseOrderCreateType(
  value: unknown,
  canCreateStock: boolean,
): PurchaseOrderCreateType | null {
  if (value === 'SALES_LINKED') {
    return value
  }
  return value === 'STOCK' && canCreateStock ? value : null
}

/**
 * 快捷入口参数来自 URL，不能直接作为已选销售订单。这里只做单值、长度与文字
 * 规范化；页面随后仍须通过采购域来源接口取得可信 DTO 并执行 ID 精确匹配。
 */
export function parsePurchaseOrderSourceShortcut(input: {
  readonly purchaseType: PurchaseOrderCreateType | null
  readonly salesOrderId: unknown
  readonly salesOrderNo: unknown
}): PurchaseOrderSourceShortcut | null {
  if (
    input.purchaseType !== 'SALES_LINKED'
    || typeof input.salesOrderId !== 'string'
    || typeof input.salesOrderNo !== 'string'
  ) {
    return null
  }
  const salesOrderId = input.salesOrderId.trim()
  const salesOrderNo = input.salesOrderNo.normalize('NFKC').trim()
  if (
    salesOrderId === ''
    || salesOrderNo === ''
    || unicodeLength(salesOrderId) > 128
    || unicodeLength(salesOrderNo) > 128
  ) {
    return null
  }
  return { salesOrderId, salesOrderNo }
}

/**
 * 将服务端和客户端共享的字段路径定位到采购创建页的可编辑步骤。
 * 第四步是只读核对面，不承载字段；未知路径保留在全局错误区，避免错误地
 * 把用户带到一个无法修正该问题的步骤。
 */
export function resolvePurchaseOrderCreateStepForField(
  path: string,
): PurchaseOrderFormStep | null {
  if (path === 'orderDate' || path === 'supplierValue' || path === 'salesOrderId') {
    return 0
  }
  if (
    path === 'lines'
    || path.startsWith('lines.')
    || path === 'depositDueAmount'
    || path === 'balanceDueAmount'
  ) {
    return 1
  }
  if (path === 'shippingMarkText' || path === 'remark') {
    return 2
  }
  return null
}

export function resolvePurchaseOrderCreateStepForErrors(
  errors: Readonly<Record<string, string>>,
): PurchaseOrderFormStep | null {
  let earliestStep: PurchaseOrderFormStep | null = null
  for (const path of Object.keys(errors)) {
    const step = resolvePurchaseOrderCreateStepForField(path)
    if (step !== null) {
      earliestStep = earliestStep === null
        ? step
        : Math.min(earliestStep, step) as PurchaseOrderFormStep
    }
  }
  return earliestStep
}

export function adaptPurchaseOrderProductPage(
  page: PurchaseOrderProductOptionsDto,
): ProductSelectorPage {
  return {
    items: page.items.map(item => ({
      attributes: item.attributes,
      currencyCode: item.currencyCode,
      id: item.id,
      mainImage: item.mainImage,
      name: item.name,
      productNo: item.productNo,
      standardUnitPriceAmount: item.referencePurchaseUnitPriceAmount,
      supplierValue: item.supplierValue,
    })),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
  }
}

function sourceLineKey(sourceLineId: string): string {
  return `source-${sourceLineId}`
}

/**
 * 销售来源接口刻意不泄露采购成本和供应商。页面先按订单供应商读取可采购产品，
 * 再以稳定 productId 交集同步正式产品；临时产品没有产品级供应商，始终允许同步。
 */
export function synchronizePurchaseOrderSourceLines(input: {
  readonly productOptions: readonly PurchaseOrderProductOptionDto[]
  readonly sourceLines: readonly PurchaseOrderSourceSalesOrderLineDto[]
}): PurchaseOrderSourceSynchronizationResult {
  const optionByProductId = new Map(input.productOptions.map(item => [item.id, item]))
  const lines: OrderProductLineModel[] = []
  const sourceSalesOrderLineIdByKey: Record<string, string> = {}
  const maximumQuantityByKey: Record<string, number> = {}
  let incompatibleCatalogCount = 0
  let exhaustedCount = 0

  for (const sourceLine of input.sourceLines) {
    if (sourceLine.remainingQuantity <= 0) {
      exhaustedCount += 1
      continue
    }
    const key = sourceLineKey(sourceLine.id)
    if (sourceLine.lineType === 'CATALOG') {
      const option = sourceLine.productId === null
        ? undefined
        : optionByProductId.get(sourceLine.productId)
      if (option === undefined) {
        incompatibleCatalogCount += 1
        continue
      }
      lines.push({
        actualUnitPriceAmount: null,
        description: sourceLine.description ?? '',
        key,
        lineType: 'CATALOG',
        mainImage: option.mainImage,
        name: option.name,
        productId: option.id,
        productNo: option.productNo,
        quantity: String(sourceLine.remainingQuantity),
        standardUnitPriceAmount: option.referencePurchaseUnitPriceAmount,
      })
    }
    else {
      lines.push({
        actualUnitPriceAmount: null,
        description: sourceLine.description ?? '',
        key,
        lineType: 'CUSTOM',
        mainImage: null,
        name: sourceLine.productName,
        productId: null,
        productNo: null,
        quantity: String(sourceLine.remainingQuantity),
        standardUnitPriceAmount: null,
      })
    }
    sourceSalesOrderLineIdByKey[key] = sourceLine.id
    maximumQuantityByKey[key] = sourceLine.remainingQuantity
  }

  return {
    exhaustedCount,
    incompatibleCatalogCount,
    lines,
    maximumQuantityByKey: Object.freeze(maximumQuantityByKey),
    sourceSalesOrderLineIdByKey: Object.freeze(sourceSalesOrderLineIdByKey),
  }
}

export function calculatePurchaseOrderDraftTotal(
  lines: readonly OrderProductLineModel[],
): string | null {
  let totalUnits = 0n
  for (const line of lines) {
    const price = normalizeUserAmount(line.actualUnitPriceAmount)
    const quantity = validQuantity(line.quantity)
    if (price === null || quantity === null) {
      return null
    }
    totalUnits += price.units * BigInt(quantity)
  }
  return formatAmountUnits(totalUnits)
}

export function buildPurchaseOrderCreateRequest(
  source: PurchaseOrderCreateSource,
): PurchaseOrderCreateBuildResult {
  const fieldErrors: Record<string, string> = {}
  const supplierValue = source.supplierValue.trim().normalize('NFKC')
  if (supplierValue === '') {
    fieldErrors.supplierValue = '请选择供应商'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(source.orderDate) || source.orderDate > source.today) {
    fieldErrors.orderDate = '采购日期不能为空且不能晚于今天'
  }
  if (source.purchaseType === 'SALES_LINKED' && source.salesOrderId === null) {
    fieldErrors.salesOrderId = '请选择关联销售订单'
  }
  if (source.purchaseType === 'STOCK' && source.salesOrderId !== null) {
    fieldErrors.salesOrderId = '备货采购不能关联销售订单'
  }
  if (source.lines.length === 0) {
    fieldErrors.lines = '请至少添加一条采购产品明细'
  }
  if (source.lines.length > MAXIMUM_LINES) {
    fieldErrors.lines = `采购产品明细最多 ${MAXIMUM_LINES} 行`
  }

  const requestLines: CreatePurchaseOrderRequestDto['lines'] = []
  let totalUnits = 0n
  source.lines.forEach((line, index) => {
    const prefix = `lines.${index}`
    const quantity = validQuantity(line.quantity)
    const actualPrice = normalizeUserAmount(line.actualUnitPriceAmount)
    const sourceSalesOrderLineId = source.sourceSalesOrderLineIdByKey[line.key]
    const maximumQuantity = source.maximumQuantityByKey[line.key]

    if (quantity === null) {
      fieldErrors[`${prefix}.quantity`] = '采购数量必须是正整数'
    }
    else if (maximumQuantity !== undefined && quantity > maximumQuantity) {
      fieldErrors[`${prefix}.quantity`] = `采购数量不能超过销售明细剩余可采购数量 ${maximumQuantity}`
    }
    if (actualPrice === null) {
      fieldErrors[`${prefix}.actualUnitPriceAmount`] = '本单采购价必须是非负且最多两位小数的金额'
    }
    if (source.purchaseType === 'SALES_LINKED' && sourceSalesOrderLineId === undefined) {
      fieldErrors[`${prefix}.sourceSalesOrderLineId`] = '关联采购明细必须来自所选销售订单'
    }

    if (line.lineType === 'CATALOG') {
      if (line.productId === null) {
        fieldErrors[`${prefix}.productId`] = '请选择有效的数据库产品'
      }
      if (line.standardUnitPriceAmount === null) {
        fieldErrors[`${prefix}.standardUnitPriceAmount`] = '数据库产品缺少采购定价'
      }
      if (quantity !== null && actualPrice !== null && line.productId !== null) {
        totalUnits += actualPrice.units * BigInt(quantity)
        requestLines.push({
          actualPurchaseUnitPriceAmount: actualPrice.normalized,
          // 数据库产品的名称、属性和行说明都由服务端依据产品档案及销售来源生成可信快照；
          // 客户端只提交身份、真实采购价和数量，避免把编辑态展示字段带入创建契约。
          lineType: 'CATALOG',
          productId: line.productId,
          ...(source.purchaseType === 'SALES_LINKED'
            && sourceSalesOrderLineId !== undefined
            ? { sourceSalesOrderLineId }
            : {}),
          quantity,
        })
      }
      return
    }

    const name = line.name.trim().normalize('NFKC')
    const referencePrice = normalizeUserAmount(line.standardUnitPriceAmount)
    if (name === '') {
      fieldErrors[`${prefix}.name`] = '请输入临时产品名称'
    }
    if (referencePrice === null) {
      fieldErrors[`${prefix}.standardUnitPriceAmount`] = '采购定价必须手工填写且最多两位小数'
    }
    if (
      referencePrice !== null
      && actualPrice !== null
      && referencePrice.units !== actualPrice.units
    ) {
      fieldErrors[`${prefix}.actualUnitPriceAmount`] = '临时产品的采购定价必须与本单采购价相等'
    }
    if (
      quantity !== null
      && actualPrice !== null
      && referencePrice !== null
      && name !== ''
    ) {
      totalUnits += actualPrice.units * BigInt(quantity)
      requestLines.push({
        actualPurchaseUnitPriceAmount: actualPrice.normalized,
        description: normalizeOptionalText(line.description),
        lineType: 'CUSTOM',
        name,
        quantity,
        referencePurchaseUnitPriceAmount: referencePrice.normalized,
        ...(source.purchaseType === 'SALES_LINKED'
          && sourceSalesOrderLineId !== undefined
          ? { sourceSalesOrderLineId }
          : {}),
      })
    }
  })

  const purchaseTotalAmount = source.lines.length === 0
    ? null
    : formatAmountUnits(totalUnits)
  const deposit = normalizeUserAmount(source.depositDueAmount)
  const balance = normalizeUserAmount(source.balanceDueAmount)
  if (deposit === null) {
    fieldErrors.depositDueAmount = '定金必须是非负且最多两位小数的金额'
  }
  if (balance === null) {
    fieldErrors.balanceDueAmount = '尾款必须是非负且最多两位小数的金额'
  }
  if (deposit !== null && balance !== null && deposit.units + balance.units !== totalUnits) {
    fieldErrors.balanceDueAmount = '采购总价必须等于定金与尾款之和'
  }

  const shippingMarkText = normalizeOptionalText(source.shippingMarkText)
  const remark = normalizeOptionalText(source.remark)
  if (shippingMarkText !== null && unicodeLength(shippingMarkText) > 2000) {
    fieldErrors.shippingMarkText = '采购唛头最多 2000 个字符'
  }
  if (remark !== null && unicodeLength(remark) > 1000) {
    fieldErrors.remark = '备注最多 1000 个字符'
  }
  if (Object.keys(fieldErrors).length > 0 || purchaseTotalAmount === null) {
    return {
      fieldErrors: Object.freeze(fieldErrors),
      purchaseTotalAmount,
      valid: false,
    }
  }

  return {
    fieldErrors: Object.freeze({}),
    purchaseTotalAmount,
    request: {
      balanceDueAmount: balance!.normalized,
      depositDueAmount: deposit!.normalized,
      lines: requestLines,
      orderDate: source.orderDate,
      purchaseTotalAmount,
      purchaseType: source.purchaseType,
      remark,
      ...(source.purchaseType === 'SALES_LINKED'
        ? { salesOrderId: source.salesOrderId! }
        : {}),
      shippingMarkText,
      supplierValue,
    },
    valid: true,
  }
}

/**
 * “下一步”复用最终创建请求的领域校验，但只返回当前步骤能够修正的错误。
 * 后续步骤尚未填写时不会污染当前页面，最终进入核对前仍会执行一次完整校验。
 */
export function validatePurchaseOrderCreateStep(
  source: PurchaseOrderCreateSource,
  step: PurchaseOrderFormStep,
): ValidatePurchaseOrderCreateStepResult {
  const result = buildPurchaseOrderCreateRequest(source)
  if (result.valid) {
    return { valid: true }
  }
  const fieldErrors = Object.fromEntries(
    Object.entries(result.fieldErrors).filter(([path]) => (
      resolvePurchaseOrderCreateStepForField(path) === step
    )),
  )
  return Object.keys(fieldErrors).length === 0
    ? { valid: true }
    : { fieldErrors: Object.freeze(fieldErrors), valid: false }
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

export function createPurchaseOrderEditingState(): PurchaseOrderEditingState {
  return Object.freeze({ phase: 'editing' })
}

export function beginPurchaseOrderSubmission(
  state: PurchaseOrderEditingState,
  request: CreatePurchaseOrderRequestDto,
  context: { readonly authEpoch: number, readonly requestVersion: number },
  keyFactory: () => string = () => globalThis.crypto.randomUUID(),
): PurchaseOrderSubmittingState {
  if (state.phase !== 'editing') {
    throw new TypeError('只有编辑状态可以确认采购订单')
  }
  return Object.freeze({
    ...context,
    idempotencyKey: keyFactory(),
    phase: 'submitting',
    snapshot: deepFreeze(structuredClone(request)),
  })
}

export function resolvePurchaseOrderSubmissionFailure(
  state: PurchaseOrderSubmittingState,
  failure: PurchaseOrderMutationFailure,
): PurchaseOrderEditingState | PurchaseOrderUnknownState {
  return failure.unknownResult
    ? Object.freeze({
        authEpoch: state.authEpoch,
        failure,
        idempotencyKey: state.idempotencyKey,
        phase: 'unknown',
        requestVersion: state.requestVersion,
        snapshot: state.snapshot,
      })
    : createPurchaseOrderEditingState()
}

export function replayUnknownPurchaseOrderSubmission(
  state: PurchaseOrderUnknownState,
  context: { readonly authEpoch: number, readonly requestVersion: number },
): PurchaseOrderSubmittingState {
  if (state.authEpoch !== context.authEpoch) {
    throw new TypeError('身份域变化后不能重放旧的采购订单请求')
  }
  return Object.freeze({
    authEpoch: state.authEpoch,
    idempotencyKey: state.idempotencyKey,
    phase: 'submitting',
    requestVersion: context.requestVersion,
    snapshot: state.snapshot,
  })
}

export function resolvePurchaseOrderSubmissionSuccess(
  state: PurchaseOrderSubmittingState,
  purchaseOrder: PurchaseOrderDetailDto,
): PurchaseOrderSuccessState {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能完成提交中的采购订单请求')
  }
  return Object.freeze({
    phase: 'success',
    purchaseOrder: deepFreeze(structuredClone(purchaseOrder)),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstMessage(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string'
    ? value[0]
    : typeof value === 'string'
      ? value
      : undefined
}

export function getPurchaseOrderMutationFailure(
  error: unknown,
): PurchaseOrderMutationFailure {
  const fallback: PurchaseOrderMutationFailure = {
    fieldErrors: {},
    message: '采购订单确认失败，请稍后重试',
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
  const body = isRecord(error.body) ? error.body : undefined
  const fieldErrors: Record<string, string> = {}
  if (isRecord(body?.fieldErrors)) {
    for (const [field, messages] of Object.entries(body.fieldErrors)) {
      const message = firstMessage(messages)
      if (message !== undefined) {
        fieldErrors[field] = message
      }
    }
  }
  const status = typeof error.status === 'number' ? error.status : undefined
  return {
    fieldErrors: Object.freeze(fieldErrors),
    message: typeof body?.message === 'string'
      ? body.message
      : typeof error.message === 'string'
        ? error.message
        : fallback.message,
    requestId: typeof body?.requestId === 'string'
      ? body.requestId
      : typeof error.requestId === 'string'
        ? error.requestId
        : undefined,
    unknownResult: status === undefined || status >= 500,
  }
}
