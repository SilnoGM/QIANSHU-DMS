<script setup lang="ts">
import type { StepsItem } from '@fantastic-admin/components'
import type { DateValue } from '@internationalized/date'
import type {
  PurchaseOrderCreateStep,
  PurchaseOrderFormStep,
  PurchaseOrderSubmissionState,
  PurchaseOrderSubmittingState,
} from './purchase-order-create.logic'
import type {
  PurchaseOrderSourceSalesOrderLineDto,
  PurchaseOrderSourceSalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type {
  OrderProductLineLabels,
  OrderProductLineModel,
} from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'

import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { useMediaQuery } from '@vueuse/core'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsOrderProductLineEditor from '@/components/business/QsOrderProductLineEditor/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import PurchaseOrderCreateReview from './purchase-order-create-review.vue'
import {
  adaptPurchaseOrderProductPage,
  beginPurchaseOrderSubmission,
  buildPurchaseOrderCreateRequest,
  calculatePurchaseOrderDraftTotal,
  createPurchaseOrderEditingState,
  getPurchaseOrderMutationFailure,
  parsePurchaseOrderCreateType,
  PURCHASE_ORDER_CREATE_REVIEW_STEP,
  replayUnknownPurchaseOrderSubmission,
  resolvePurchaseOrderCreateStepForErrors,
  resolvePurchaseOrderCreateStepForField,
  resolvePurchaseOrderSubmissionFailure,
  resolvePurchaseOrderSubmissionSuccess,
  synchronizePurchaseOrderSourceLines,
  validatePurchaseOrderCreateStep,
} from './purchase-order-create.logic'
import {
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
} from './purchase-order-list.logic'
import PurchaseOrderPaymentTerms from './purchase-order-payment-terms.vue'
import PurchaseSourceSalesOrderSelector from './purchase-source-sales-order-selector.vue'

defineOptions({ name: 'OperationsPurchaseOrderCreate' })

type PurchaseOrderCreateSurface = 'form' | 'review'

const purchaseOrderSteps: StepsItem[] = [
  { id: 'base', title: '采购基础信息' },
  { id: 'products-payment', title: '采购产品与付款' },
  { id: 'mark-remark', title: '唛头与备注' },
  { id: 'review', title: '订单详情核对' },
]

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog('service_provider.supplier')
const todayDate = today(getLocalTimeZone())
const todayIso = todayDate.toString()
const canCreate = computed(() => auth('purchase-orders:create'))
const canCreateStock = computed(() => auth('purchase-orders:create-stock'))
const purchaseType = parsePurchaseOrderCreateType(route.query.type, canCreateStock.value)

const lineLabels: OrderProductLineLabels = {
  actualSubtotal: '本单采购小计',
  actualTotal: '本单采购总价',
  actualUnitPrice: '本单采购价',
  catalogProduct: '数据库产品',
  referenceTotal: '采购定价总计',
  referenceUnitPrice: '采购定价',
  temporaryProduct: '临时产品',
  temporaryProductNo: 'CUSTOM',
}

const formModel = reactive({
  balanceDueAmount: null as string | null,
  depositDueAmount: null as string | null,
  lines: [] as OrderProductLineModel[],
  orderDate: todayIso,
  remark: '',
  shippingMarkText: '',
  supplierValue: null as string | null,
})
const selectedSalesOrder = shallowRef<PurchaseOrderSourceSalesOrderListItemDto | null>(null)
const sourceSalesOrderLines = shallowRef<readonly PurchaseOrderSourceSalesOrderLineDto[]>([])
const sourceSalesOrderLineIdByKey = shallowRef<Readonly<Record<string, string | undefined>>>({})
const maximumQuantityByKey = shallowRef<Readonly<Record<string, number | undefined>>>({})
const sourceSelectorVisible = ref(false)
const sourceLoading = ref(false)
const synchronizing = ref(false)
const sourceError = ref('')
const fieldErrors = shallowRef<Readonly<Record<string, string>>>({})
const formError = ref('')
const requestId = ref<string>()
const createSurface = ref<PurchaseOrderCreateSurface>('form')
const activeStep = ref<PurchaseOrderCreateStep>(0)
const furthestReachedStep = ref<PurchaseOrderCreateStep>(0)
const detailsDrawerVisible = ref(false)
const submitConfirmVisible = ref(false)
const discardVisible = ref(false)
const createPageRef = useTemplateRef<HTMLElement>('createPageRef')
const stepNavigationRef = useTemplateRef<HTMLElement>('stepNavigationRef')
const reviewHeadingRef = useTemplateRef<HTMLElement>('reviewHeadingRef')
const supplierSelectRef = useTemplateRef<InstanceType<typeof QsDictionarySelect>>('supplierSelectRef')
const isDesktopSummary = useMediaQuery('(min-width: 1280px)')
const submission = shallowRef<PurchaseOrderSubmissionState>(createPurchaseOrderEditingState())
let sourceAbortController: AbortController | null = null
let synchronizeAbortController: AbortController | null = null
let submitAbortController: AbortController | null = null
let submitRequestVersion = 0
let pendingNavigationResolver: ((allow: boolean) => void) | null = null

const fixedCurrencies = computed(() => currencyCatalog.currencies.value.filter(item => (
  item.code === 'CNY'
)))
const currencyUnavailable = computed(() => (
  currencyCatalog.loading.value
  || currencyCatalog.errorMessage.value !== null
  || fixedCurrencies.value[0]?.enabled !== true
))
const orderDateValue = computed(() => parseDate(formModel.orderDate))
const purchaseTotalAmount = computed(() => calculatePurchaseOrderDraftTotal(formModel.lines))
const selectedSupplierDisplayLabel = computed(() => (
  supplierCatalog.resolve(formModel.supplierValue)?.displayLabel
  ?? formModel.supplierValue
  ?? '—'
))
const submitLocked = computed(() => submission.value.phase === 'submitting')
const guidedCreate = computed(() => purchaseType === 'SALES_LINKED')
const sourceReady = computed(() => (
  purchaseType === 'SALES_LINKED'
  && selectedSalesOrder.value !== null
  && sourceSalesOrderLines.value.length > 0
  && formModel.supplierValue !== null
))
const shouldConfirmDiscard = computed(() => (
  submission.value.phase !== 'success'
  && (
    formModel.supplierValue !== null
    || formModel.lines.length > 0
    || formModel.depositDueAmount !== null
    || formModel.balanceDueAmount !== null
    || formModel.shippingMarkText !== ''
    || formModel.remark !== ''
    || selectedSalesOrder.value !== null
  )
))
const title = purchaseType === 'STOCK' ? '新增备货采购' : '新增采购订单'
const typeDescription = purchaseType === 'STOCK'
  ? '管理员独立创建备货采购，不关联销售订单。'
  : '分步骤完成采购资料，并在订单详情全屏核对后正式提交。'
const formErrorDisplay = computed(() => requestId.value === undefined
  ? formError.value
  : `${formError.value}（请求编号：${requestId.value}）`)
const activeStepTitle = computed(() => purchaseOrderSteps[activeStep.value]?.title ?? '')
const submitStatusMessage = computed(() => {
  if (submission.value.phase === 'submitting') {
    return '采购订单正在保存并派发编号，请勿重复操作。'
  }
  if (submission.value.phase === 'unknown') {
    return '保存结果暂时未知，请使用原请求重新确认，避免产生重复采购订单。'
  }
  if (currencyUnavailable.value) {
    return 'CNY 当前不可用，暂时无法提交采购订单。'
  }
  return '全部步骤已完成且校验通过，可以提交并幂等派发采购订单号。'
})
const submitReady = computed(() => (
  createSurface.value === 'review'
  && submission.value.phase === 'editing'
  && !currencyUnavailable.value
  && furthestReachedStep.value === PURCHASE_ORDER_CREATE_REVIEW_STEP
))

const loadPurchaseProducts: ProductPageLoader = async (query, signal) => {
  const supplierValue = query.supplierValue ?? formModel.supplierValue
  if (supplierValue === null || supplierValue === undefined || supplierValue === '') {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 }
  }
  const response = await purchaseOrdersApi.productOptions({
    ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    page: query.page,
    pageSize: query.pageSize,
    supplierValue,
  }, signal)
  return adaptPurchaseOrderProductPage(response.data)
}

