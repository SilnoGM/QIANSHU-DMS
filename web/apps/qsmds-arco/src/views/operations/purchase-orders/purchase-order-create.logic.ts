import type {
  CreatePurchaseOrderRequestDto,
  PurchaseOrderDetailDto,
  PurchaseOrderProductOptionDto,
  PurchaseOrderProductOptionsDto,
  PurchaseOrderSourceSalesOrderLineDto,
} from '../../../api/generated/types.gen'
import type { PaymentRecipientAccountInputDto } from '../../../api/modules/payment-recipients'
import type {
  OrderProductLineModel,
  OrderProductLineReadOnlyModel,
} from '../../../components/business/QsOrderProductLineEditor/types'
import type { PartConfiguration } from '../../../components/business/QsPartConfigurator/types'
import type { ProductSelectorPage } from '../../../components/business/QsProductSelector/types'
import { normalizePaymentRecipientAccounts, validatePaymentRecipientAccounts } from '../../../components/business/QsPaymentRecipientEditor/logic'
import { buildPurchaseOrderParts } from './purchase-order-parts.logic'

export type PurchaseOrderCreateType = 'SALES_LINKED' | 'STOCK'
export type PurchaseOrderCreateProductMode = 'CATALOG' | 'CUSTOM'
export type PurchaseOrderCreateStep = 0 | 1 | 2 | 3
export type PurchaseOrderFormStep = Exclude<PurchaseOrderCreateStep, 3>

export interface PurchaseOrderSourceShortcut {
  readonly salesOrderId: string
  readonly salesOrderNo: string
}

export type PurchaseOrderCreateContext
  = | {
    readonly customSupplierName: null
    readonly productMode: 'CATALOG'
    readonly purchaseType: PurchaseOrderCreateType
    readonly sourceShortcut: PurchaseOrderSourceShortcut | null
    readonly supplierValue: string
  }
  | {
    readonly customSupplierName: string
    readonly productMode: 'CUSTOM'
    readonly purchaseType: PurchaseOrderCreateType
    readonly sourceShortcut: PurchaseOrderSourceShortcut | null
    readonly supplierValue: null
  }

export const PURCHASE_ORDER_CREATE_REVIEW_STEP: PurchaseOrderCreateStep = 3

export interface PurchaseOrderCreateSource {
  readonly balanceDueAmount: string | null
  readonly depositDueAmount: string | null
  readonly lines: readonly OrderProductLineModel[]
  readonly parts: readonly PartConfiguration[]
  readonly maximumQuantityByKey: Readonly<Record<string, number | undefined>>
  readonly orderDate: string
  readonly productMode: PurchaseOrderCreateProductMode
  readonly purchaseType: PurchaseOrderCreateType
  readonly remark: string
  readonly salesOrderId: string | null
  readonly expectedShippingMarkResolution: string | null
  readonly sourceSalesOrderLineIdByKey: Readonly<Record<string, string | undefined>>
  readonly supplierValue: string | null
  readonly customSupplierName: string | null
  readonly today: string
  readonly paymentAccounts?: readonly PaymentRecipientAccountInputDto[]
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
  readonly readOnlyLines: readonly OrderProductLineReadOnlyModel[]
  readonly sourceSalesOrderLineIdByKey: Readonly<Record<string, string>>
}