async function loadSourceSalesOrders(
  query: { keyword?: string, page: number, pageSize: number },
  signal: AbortSignal,
) {
  const response = await purchaseOrdersApi.sourceSalesOrders(query, signal)
  return response.data
}

function clearFeedback(): void {
  fieldErrors.value = {}
  formError.value = ''
  requestId.value = undefined
}

function updateOrderDate(value: DateValue | DateValue[] | undefined): void {
  if (value === undefined || Array.isArray(value) || submitLocked.value) {
    return
  }
  formModel.orderDate = value.toString()
  clearFeedback()
}

function handleSupplierUpdate(value: string | null): void {
  if (submitLocked.value || value === formModel.supplierValue) {
    return
  }
  formModel.supplierValue = value
  clearFeedback()
  if (purchaseType === 'SALES_LINKED' && formModel.lines.length > 0) {
    // 正式产品的采购成本和供应商绑定；切换供应商后必须重新求交集，不能沿用旧快照。
    formModel.lines = []
    sourceSalesOrderLineIdByKey.value = {}
    maximumQuantityByKey.value = {}
    toast.info('供应商已变更，请重新同步销售产品明细')
  }
}

function handleLinesUpdate(lines: readonly OrderProductLineModel[]): void {
  formModel.lines = lines.map(line => ({ ...line }))
  clearFeedback()
}

function handleDepositUpdate(value: string | null): void {
  formModel.depositDueAmount = value
  clearFeedback()
}

function handleBalanceUpdate(value: string | null): void {
  formModel.balanceDueAmount = value
  clearFeedback()
}

function handleShippingMarkUpdate(value: unknown): void {
  formModel.shippingMarkText = String(value ?? '')
  clearFeedback()
}

function handleRemarkUpdate(value: unknown): void {
  formModel.remark = String(value ?? '')
  clearFeedback()
}

async function selectSourceSalesOrder(
  item: PurchaseOrderSourceSalesOrderListItemDto,
): Promise<void> {
  sourceAbortController?.abort()
  const controller = new AbortController()
  sourceAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  selectedSalesOrder.value = item
  sourceSalesOrderLines.value = []
  formModel.lines = []
  sourceSalesOrderLineIdByKey.value = {}
  maximumQuantityByKey.value = {}
  sourceLoading.value = true
  sourceError.value = ''
  clearFeedback()
  try {
    const response = await purchaseOrdersApi.sourceSalesOrderLines(item.id, controller.signal)
    if (
      controller.signal.aborted
      || authEpoch !== appAccountStore.authEpoch
      || selectedSalesOrder.value?.id !== item.id
    ) {
      return
    }
    sourceSalesOrderLines.value = response.data.items
    if (response.data.items.length === 0) {
      sourceError.value = '该销售订单当前没有剩余可采购产品'
    }
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    sourceError.value = getPurchaseOrderApiFailure(error).message
  }
  finally {
    if (sourceAbortController === controller) {
      sourceAbortController = null
      sourceLoading.value = false
    }
  }
}

async function loadAllSupplierProducts(signal: AbortSignal) {
  const supplierValue = formModel.supplierValue
  if (supplierValue === null) {
    return []
  }
  const products = []
  let page = 1
  let total = 0
  do {
    const response = await purchaseOrdersApi.productOptions({
      page,
      pageSize: 100,
      supplierValue,
    }, signal)
    products.push(...response.data.items)
    total = response.data.total
    page += 1
  } while (products.length < total)
  return products
}

async function synchronizeSourceProducts(): Promise<void> {
  if (!sourceReady.value || synchronizing.value) {
    return
  }
  synchronizeAbortController?.abort()
  const controller = new AbortController()
  synchronizeAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  synchronizing.value = true
  sourceError.value = ''
  try {
    const productOptions = await loadAllSupplierProducts(controller.signal)
    if (controller.signal.aborted || authEpoch !== appAccountStore.authEpoch) {
      return
    }
    const result = synchronizePurchaseOrderSourceLines({
      productOptions,
      sourceLines: sourceSalesOrderLines.value,
    })
    formModel.lines = result.lines.map(line => ({ ...line }))
    sourceSalesOrderLineIdByKey.value = result.sourceSalesOrderLineIdByKey
    maximumQuantityByKey.value = result.maximumQuantityByKey
    clearFeedback()
    if (result.lines.length === 0) {
      sourceError.value = '当前供应商没有可同步的销售产品明细'
      return
    }
    const skipped = result.incompatibleCatalogCount + result.exhaustedCount
    toast.success(skipped === 0
      ? `已同步 ${result.lines.length} 条销售产品明细`
      : `已同步 ${result.lines.length} 条，跳过 ${skipped} 条不可采购明细`)
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    sourceError.value = getPurchaseOrderApiFailure(error).message
  }
  finally {
    if (synchronizeAbortController === controller) {
      synchronizeAbortController = null
      synchronizing.value = false
    }
  }
}

function buildCurrentSource() {
  if (purchaseType === null) {
    return null
  }
  return {
    balanceDueAmount: formModel.balanceDueAmount,
    depositDueAmount: formModel.depositDueAmount,
    lines: formModel.lines,
    maximumQuantityByKey: maximumQuantityByKey.value,
    orderDate: formModel.orderDate,
    purchaseType,
    remark: formModel.remark,
    salesOrderId: selectedSalesOrder.value?.id ?? null,
    shippingMarkText: formModel.shippingMarkText,
    sourceSalesOrderLineIdByKey: sourceSalesOrderLineIdByKey.value,
    supplierValue: formModel.supplierValue ?? '',
    today: todayIso,
  } as const
}

function buildCurrentRequest() {
  const source = buildCurrentSource()
  return source === null ? null : buildPurchaseOrderCreateRequest(source)
}

function goToFormStep(step: number): void {
  activeStep.value = Math.min(Math.max(step, 0), 2) as PurchaseOrderFormStep
  // 每个步骤高度不同，回到进度区可以避免沿用上一页底部的滚动位置。
  void nextTick(() => {
    stepNavigationRef.value?.scrollIntoView({ block: 'start' })
    stepNavigationRef.value?.focus({ preventScroll: true })
  })
}

function previousStep(): void {
  if (!guidedCreate.value || createSurface.value !== 'form') {
    return
  }
  goToFormStep(activeStep.value - 1)
}

async function focusPurchaseOrderReview(): Promise<void> {
  await nextTick()
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  reviewHeadingRef.value?.scrollIntoView({ behavior: 'auto', block: 'start' })
  reviewHeadingRef.value?.focus({ preventScroll: true })
}

/**
 * 第三步的“下一步”只切换到只读核对面。这里执行完整领域校验，但不会创建
 * 幂等键、冻结请求快照或访问创建 API；编号仍只在最终二次确认后派发。
 */
function enterPurchaseOrderReview(): void {
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '部分采购资料未通过校验，请修正后再进入订单详情核对'
    const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
    if (errorStep !== null) {
      goToFormStep(errorStep)
      focusFirstInvalidField(fieldErrors.value)
    }
    return
  }
  clearFeedback()
  furthestReachedStep.value = PURCHASE_ORDER_CREATE_REVIEW_STEP
  activeStep.value = PURCHASE_ORDER_CREATE_REVIEW_STEP
  detailsDrawerVisible.value = false
  createSurface.value = 'review'
  toast.info('请检查采购订单信息是否正确')
  void focusPurchaseOrderReview()
}

function nextStep(): void {
  if (
    !guidedCreate.value
    || createSurface.value !== 'form'
    || activeStep.value === PURCHASE_ORDER_CREATE_REVIEW_STEP
  ) {
    return
  }
  if (activeStep.value === 0 && currencyUnavailable.value) {
    formError.value = 'CNY 当前不可用，请等待货币资料加载完成后再继续'
    return
  }
  const source = buildCurrentSource()
  if (source === null) {
    return
  }
  const step = activeStep.value as PurchaseOrderFormStep
  const result = validatePurchaseOrderCreateStep(source, step)
  if (!result.valid) {
    fieldErrors.value = { ...fieldErrors.value, ...result.fieldErrors }
    formError.value = '请先完成并修正当前步骤的必填资料'
    focusFirstInvalidField(result.fieldErrors)
    return
  }

  // 本步骤重新校验通过后只清理本步骤旧错误，其他步骤的服务端错误仍需保留。
  fieldErrors.value = Object.freeze(Object.fromEntries(
    Object.entries(fieldErrors.value).filter(([path]) => (
      resolvePurchaseOrderCreateStepForField(path) !== step
    )),
  ))
  formError.value = ''
  requestId.value = undefined
  if (step === 2) {
    enterPurchaseOrderReview()
    return
  }
  furthestReachedStep.value = Math.max(furthestReachedStep.value, step + 1) as PurchaseOrderCreateStep
  goToFormStep(step + 1)
}

function returnToPurchaseOrderForm(): void {
  if (!guidedCreate.value || submitLocked.value || createSurface.value !== 'review') {
    return
  }
  createSurface.value = 'form'
  goToFormStep(2)
}