export interface PurchaseOrderMutationFailure {
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId?: string
  readonly unknownResult: boolean
  readonly refreshShippingMarkResolution?: boolean
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

function parseRouteText(value: unknown, maximumLength = 128): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.normalize('NFKC').trim()
  return normalized !== '' && unicodeLength(normalized) <= maximumLength
    ? normalized
    : null
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
 * 采购创建页只能接受入口弹窗生成的完整上下文。产品类型与供应商来源组成互斥
 * 联合，任何数组、缺失字段或双供应商字段都会整体拒绝，页面随后安全返回列表。
 */
export function parsePurchaseOrderCreateContext(input: {
  readonly canCreateStock: boolean
  readonly customSupplierName: unknown
  readonly productMode: unknown
  readonly purchaseType: unknown
  readonly salesOrderId: unknown
  readonly salesOrderNo: unknown
  readonly supplierValue: unknown
}): PurchaseOrderCreateContext | null {
  const purchaseType = parsePurchaseOrderCreateType(
    input.purchaseType,
    input.canCreateStock,
  )
  if (
    purchaseType === null
    || (input.productMode !== 'CATALOG' && input.productMode !== 'CUSTOM')
  ) {
    return null
  }

  const hasShortcutField = input.salesOrderId !== undefined
    || input.salesOrderNo !== undefined
  const sourceShortcut = hasShortcutField
    ? parsePurchaseOrderSourceShortcut({
        purchaseType,
        salesOrderId: input.salesOrderId,
        salesOrderNo: input.salesOrderNo,
      })
    : null
  if (hasShortcutField && sourceShortcut === null) {
    return null
  }

  if (input.productMode === 'CATALOG') {
    const supplierValue = parseRouteText(input.supplierValue)
    if (supplierValue === null || input.customSupplierName !== undefined) {
      return null
    }
    return {
      customSupplierName: null,
      productMode: 'CATALOG',
      purchaseType,
      sourceShortcut,
      supplierValue,
    }
  }

  const customSupplierName = parseRouteText(input.customSupplierName)
  if (customSupplierName === null || input.supplierValue !== undefined) {
    return null
  }
  return {
    customSupplierName,
    productMode: 'CUSTOM',
    purchaseType,
    sourceShortcut,
    supplierValue: null,
  }
}

/**
 * 将服务端和客户端共享的字段路径定位到采购创建页的可编辑步骤。
 * 第四步是只读核对面，不承载字段；未知路径保留在全局错误区，避免错误地
 * 把用户带到一个无法修正该问题的步骤。
 */
export function resolvePurchaseOrderCreateStepForField(
  path: string,
): PurchaseOrderFormStep | null {
  if (
    path === 'orderDate'
    || path === 'supplierValue'
    || path === 'customSupplierName'
    || path === 'paymentAccounts'
    || path.startsWith('paymentAccounts.')
    || path === 'salesOrderId'
  ) {
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
  if (path === 'expectedShippingMarkResolution' || path === 'remark' || path === 'parts' || path.startsWith('parts.')) {
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
 * 来源接口会保留已经采购完毕的销售明细用于数量审计，因此不能只用数组长度
 * 判断是否可同步；至少一行剩余数量大于零时，采购表单才有可继续处理的来源。
 */
export function hasPurchasablePurchaseOrderSourceLines(
  sourceLines: readonly PurchaseOrderSourceSalesOrderLineDto[],
): boolean {
  return sourceLines.some(line => line.remainingQuantity > 0)
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
  const readOnlyLines: OrderProductLineReadOnlyModel[] = []
  const sourceSalesOrderLineIdByKey: Record<string, string> = {}
  const maximumQuantityByKey: Record<string, number> = {}
  let incompatibleCatalogCount = 0
  let exhaustedCount = 0

  for (const sourceLine of input.sourceLines) {
    const option = sourceLine.productId === null
      ? undefined
      : optionByProductId.get(sourceLine.productId)
    for (const purchasedLine of sourceLine.purchasedLines) {
      // 每条有效采购明细独立展示，价格、小计和备注使用采购单保存时的快照；
      // 当前产品档案只补充可选主图，不会把历史行并入本次采购表单模型。
      readOnlyLines.push({
        actualSubtotalAmount: purchasedLine.lineTotalAmount,
        actualUnitPriceAmount: purchasedLine.actualPurchaseUnitPriceAmount,
        description: purchasedLine.description ?? '',
        key: `purchased-${purchasedLine.id}`,
        lineType: sourceLine.lineType,
        mainImage: sourceLine.lineType === 'CATALOG'
          ? option?.mainImage ?? null
          : null,
        name: sourceLine.productName,
        productNo: sourceLine.productNo,
        quantity: String(purchasedLine.quantity),
        standardUnitPriceAmount: purchasedLine.referencePurchaseUnitPriceAmount,
        statusDescription:
          `该销售订单中的本产品已经存在有效的采购单，已采购数量${purchasedLine.quantity}件`,
        statusLabel: '已采购',
      })
    }
    if (sourceLine.remainingQuantity <= 0) {
      exhaustedCount += 1
      continue
    }
    const key = sourceLineKey(sourceLine.id)
    if (sourceLine.lineType === 'CATALOG') {
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
    readOnlyLines: Object.freeze(readOnlyLines),
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
  if (source.productMode === 'CUSTOM' && validatePaymentRecipientAccounts(source.paymentAccounts ?? [], 1)) {
    fieldErrors.paymentAccounts = '请完整填写至少一种本单收款方式'
  }
  const supplierValue = source.supplierValue?.trim().normalize('NFKC') ?? null
  const customSupplierName = source.customSupplierName?.trim().normalize('NFKC') ?? null
  if (source.productMode === 'CATALOG' && !supplierValue) {
    fieldErrors.supplierValue = '请选择供应商'
  }
  if (
    source.productMode === 'CUSTOM'
    && (!customSupplierName || unicodeLength(customSupplierName) > 128)
  ) {
    fieldErrors.customSupplierName = '请输入 1 至 128 个字符的供应商名称'
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

    if (line.lineType !== source.productMode) {
      fieldErrors[`${prefix}.lineType`] = source.productMode === 'CATALOG'
        ? '产品库产品采购只能提交数据库产品'
        : '自定义产品采购只能提交临时产品'
    }

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

  const expectedShippingMarkResolution = source.expectedShippingMarkResolution
  const configuredParts = buildPurchaseOrderParts(source.lines, source.parts)
  if (!configuredParts.valid) {
    fieldErrors.parts = configuredParts.message
  }
  const remark = normalizeOptionalText(source.remark)
  if (expectedShippingMarkResolution === null || !/^[a-f0-9]{64}$/u.test(expectedShippingMarkResolution)) {
    fieldErrors.expectedShippingMarkResolution = '请先取得可用的采购唛头规则并核对'
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
      parts: configuredParts.valid ? configuredParts.parts : [],
      orderDate: source.orderDate,
      productMode: source.productMode,
      purchaseTotalAmount,
      purchaseType: source.purchaseType,
      remark,
      ...(source.purchaseType === 'SALES_LINKED'
        ? { salesOrderId: source.salesOrderId! }
        : {}),
      expectedShippingMarkResolution: expectedShippingMarkResolution!,
      ...(source.productMode === 'CATALOG'
        ? { supplierValue: supplierValue! }
        : { customSupplierName: customSupplierName!, paymentAccounts: normalizePaymentRecipientAccounts(source.paymentAccounts ?? []) }),
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
  const refreshShippingMarkResolution = status === 409 && (
    body?.code === 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED'
    || body?.code === 'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE'
  )
  if (refreshShippingMarkResolution) {
    fieldErrors.expectedShippingMarkResolution = typeof body?.message === 'string'
      ? body.message
      : '采购唛头规则已变化或不可用，请刷新核对'
  }
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
    ...(refreshShippingMarkResolution ? { refreshShippingMarkResolution: true } : {}),
  }
}