function openDetailsDrawer(): void {
  if (guidedCreate.value && !isDesktopSummary.value && createSurface.value === 'form') {
    detailsDrawerVisible.value = true
  }
}

/** 校验失败后聚焦第一个公开错误字段，避免键盘用户只能从页头重新寻找。 */
function focusFirstInvalidField(errors: Readonly<Record<string, string>>): void {
  const firstField = Object.keys(errors)[0]
  if (firstField === undefined) {
    return
  }
  void nextTick(() => {
    if (firstField === 'supplierValue') {
      supplierSelectRef.value?.focus()
      return
    }
    const root = createPageRef.value
    if (root === null) {
      return
    }
    const directLabels: Readonly<Record<string, string>> = {
      balanceDueAmount: '尾款',
      depositDueAmount: '定金',
      lines: '添加数据库产品',
      orderDate: '采购日期',
      salesOrderId: '选择销售订单',
    }
    let label = directLabels[firstField]
    const lineField = /^lines\.(\d+)\.(.+)$/u.exec(firstField)
    if (lineField !== null) {
      const lineNumber = Number(lineField[1]) + 1
      const lineLabelByField: Readonly<Record<string, string>> = {
        actualUnitPriceAmount: '本单采购价',
        name: '产品名称',
        quantity: '产品数量',
        standardUnitPriceAmount: '采购定价',
      }
      const suffix = lineLabelByField[lineField[2] ?? ''] ?? '本单采购价'
      label = `第 ${lineNumber} 行${suffix}`
    }
    const control = label === undefined
      ? null
      : root.querySelector<HTMLElement>(`[aria-label="${label}"]`)
        ?? [...root.querySelectorAll<HTMLElement>('button')].find(button => (
          button.textContent?.trim() === label
        ))
    control?.focus({ preventScroll: false })
  })
}

function requestSubmit(): void {
  if (
    !canCreate.value
    || submitLocked.value
    || currencyUnavailable.value
    || (guidedCreate.value && createSurface.value !== 'review')
  ) {
    return
  }
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '请修正采购订单中的必填项和金额后再提交'
    if (guidedCreate.value) {
      createSurface.value = 'form'
      const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
      goToFormStep(errorStep ?? 2)
    }
    focusFirstInvalidField(fieldErrors.value)
    return
  }
  clearFeedback()
  submitConfirmVisible.value = true
}

async function executeSubmission(state: PurchaseOrderSubmittingState): Promise<void> {
  submitAbortController?.abort()
  const controller = new AbortController()
  submitAbortController = controller
  try {
    const response = await purchaseOrdersApi.create(
      state.snapshot,
      state.idempotencyKey,
      controller.signal,
    )
    if (
      controller.signal.aborted
      || state.requestVersion !== submitRequestVersion
      || state.authEpoch !== appAccountStore.authEpoch
    ) {
      return
    }
    submission.value = resolvePurchaseOrderSubmissionSuccess(state, response.data)
    submitConfirmVisible.value = false
    toast.success(`采购订单 ${response.data.orderNo} 创建成功`)
    void router.push({ name: 'qsOperationsPurchaseOrders' })
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    const failure = getPurchaseOrderMutationFailure(error)
    submission.value = resolvePurchaseOrderSubmissionFailure(state, failure)
    fieldErrors.value = failure.fieldErrors
    formError.value = failure.message
    requestId.value = failure.requestId
    if (!failure.unknownResult) {
      submitConfirmVisible.value = false
      if (guidedCreate.value) {
        createSurface.value = 'form'
        const errorStep = resolvePurchaseOrderCreateStepForErrors(failure.fieldErrors)
        goToFormStep(errorStep ?? 2)
      }
      focusFirstInvalidField(failure.fieldErrors)
    }
  }
  finally {
    if (submitAbortController === controller) {
      submitAbortController = null
    }
  }
}

function confirmSubmit(): void {
  if (submission.value.phase !== 'editing' || purchaseType === null) {
    return
  }
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '订单资料已变化，请返回检查后重新提交'
    submitConfirmVisible.value = false
    if (guidedCreate.value) {
      createSurface.value = 'form'
      const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
      goToFormStep(errorStep ?? 2)
    }
    focusFirstInvalidField(fieldErrors.value)
    return
  }
  const state = beginPurchaseOrderSubmission(
    submission.value,
    result.request,
    { authEpoch: appAccountStore.authEpoch, requestVersion: ++submitRequestVersion },
  )
  submission.value = state
  void executeSubmission(state)
}

function retryUnknownSubmission(): void {
  if (submission.value.phase !== 'unknown') {
    return
  }
  try {
    const state = replayUnknownPurchaseOrderSubmission(submission.value, {
      authEpoch: appAccountStore.authEpoch,
      requestVersion: ++submitRequestVersion,
    })
    submission.value = state
    formError.value = ''
    requestId.value = undefined
    void executeSubmission(state)
  }
  catch {
    formError.value = '当前身份已变化，不能重放旧请求；请返回列表核对结果'
  }
}

function requestBack(): void {
  void router.push({ name: 'qsOperationsPurchaseOrders' })
}

function closeDiscard(): void {
  discardVisible.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(false)
}

function confirmDiscard(): void {
  discardVisible.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(true)
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!shouldConfirmDiscard.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if (submission.value.phase === 'submitting') {
    toast.info('采购订单正在保存，请等待结果确认后再离开')
    return false
  }
  if (!shouldConfirmDiscard.value) {
    return true
  }
  if (pendingNavigationResolver !== null || discardVisible.value) {
    return false
  }
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
    discardVisible.value = true
  })
})

watch(() => appAccountStore.authEpoch, () => {
  sourceAbortController?.abort()
  synchronizeAbortController?.abort()
  submitAbortController?.abort()
  void router.replace({ name: 'qsOperationsPurchaseOrders' })
})

watch(isDesktopSummary, (desktop) => {
  if (desktop) {
    detailsDrawerVisible.value = false
  }
})

onMounted(() => {
  if (!canCreate.value || purchaseType === null) {
    toast.error('当前入口无效或缺少创建该类型采购订单的权限')
    void router.replace({ name: 'qsOperationsPurchaseOrders' })
    return
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  sourceAbortController?.abort()
  synchronizeAbortController?.abort()
  submitAbortController?.abort()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  pendingNavigationResolver?.(false)
  pendingNavigationResolver = null
})
</script>

<template>
  <div ref="createPageRef" class="purchase-order-create-page min-w-0" data-testid="purchase-order-create-page">
    <FaPageHeader :title="title" :description="typeDescription">
      <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="requestBack">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />返回全部采购
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="purchaseType === null || !canCreate">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无法创建该类型采购订单"
        description="请从全部采购页使用有权限的新增入口进入。"
        class="py-14"
      />
    </FaPageMain>

    <div
      v-else
      data-testid="purchase-order-create-layout"
      class="purchase-order-create-layout m-4 min-w-0"
      :class="{
        'purchase-order-create-layout--stock': purchaseType === 'STOCK',
        'purchase-order-create-layout--form': guidedCreate && createSurface === 'form',
        'purchase-order-create-layout--review': guidedCreate && createSurface === 'review',
      }"
    >
      <div v-if="formError" class="purchase-order-alert-stack">
        <FaAlert
          title="采购订单尚不能提交"
          :description="formErrorDisplay"
          variant="destructive"
          role="alert"
        />
      </div>

      <FaPageMain
        class="purchase-order-form-track m-0 min-w-0 overflow-visible"
        main-class="overflow-visible"
        :inert="createSurface === 'review'"
        :aria-hidden="createSurface === 'review' ? 'true' : undefined"
      >
        <FaForm
          :model="formModel"
          :disabled="submitLocked"
          :aria-busy="submission.phase === 'submitting' ? 'true' : 'false'"
          class="min-w-0"
        >
          <nav
            v-if="guidedCreate"
            ref="stepNavigationRef"
            class="purchase-order-step-navigation mb-6 pb-5 border-b border-border"
            aria-label="新增采购订单填写步骤"
            tabindex="-1"
          >
            <p class="text-sm text-muted-foreground m-0 mb-4" aria-live="polite">
              第 {{ activeStep + 1 }} 步，共 {{ purchaseOrderSteps.length }} 步：{{ activeStepTitle }}
            </p>
            <FaSteps v-model="activeStep" :steps="purchaseOrderSteps" status="process" class="w-full" />
          </nav>

          <div :class="purchaseType === 'STOCK' ? 'gap-6 grid xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]' : ''">
            <main class="gap-6 grid min-w-0">
              <section
                v-show="purchaseType === 'STOCK' || activeStep === 0"
                class="gap-6 grid"
                aria-label="采购基础信息与销售订单关联"
                data-testid="purchase-order-step-base"
              >
                <FaCard
                  title="采购基础信息"
                  description="订单号由 PURCHASE_ORDER 规则在最终二次确认后幂等派发。"
                  content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
                >
                  <div class="p-4 border border-border rounded-lg bg-muted/25 md:col-span-2">
                    <p class="text-sm font-medium m-0">
                      采购订单号
                    </p>
                    <code class="text-sm text-muted-foreground font-mono mt-2 block">PURCHASE_ORDER · AUTO</code>
                  </div>
                  <FaFormItem name="orderDate" label="采购日期" required :auto-bind="false">
                    <FaDate
                      aria-label="采购日期"
                      :model-value="orderDateValue"
                      :max-value="todayDate"
                      :disabled="submitLocked"
                      picker
                      prevent-deselect
                      trigger-class="w-full min-h-11 sm:min-h-9"
                      @update:model-value="updateOrderDate"
                    />
                    <p v-if="fieldErrors.orderDate" class="text-xs text-destructive m-0 mt-1" role="alert">
                      {{ fieldErrors.orderDate }}
                    </p>
                  </FaFormItem>
                  <FaFormItem name="supplierValue" label="供应商" required :auto-bind="false">
                    <QsDictionarySelect
                      ref="supplierSelectRef"
                      :model-value="formModel.supplierValue"
                      dictionary-code="service_provider.supplier"
                      placeholder="选择采购供应商"
                      :disabled="submitLocked"
                      required
                      @update:model-value="handleSupplierUpdate"
                    />
                    <p v-if="fieldErrors.supplierValue" class="text-xs text-destructive m-0 mt-1" role="alert">
                      {{ fieldErrors.supplierValue }}
                    </p>
                  </FaFormItem>
                </FaCard>

                <FaCard
                  v-if="guidedCreate"
                  title="销售订单关联"
                  description="一个采购订单只关联一个销售订单；同一销售订单可拆分为多个采购订单。"
                >
                  <div class="p-4 border border-border rounded-xl bg-muted/20 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div class="min-w-0">
                      <p class="font-medium m-0 break-all">
                        {{ selectedSalesOrder?.orderNo ?? '尚未选择销售订单' }}
                      </p>
                      <p class="text-sm text-muted-foreground m-0 mt-1 truncate">
                        {{ selectedSalesOrder ? `${selectedSalesOrder.customerName} · ${selectedSalesOrder.orderDate}` : '选择后获取客户名和剩余可采购产品' }}
                      </p>
                    </div>
                    <FaButton
                      type="button"
                      variant="outline"
                      class="shrink-0 min-h-11 sm:min-h-9"
                      :disabled="submitLocked || sourceLoading"
                      @click="sourceSelectorVisible = true"
                    >
                      <FaIcon name="i-lucide:search" aria-hidden="true" />选择销售订单
                    </FaButton>
                  </div>
                  <FaAlert
                    v-if="sourceError"
                    title="销售来源暂不可用"
                    :description="sourceError"
                    variant="destructive"
                    class="mt-4"
                  />
                  <p v-if="fieldErrors.salesOrderId" class="text-sm text-destructive m-0 mt-3" role="alert">
                    {{ fieldErrors.salesOrderId }}
                  </p>
                </FaCard>
              </section>

              <section
                v-show="purchaseType === 'STOCK' || activeStep === 1"
                class="gap-6 grid"
                aria-label="采购产品明细与付款约定"
                data-testid="purchase-order-step-products-payment"
              >
                <FaCard
                  title="采购产品明细"
                  :description="purchaseType === 'STOCK' ? '可手工添加数据库产品或临时产品。' : '从销售订单同步产品；可删除本次暂不采购的行。'"
                  content-class="min-w-0"
                >
                  <div v-if="guidedCreate" class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p class="text-sm text-muted-foreground m-0">
                      {{ selectedSalesOrder ? `来源：${selectedSalesOrder.orderNo} · ${selectedSalesOrder.customerName}` : '请先在第一步关联销售订单' }}
                    </p>
                    <FaButton
                      type="button"
                      class="shrink-0 min-h-11 sm:min-h-9"
                      :loading="synchronizing"
                      :disabled="submitLocked || !sourceReady"
                      @click="synchronizeSourceProducts"
                    >
                      <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />同步销售产品明细
                    </FaButton>
                  </div>
                  <QsOrderProductLineEditor
                    :model-value="formModel.lines"
                    currency="CNY"
                    :currencies="fixedCurrencies"
                    :load-products="loadPurchaseProducts"
                    :labels="lineLabels"
                    :disabled="submitLocked || currencyUnavailable || formModel.supplierValue === null"
                    :field-errors="fieldErrors"
                    :fixed-product-supplier-value="formModel.supplierValue ?? undefined"
                    :catalog-product-addable="purchaseType === 'STOCK'"
                    :custom-product-addable="purchaseType === 'STOCK'"
                    :catalog-line-initial-actual-unit-price-amount="null"
                    custom-reference-unit-price-editable
                    :temporary-line-initial-actual-unit-price-amount="null"
                    product-selection-description="采购定价读取产品档案采购成本；本单采购价必须确认填写。"
                    @update:model-value="handleLinesUpdate"
                  />
                </FaCard>

                <PurchaseOrderPaymentTerms
                  v-if="guidedCreate"
                  :balance-due-amount="formModel.balanceDueAmount"
                  :currencies="fixedCurrencies"
                  :deposit-due-amount="formModel.depositDueAmount"
                  :disabled="submitLocked"
                  :field-errors="fieldErrors"
                  :purchase-total-amount="purchaseTotalAmount"
                  @update:balance-due-amount="handleBalanceUpdate"
                  @update:deposit-due-amount="handleDepositUpdate"
                />
              </section>

              <section
                v-show="purchaseType === 'STOCK' || activeStep === 2"
                aria-label="唛头与备注"
                data-testid="purchase-order-step-mark-remark"
              >
                <FaCard title="唛头与备注" description="采购唛头首期按文本保存，后续可在同一字段接入自动生成。">
                  <div class="gap-4 grid grid-cols-1">
                    <FaFormItem name="shippingMarkText" label="采购唛头" :auto-bind="false">
                      <FaTextarea
                        :model-value="formModel.shippingMarkText"
                        maxlength="2000"
                        input-class="min-h-32"
                        placeholder="输入采购唛头文本"
                        :disabled="submitLocked"
                        @update:model-value="handleShippingMarkUpdate"
                      />
                      <p v-if="fieldErrors.shippingMarkText" class="text-xs text-destructive m-0 mt-1" role="alert">
                        {{ fieldErrors.shippingMarkText }}
                      </p>
                    </FaFormItem>
                    <FaFormItem name="remark" label="采购备注" :auto-bind="false">
                      <FaTextarea
                        :model-value="formModel.remark"
                        maxlength="1000"
                        input-class="min-h-24"
                        :disabled="submitLocked"
                        @update:model-value="handleRemarkUpdate"
                      />
                      <p v-if="fieldErrors.remark" class="text-xs text-destructive m-0 mt-1" role="alert">
                        {{ fieldErrors.remark }}
                      </p>
                    </FaFormItem>
                  </div>
                </FaCard>
              </section>

              <nav
                v-if="guidedCreate"
                class="mt-1 pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                aria-label="采购订单填写步骤操作"
              >
                <FaButton
                  type="button"
                  variant="outline"
                  class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                  :disabled="submitLocked"
                  @click="requestBack"
                >
                  取消
                </FaButton>
                <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <FaButton
                    v-if="activeStep > 0"
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="submitLocked"
                    @click="previousStep"
                  >
                    上一步
                  </FaButton>
                  <FaButton
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="submitLocked"
                    @click="nextStep"
                  >
                    下一步
                  </FaButton>
                  <FaButton
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto xl:hidden"
                    :disabled="submitLocked"
                    @click="openDetailsDrawer"
                  >
                    查看已填详情
                  </FaButton>
                </div>
              </nav>
            </main>

            <aside v-if="purchaseType === 'STOCK'" class="min-w-0">
              <div class="xl:top-[calc(var(--g-header-actual-height,0px)+var(--g-topbar-actual-height,0px)+1rem)] xl:sticky">
                <PurchaseOrderPaymentTerms
                  :balance-due-amount="formModel.balanceDueAmount"
                  :currencies="fixedCurrencies"
                  :deposit-due-amount="formModel.depositDueAmount"
                  :disabled="submitLocked"
                  :field-errors="fieldErrors"
                  :purchase-total-amount="purchaseTotalAmount"
                  @update:balance-due-amount="handleBalanceUpdate"
                  @update:deposit-due-amount="handleDepositUpdate"
                />
                <FaAlert
                  v-if="submission.phase === 'unknown'"
                  title="提交结果未知"
                  description="网络中断时订单可能已经创建。只能使用相同请求重新确认，避免重复编号。"
                  class="mt-5"
                >
                  <template #actions>
                    <FaButton type="button" variant="outline" size="sm" @click="retryUnknownSubmission">
                      使用相同请求重新确认
                    </FaButton>
                  </template>
                </FaAlert>
                <FaButton
                  type="button"
                  class="mt-6 min-h-11 w-full"
                  :loading="submitLocked"
                  :disabled="submitLocked || currencyUnavailable"
                  @click="requestSubmit"
                >
                  核对并确认采购订单
                </FaButton>
              </div>
            </aside>
          </div>
        </FaForm>
      </FaPageMain>

      <Transition name="purchase-order-summary-panel">
        <aside
          v-if="guidedCreate"
          v-show="isDesktopSummary || createSurface === 'review'"
          data-testid="purchase-order-create-summary-column"
          class="purchase-order-summary-column min-w-0 self-stretch"
          :data-surface="createSurface"
          :aria-label="createSurface === 'review' ? '采购订单最终核对' : '已填采购订单详情'"
        >
          <div class="purchase-order-summary-shell">
            <header
              v-if="createSurface === 'review'"
              data-testid="purchase-order-create-review"
              class="purchase-order-review-heading"
            >
              <p class="text-xs text-primary tracking-wide font-semibold m-0">
                第 4 步，共 4 步 · 最终核对
              </p>
              <h2
                ref="reviewHeadingRef"
                class="text-xl tracking-tight font-semibold m-0 mt-1 outline-none rounded-md focus-visible:ring-2 focus-visible:ring-primary/40"
                tabindex="-1"
              >
                核对采购订单
              </h2>
              <p class="text-sm text-muted-foreground leading-6 m-0 mt-2">
                请确认下列资料无误；只有二次确认后才会正式保存并派发采购订单号。
              </p>
            </header>

            <div class="purchase-order-summary-region rounded-2xl min-h-0">
              <PurchaseOrderCreateReview
                :balance-due-amount="formModel.balanceDueAmount"
                :currencies="fixedCurrencies"
                :deposit-due-amount="formModel.depositDueAmount"
                :lines="formModel.lines"
                :order-date="formModel.orderDate"
                :purchase-total-amount="purchaseTotalAmount"
                :remark="formModel.remark"
                :sales-order="selectedSalesOrder"
                :shipping-mark-text="formModel.shippingMarkText"
                :supplier-label="selectedSupplierDisplayLabel"
              />
            </div>

            <Transition name="purchase-order-submit-bar">
              <div
                v-if="createSurface === 'review'"
                class="purchase-order-review-actions p-4 border border-border rounded-2xl bg-background/95 shadow-lg"
              >
                <FaAlert
                  v-if="submission.phase === 'unknown'"
                  title="提交结果未知"
                  description="订单可能已经创建，请使用原幂等请求重新确认。"
                  variant="destructive"
                />
                <p
                  id="purchase-order-review-submit-status"
                  class="text-sm text-muted-foreground leading-5 m-0"
                  role="status"
                  aria-live="polite"
                >
                  {{ submitStatusMessage }}
                </p>
                <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <FaButton
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="submitLocked"
                    @click="returnToPurchaseOrderForm"
                  >
                    返回修改
                  </FaButton>
                  <FaButton
                    v-if="submission.phase === 'unknown'"
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    @click="retryUnknownSubmission"
                  >
                    使用相同请求重新确认
                  </FaButton>
                  <FaButton
                    v-else
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:min-w-36 sm:w-auto"
                    :loading="submitLocked"
                    :disabled="!submitReady"
                    aria-describedby="purchase-order-review-submit-status"
                    @click="requestSubmit"
                  >
                    提交订单
                  </FaButton>
                </div>
              </div>
            </Transition>
          </div>
        </aside>
      </Transition>
    </div>

    <QsGenericDrawer
      v-if="guidedCreate"
      v-model="detailsDrawerVisible"
      data-testid="purchase-order-details-drawer"
      title="已填采购订单详情"
      description="实时核对当前已填资料；完成第三步后通过“下一步”进入全屏核对。"
      placement="right"
      size="xl"
      :submitting="submitLocked"
    >
      <PurchaseOrderCreateReview
        :balance-due-amount="formModel.balanceDueAmount"
        :currencies="fixedCurrencies"
        :deposit-due-amount="formModel.depositDueAmount"
        :lines="formModel.lines"
        :order-date="formModel.orderDate"
        :purchase-total-amount="purchaseTotalAmount"
        :remark="formModel.remark"
        :sales-order="selectedSalesOrder"
        :shipping-mark-text="formModel.shippingMarkText"
        :supplier-label="selectedSupplierDisplayLabel"
        class="border-0 rounded-none shadow-none md:rounded-2xl"
      />
      <template #footer>
        <div class="flex w-full justify-end">
          <FaButton type="button" variant="outline" class="min-h-11 w-full md:w-auto" @click="detailsDrawerVisible = false">
            继续填写
          </FaButton>
        </div>
      </template>
    </QsGenericDrawer>

    <PurchaseSourceSalesOrderSelector
      v-if="purchaseType === 'SALES_LINKED'"
      v-model="sourceSelectorVisible"
      :disabled="submitLocked"
      :load-sales-orders="loadSourceSalesOrders"
      @confirm="selectSourceSalesOrder"
    />

    <QsGenericModal
      :model-value="submitConfirmVisible"
      title="确认提交采购订单？"
      description="确认后正式保存，并由 PURCHASE_ORDER 规则幂等派发采购订单号。"
      size="sm"
      :closable="false"
      :dismiss-on-overlay="false"
      :submitting="submitLocked"
      @update:model-value="submitConfirmVisible = $event"
    >
      <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-[5rem_minmax(0,1fr)]">
        <dt class="text-sm text-muted-foreground">
          采购类型
        </dt>
        <dd class="text-sm font-medium m-0">
          {{ purchaseType === 'STOCK' ? '备货采购' : '销售关联采购' }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          供应商
        </dt>
        <dd class="text-sm font-mono m-0 break-all">
          {{ selectedSupplierDisplayLabel }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          产品数
        </dt>
        <dd class="text-sm font-medium m-0">
          {{ formModel.lines.length }} 项
        </dd>
        <dt class="text-sm text-muted-foreground">
          采购总价
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay :value="purchaseTotalAmount" currency="CNY" :currencies="fixedCurrencies" />
        </dd>
      </dl>
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="submitLocked" @click="submitConfirmVisible = false">
          返回检查
        </FaButton>
        <FaButton type="button" :loading="submitLocked" @click="confirmSubmit">
          确认提交订单
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      :model-value="discardVisible"
      title="放弃当前采购订单？"
      description="未提交的采购信息将不会保留。"
      size="sm"
      @update:model-value="$event ? (discardVisible = true) : closeDiscard()"
    >
      <p class="text-sm text-muted-foreground m-0">
        确认离开后，本页已填写资料不可恢复。
      </p>
      <template #footer>
        <FaButton type="button" variant="outline" @click="closeDiscard">
          继续编辑
        </FaButton>
        <FaButton type="button" variant="destructive" @click="confirmDiscard">
          确认放弃
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
.purchase-order-create-page {
  --purchase-order-sticky-top: calc(var(--g-slots-layout-top-height, 0px) + var(--g-header-actual-height, 0px) + var(--g-topbar-actual-height, 0px) + var(--g-main-container-padding-top, 0px) + 1rem);
  --purchase-order-review-viewport-height: calc(100dvh - var(--purchase-order-sticky-top));
}

.purchase-order-step-navigation,
.purchase-order-review-heading {
  scroll-margin-top: var(--purchase-order-sticky-top);
}

.purchase-order-create-layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
  transition:
    grid-template-columns 600ms cubic-bezier(0.22, 1, 0.36, 1),
    column-gap 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.purchase-order-alert-stack {
  grid-column: 1 / -1;
}

.purchase-order-form-track,
.purchase-order-summary-column {
  grid-column: 1;
  min-width: 0;
}

.purchase-order-form-track {
  transition:
    opacity 360ms ease,
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}

/*
 * 全屏核对时表单保持在组件树内以保留填写状态，但退出布局和焦点顺序。
 * inert/aria-hidden 与视觉过渡同步，避免键盘用户进入不可见控件。
 */
.purchase-order-create-layout--review .purchase-order-form-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-height: var(--purchase-order-review-viewport-height);
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-1rem);
}

.purchase-order-summary-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.purchase-order-summary-region {
  overflow: visible;
}

.purchase-order-review-heading {
  padding: 0.25rem 0.25rem 0;
}

.purchase-order-review-actions {
  display: grid;
  gap: 0.75rem;
  margin-bottom: max(0.75rem, env(safe-area-inset-bottom));
  backdrop-filter: blur(12px);
}

.purchase-order-summary-panel-enter-active,
.purchase-order-summary-panel-leave-active,
.purchase-order-submit-bar-enter-active,
.purchase-order-submit-bar-leave-active {
  transition:
    opacity 360ms ease,
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}

.purchase-order-summary-panel-enter-from,
.purchase-order-summary-panel-leave-to {
  opacity: 0;
  transform: translateY(0.75rem);
}

.purchase-order-submit-bar-enter-from,
.purchase-order-submit-bar-leave-to {
  opacity: 0;
  transform: translateY(calc(100% + 1rem));
}

@media (width >= 1280px) {
  .purchase-order-create-layout--form {
    grid-template-columns: minmax(0, calc(100% - 31.5rem)) minmax(0, 30rem);
  }

  .purchase-order-create-layout--review {
    grid-template-columns: minmax(0, 0) minmax(0, 100%);
    column-gap: 0;
  }

  .purchase-order-summary-column {
    position: sticky;
    top: var(--purchase-order-sticky-top);
    grid-column: 2;
  }

  .purchase-order-create-layout--form .purchase-order-summary-column {
    height: 100%;
    min-height: calc(100dvh - var(--purchase-order-sticky-top) - 1rem);
    max-height: none;
    contain: size;
  }

  .purchase-order-create-layout--form .purchase-order-summary-shell {
    height: 100%;
    min-height: 0;
  }

  .purchase-order-create-layout--form .purchase-order-summary-region {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .purchase-order-create-layout--review .purchase-order-form-track {
    width: calc(100% - 31.5rem);
  }
}

.purchase-order-create-layout--review .purchase-order-summary-column {
  position: relative;
  top: auto;
  min-height: var(--purchase-order-review-viewport-height);
  max-height: none;
}

.purchase-order-create-layout--review .purchase-order-summary-shell {
  min-height: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .purchase-order-create-layout,
  .purchase-order-form-track,
  .purchase-order-summary-panel-enter-active,
  .purchase-order-summary-panel-leave-active,
  .purchase-order-submit-bar-enter-active,
  .purchase-order-submit-bar-leave-active {
    transition: none;
  }

  .purchase-order-create-layout--review .purchase-order-form-track {
    transform: none;
  }
}

/* 创建页使用窗口滚动；局部 overflow 会让桌面实时详情失去正确的 sticky 参照系。 */
:global(.layout .main-container:has(.purchase-order-create-page)),
:global(#app-content:has(.purchase-order-create-page)) {
  overflow: visible;
}
</style>
