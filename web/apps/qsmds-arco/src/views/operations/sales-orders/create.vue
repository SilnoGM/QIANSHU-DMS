<script setup lang="ts">
import type { FormExpose, StepsItem } from '@fantastic-admin/components'
import type { DateValue } from '@internationalized/date'
import type {
  SalesOrderApiFailure,
  SalesOrderCreateStep,
  SalesOrderDocumentFormModel,
  SalesOrderFieldErrors,
  SalesOrderFormModel,
  SalesOrderSubmissionState,
  SalesOrderSubmittingState,
  SalesOrderUnknownState,
} from './sales-order-create.logic'
import type { RegionSelectorChange } from '@/components/business/QsRegionSelector/types'

import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import QsSalesOrderDesc from '@/components/business/QsSalesOrderDesc/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

import { mapSalesOrderCreateFormToDesc } from './sales-order-create-view.logic'
import {
  abandonUnknownSalesOrderSubmission,
  beginSalesOrderSubmission,
  buildCreateSalesOrderRequest,
  calculateSalesOrderLineSubtotal,
  canApplySalesOrderResponse,
  createSalesOrderDocumentAutoTitle,
  createSalesOrderFormModel,
  createSalesOrderSubmissionState,
  customizeSalesOrderDocumentTitle,
  formatSalesOrderDocumentTitleTimestamp,
  getSalesOrderApiFailure,
  hasSalesOrderChanges,
  isSalesOrderAbortError,
  normalizeSalesOrderAddressDetail,
  parseSalesOrderCurrency,
  refreshSalesOrderDocumentAutoTitle,
  replayUnknownSalesOrderSubmission,
  resolveSalesOrderCreateStepForErrors,
  resolveSalesOrderCreateStepForField,
  resolveSalesOrderIssuerLabel,
  resolveSalesOrderSubmissionFailure,
  resolveSalesOrderSubmissionSuccess,
  SALES_ORDER_CREATE_LAST_STEP,
  validateSalesOrderCreateStep,
} from './sales-order-create.logic'
import { createSalesOrderDocumentPreviewRegistry } from './sales-order-document-previews'
import SalesOrderLines from './sales-order-lines.vue'

type DiscardIntent = 'navigation' | 'unknown-abandon'
type DeferredOverlayAction = 'navigation-discard'
type SalesOrderCreateSurface = 'form' | 'review'

interface PendingSubmissionFeedback {
  errors: SalesOrderFieldErrors
  step: SalesOrderCreateStep | null
}

defineOptions({ name: 'OperationsSalesOrderCreate' })

const salesOrderSteps: StepsItem[] = [
  { id: 'base', title: '基础信息' },
  { id: 'customer', title: '客户地址' },
  { id: 'products-sales', title: '产品与销售' },
  { id: 'documents', title: '订单凭证' },
]

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const selectedCurrency = parseSalesOrderCurrency(route.query.currency)
const initialCurrency = selectedCurrency ?? 'TWD'
const todayDate = today(getLocalTimeZone())
const todayIso = todayDate.toString()

const canCreate = computed(() => auth('sales-orders:create'))
const canRead = computed(() => auth('sales-orders:read'))
const canManageDocuments = computed(() => auth('sales-orders:document'))
const formModel = ref(createSalesOrderFormModel(initialCurrency, todayIso))
const createSurface = ref<SalesOrderCreateSurface>('form')
const activeStep = ref<SalesOrderCreateStep>(0)
const furthestReachedStep = ref<SalesOrderCreateStep>(0)
const fieldErrors = ref<SalesOrderFieldErrors>({})
const formError = ref('')
const formFailure = shallowRef<SalesOrderApiFailure | null>(null)
const submission = shallowRef<SalesOrderSubmissionState>(createSalesOrderSubmissionState())
const productOptions = ref<Awaited<ReturnType<typeof salesOrdersApi.productOptions>>['data']['items']>([])
const productSearchKeyword = ref('')
const productLoading = ref(false)
const productSearchPending = ref(false)
const productError = ref('')
const documentUploading = ref(false)
const documentUploadError = ref('')
const discardVisible = ref(false)
const discardActive = ref(false)
const discardIntent = ref<DiscardIntent | null>(null)
const detailsDrawerVisible = ref(false)
const submitConfirmVisible = ref(false)
const detailsDrawerActive = ref(false)
const submitConfirmationActive = ref(false)
const deferredOverlayAction = ref<DeferredOverlayAction | null>(null)
const pendingSubmissionFeedback = shallowRef<PendingSubmissionFeedback | null>(null)
const isDesktopSummary = useMediaQuery('(min-width: 1280px)')
const formRef = useTemplateRef<FormExpose<SalesOrderFormModel>>('formRef')
const stepNavigationRef = useTemplateRef<HTMLElement>('stepNavigationRef')
const reviewHeadingRef = useTemplateRef<HTMLElement>('reviewHeadingRef')
const reviewActionsRef = useTemplateRef<HTMLElement>('reviewActionsRef')
const summaryRegionRef = useTemplateRef<HTMLElement>('summaryRegionRef')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInputRef')
const appliedFormErrorFields = new Set<string>()
const documentPreviewRegistry = createSalesOrderDocumentPreviewRegistry()
const documentPreviewSnapshot = shallowRef<Readonly<Record<string, string>>>({})
let productRequestVersion = 0
let productAbortController: AbortController | null = null
let productSearchTimer: ReturnType<typeof setTimeout> | null = null
let submitRequestVersion = 0
let submitAbortController: AbortController | null = null
let documentAbortController: AbortController | null = null
let pendingNavigationResolver: ((allow: boolean) => void) | null = null

const { height: reviewActionsHeight } = useElementSize(reviewActionsRef)

const fixedCurrencies = computed(() => currencyCatalog.currencies.value.filter(currency =>
  currency.code === formModel.value.currencyCode))
const issuerLabel = computed(() => resolveSalesOrderIssuerLabel(
  appAccountStore.displayName,
  appAccountStore.account,
))
const fixedCurrencyDescriptor = computed(() => fixedCurrencies.value[0] ?? null)
const amountPrecision = computed(() => fixedCurrencyDescriptor.value?.minorUnit ?? 4)
const currencyUnavailable = computed(() => (
  currencyCatalog.loading.value
  || currencyCatalog.errorMessage.value !== null
  || fixedCurrencyDescriptor.value?.enabled !== true
))
const orderDateValue = computed(() => parseDate(formModel.value.orderDate))
const lineSubtotalAmount = computed(() => calculateSalesOrderLineSubtotal(
  formModel.value.lines,
  amountPrecision.value,
))
const fullAddressPreview = computed(() => [
  ...formModel.value.regionNames,
  normalizeSalesOrderAddressDetail(formModel.value.addressDetail),
].join(''))
const fullValidation = computed(() => buildCreateSalesOrderRequest(
  formModel.value,
  amountPrecision.value,
  todayIso,
))
const completedStepStates = computed(() => salesOrderSteps.map((_step, index) => {
  const step = index as SalesOrderCreateStep
  const validation = fullValidation.value
  const hasCurrentValidationError = !validation.valid
    && Object.keys(validation.fieldErrors).some(path => (
      resolveSalesOrderCreateStepForField(path) === step
    ))
  const hasPersistedError = Object.keys(fieldErrors.value).some(path => (
    resolveSalesOrderCreateStepForField(path) === step
  ))

  return step <= furthestReachedStep.value
    && !hasCurrentValidationError
    && !hasPersistedError
    && (step !== 0 || !currencyUnavailable.value)
    && (step !== SALES_ORDER_CREATE_LAST_STEP || !documentUploading.value)
}))
const allStepsPassed = computed(() => completedStepStates.value.every(Boolean))
const reviewReady = computed(() => (
  canCreate.value
  && submission.value.phase === 'editing'
  && !currencyUnavailable.value
  && !documentUploading.value
  && furthestReachedStep.value === SALES_ORDER_CREATE_LAST_STEP
  && allStepsPassed.value
  && fullValidation.value.valid
  && Object.keys(fieldErrors.value).length === 0
))
const submitReady = computed(() => (
  createSurface.value === 'review'
  && reviewReady.value
))
const reviewSummaryStyle = computed(() => createSurface.value === 'review'
  ? {
      paddingBottom: reviewActionsHeight.value > 0
        ? `calc(${Math.ceil(reviewActionsHeight.value)}px + max(2rem, env(safe-area-inset-bottom)))`
        : '12rem',
    }
  : undefined)
const submitStatusMessage = computed(() => {
  if (submission.value.phase === 'submitting') {
    return '正在保存销售订单，请勿重复操作。'
  }
  if (submission.value.phase === 'unknown') {
    return '当前保存结果未知，请使用原请求重新确认。'
  }
  if (currencyUnavailable.value) {
    return '当前订单币种不可用，暂时无法提交。'
  }
  if (documentUploading.value) {
    return '订单凭证正在上传，上传完成后才能提交。'
  }
  if (furthestReachedStep.value < SALES_ORDER_CREATE_LAST_STEP) {
    const nextStepTitle = salesOrderSteps[furthestReachedStep.value + 1]?.title ?? '剩余步骤'
    return `请依次完成左侧步骤，下一项：${nextStepTitle}。`
  }
  const firstInvalidStep = completedStepStates.value.findIndex(passed => !passed)
  if (firstInvalidStep >= 0) {
    return `请检查「${salesOrderSteps[firstInvalidStep]?.title ?? '订单资料'}」中的必填项与校验结果。`
  }
  return '全部步骤已完成且校验通过，可提交并派发订单编号。'
})
const salesOrderDescModel = computed(() => mapSalesOrderCreateFormToDesc(
  formModel.value,
  {
    amountPrecision: amountPrecision.value,
    documentPreviewByKey: new Map(Object.entries(documentPreviewSnapshot.value)),
    fullAddress: fullAddressPreview.value,
    issuerName: issuerLabel.value,
    lineSubtotalAmount: lineSubtotalAmount.value,
  },
))
const productResultDescription = computed(() => {
  if (productError.value !== '') {
    return ''
  }
  if (productSearchPending.value) {
    return '正在准备搜索当前币种的产品…'
  }
  if (productLoading.value) {
    return `正在加载 ${formModel.value.currencyCode} 产品…`
  }
  const keyword = productSearchKeyword.value.trim().normalize('NFKC')
  const count = productOptions.value.length
  if (count > 0) {
    return keyword === ''
      ? `当前有 ${count} 项可选的 ${formModel.value.currencyCode} 产品。`
      : `找到 ${count} 项与“${keyword}”匹配的 ${formModel.value.currencyCode} 产品。`
  }
  return keyword === ''
    ? `当前没有已启用且有 ${formModel.value.currencyCode} 标准价的数据库产品，可新增仅本订单产品。`
    : `未找到与“${keyword}”匹配的产品；仅可选择已启用且有 ${formModel.value.currencyCode} 标准价的产品。`
})
const submitLocked = computed(() => submission.value.phase !== 'editing')
const shouldConfirmDiscard = computed(() => (
  submission.value.phase === 'unknown'
  || (
    submission.value.phase !== 'success'
    && hasSalesOrderChanges(formModel.value, todayIso)
  )
))
const discardTitle = computed(() => discardIntent.value === 'unknown-abandon'
  ? '放弃本次未知结果？'
  : '放弃未保存的销售订单？')
const discardDescription = computed(() => discardIntent.value === 'unknown-abandon'
  ? '放弃后将清除当前幂等请求，不能再使用同一请求确认订单是否已经保存。'
  : '当前订单尚未正式保存，放弃后已填写内容无法恢复。')
const formErrorTitle = computed(() => formFailure.value === null
  ? '请检查销售订单资料'
  : '销售订单保存失败')
const activeStepTitle = computed(() => salesOrderSteps[activeStep.value]?.title ?? '')

function goToStep(step: number): void {
  activeStep.value = Math.min(
    Math.max(step, 0),
    SALES_ORDER_CREATE_LAST_STEP,
  ) as SalesOrderCreateStep
  // 各步骤高度不同，切换后回到进度区，避免沿用上一页底部滚动位置而漏看字段。
  void nextTick(() => {
    stepNavigationRef.value?.scrollIntoView({ block: 'start' })
    stepNavigationRef.value?.focus({ preventScroll: true })
  })
}

function previousStep(): void {
  goToStep(activeStep.value - 1)
}

async function focusSalesOrderReview(): Promise<void> {
  await nextTick()
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  reviewHeadingRef.value?.scrollIntoView({ behavior: 'auto', block: 'start' })
  reviewHeadingRef.value?.focus({ preventScroll: true })
}

/**
 * 第四步的“下一步”是正式提交前的唯一页面门禁。这里执行完整订单校验，
 * 但不创建幂等键、不冻结快照，也不会向服务端发送创建请求。
 */
function enterSalesOrderReview(): void {
  if (currencyUnavailable.value) {
    formError.value = '当前订单币种不可用，请返回列表重新选择或先启用该币种'
    return
  }
  if (documentUploading.value) {
    formError.value = '订单凭证正在上传，请等待上传完成后再进入核对'
    return
  }

  const result = buildCreateSalesOrderRequest(formModel.value, amountPrecision.value, todayIso)
  if (!result.valid) {
    // 完整客户端校验仍采用增量覆盖，避免抹掉其他步骤尚未编辑清除的服务端错误。
    const mergedErrors = { ...fieldErrors.value, ...result.fieldErrors }
    replaceFieldErrors(mergedErrors)
    if (formFailure.value === null) {
      formError.value = '部分资料未通过校验，请修正后再进入订单核对'
    }
    const errorStep = resolveSalesOrderCreateStepForErrors(mergedErrors)
    if (errorStep !== null) {
      goToStep(errorStep)
      focusFirstSalesOrderError(mergedErrors)
    }
    return
  }

  if (!reviewReady.value) {
    formError.value = '请先修正未通过的步骤或服务端字段错误'
    const errorStep = resolveSalesOrderCreateStepForErrors(fieldErrors.value)
    if (errorStep !== null) {
      goToStep(errorStep)
      focusFirstSalesOrderError(fieldErrors.value)
    }
    return
  }

  clearGlobalFailure()
  detailsDrawerVisible.value = false
  createSurface.value = 'review'
  void focusSalesOrderReview()
}

function nextStep(): void {
  if (activeStep.value === 0 && currencyUnavailable.value) {
    formError.value = '当前订单币种不可用，请等待货币资料加载完成或返回列表重新选择'
    formFailure.value = null
    return
  }

  const result = validateSalesOrderCreateStep(
    formModel.value,
    activeStep.value,
    amountPrecision.value,
    todayIso,
  )
  if (!result.valid) {
    // 当前步骤的客户端错误只做增量覆盖，保留其他步骤尚未被用户编辑清除的服务端错误。
    replaceFieldErrors({ ...fieldErrors.value, ...result.fieldErrors })
    if (formFailure.value === null) {
      formError.value = ''
    }
    focusFirstSalesOrderError(result.fieldErrors)
    return
  }

  const persistedStepErrors = Object.fromEntries(
    Object.entries(fieldErrors.value).filter(([path]) => (
      resolveSalesOrderCreateStepForField(path) === activeStep.value
    )),
  )
  if (Object.keys(persistedStepErrors).length > 0) {
    formError.value = '当前步骤仍有服务端校验错误，请修改对应字段后再继续'
    focusFirstSalesOrderError(persistedStepErrors)
    return
  }

  // 没有任何持久错误时才清理全局提示；后续步骤的服务端错误必须继续保留。
  if (Object.keys(fieldErrors.value).length === 0) {
    clearGlobalFailure()
  }
  if (activeStep.value === SALES_ORDER_CREATE_LAST_STEP) {
    enterSalesOrderReview()
    return
  }
  furthestReachedStep.value = Math.max(
    furthestReachedStep.value,
    activeStep.value + 1,
  ) as SalesOrderCreateStep
  goToStep(activeStep.value + 1)
}

function returnToSalesOrderForm(): void {
  if (submitLocked.value || createSurface.value !== 'review') {
    return
  }
  createSurface.value = 'form'
  goToStep(SALES_ORDER_CREATE_LAST_STEP)
}

function formFieldForError(path: string): string {
  if (path === 'customer.name') {
    return 'customerName'
  }
  if (path === 'customer.phone') {
    return 'customerPhone'
  }
  if (
    path === 'customer.countryRegionId'
    || path === 'customer.provinceStateId'
    || path === 'customer.cityId'
  ) {
    return 'region'
  }
  if (path === 'customer.addressDetail') {
    return 'addressDetail'
  }
  return path
}

function focusFirstSalesOrderError(errors: SalesOrderFieldErrors): void {
  const firstKnownPath = Object.keys(errors).find(path => (
    resolveSalesOrderCreateStepForField(path) !== null
  ))
  if (firstKnownPath === undefined) {
    return
  }

  void nextTick(() => {
    formRef.value?.scrollToField(formFieldForError(firstKnownPath))
  })
}

/**
 * 领域校验不依赖 vee-validate schema，因此必须把领域字段路径同步回
 * FaForm 内部错误状态，才能同时得到就地文案、aria-invalid 与正确的标签关联。
 */
function applySalesOrderFieldErrors(errors: SalesOrderFieldErrors): void {
  formRef.value?.clearValidate()
  // FaForm 的全量 clearValidate 在同一个事件周期连续 setErrors 时可能保留旧字段，
  // 因此逐个清除上一次由领域校验写入的字段，再同步本次结果。
  for (const field of appliedFormErrorFields) {
    formRef.value?.setFieldError(field, undefined)
  }
  appliedFormErrorFields.clear()
  for (const [path, message] of Object.entries(errors)) {
    const field = formFieldForError(path)
    if (field === 'lines' || field === 'documents' || appliedFormErrorFields.has(field)) {
      continue
    }
    formRef.value?.setFieldError(field, message)
    appliedFormErrorFields.add(field)
  }
}

function replaceFieldErrors(errors: SalesOrderFieldErrors): void {
  fieldErrors.value = { ...errors }
  applySalesOrderFieldErrors(fieldErrors.value)
}

function clearGlobalFailure(): void {
  formError.value = ''
  formFailure.value = null
}

function clearFeedback(path?: string): void {
  const next = path === undefined
    ? {}
    : Object.fromEntries(Object.entries(fieldErrors.value).filter(([field]) => (
        field !== path && !field.startsWith(`${path}.`)
      )))
  replaceFieldErrors(next)
  // 服务端一次可能返回多个字段错误；只在全部清完后移除其 message/requestId。
  if (Object.keys(next).length === 0 || formFailure.value === null) {
    clearGlobalFailure()
  }
}

/**
 * 销售总价与定金都会参与“定金 + 尾款 = 总价”校验。用户修正其中任一项时，
 * 必须同步清除挂在尾款字段上的旧等式错误，避免资料已正确但提交门禁仍被旧错误锁住。
 */
function handleAgreedTotalAmountUpdate(): void {
  clearFeedback('agreedTotalAmount')
  clearFeedback('balanceDueAmount')
}

function handleDepositDueAmountUpdate(): void {
  clearFeedback('depositDueAmount')
  clearFeedback('balanceDueAmount')
}

function updateOrderDate(value: DateValue | DateValue[] | undefined): void {
  if (Array.isArray(value) || value === undefined || submitLocked.value) {
    return
  }
  formModel.value.orderDate = value.toString()
  clearFeedback('orderDate')
}

function handleRegionChange(change: RegionSelectorChange): void {
  formModel.value.region = { ...change.value }
  formModel.value.regionNames = change.path.map(node => node.name)
  clearFeedback('customer.countryRegionId')
  clearFeedback('customer.provinceStateId')
  clearFeedback('customer.cityId')
  clearFeedback('customer.addressDetail')
}

function handleLinesUpdate(lines: typeof formModel.value.lines): void {
  formModel.value.lines = lines
  clearFeedback('lines')
  clearFeedback('agreedTotalAmount')
}

async function loadProductOptions(): Promise<void> {
  if (!canCreate.value || selectedCurrency === null) {
    return
  }
  if (productSearchTimer !== null) {
    clearTimeout(productSearchTimer)
    productSearchTimer = null
  }
  productSearchPending.value = false
  productAbortController?.abort()
  const controller = new AbortController()
  productAbortController = controller
  const version = ++productRequestVersion
  productLoading.value = true
  productError.value = ''
  const keyword = productSearchKeyword.value.trim().normalize('NFKC')
  try {
    const response = await salesOrdersApi.productOptions(
      selectedCurrency,
      keyword === '' ? undefined : keyword,
      controller.signal,
    )
    if (version === productRequestVersion && !controller.signal.aborted) {
      productOptions.value = response.data.items
    }
  }
  catch (error) {
    if (!isSalesOrderAbortError(error) && version === productRequestVersion) {
      productError.value = getSalesOrderApiFailure(error).message
    }
  }
  finally {
    if (version === productRequestVersion) {
      productLoading.value = false
    }
  }
}

function runProductSearch(): void {
  if (productSearchTimer !== null) {
    clearTimeout(productSearchTimer)
    productSearchTimer = null
  }
  productSearchPending.value = false
  void loadProductOptions()
}

function handleProductSearchKeyword(value: unknown): void {
  productSearchKeyword.value = String(value ?? '')
  if (!canCreate.value || selectedCurrency === null || submitLocked.value) {
    return
  }

  // 输入变化后立即废弃旧请求，避免旧关键字响应覆盖即将开始的新搜索。
  productAbortController?.abort()
  productRequestVersion += 1
  productLoading.value = false
  productError.value = ''
  productSearchPending.value = true
  if (productSearchTimer !== null) {
    clearTimeout(productSearchTimer)
  }
  productSearchTimer = setTimeout(() => {
    productSearchTimer = null
    productSearchPending.value = false
    void loadProductOptions()
  }, 300)
}

function openFilePicker(): void {
  if (!submitLocked.value && canManageDocuments.value && !documentUploading.value) {
    fileInputRef.value?.click()
  }
}

function updateDocument(index: number, patch: Partial<SalesOrderDocumentFormModel>): void {
  const current = formModel.value.documents[index]
  if (current === undefined || submitLocked.value) {
    return
  }
  formModel.value.documents = formModel.value.documents.map((document, currentIndex) =>
    currentIndex === index ? { ...document, ...patch } : { ...document })
  clearFeedback('documents')
}

function handleCustomerNameUpdate(value: unknown): void {
  if (submitLocked.value) {
    return
  }
  const customerName = String(value ?? '')
  formModel.value.customerName = customerName
  formModel.value.documents = formModel.value.documents.map(document => (
    refreshSalesOrderDocumentAutoTitle(document, customerName)
  ))
  clearFeedback('customer.name')
  clearFeedback('documents')
}

function handleDocumentTypeUpdate(
  index: number,
  documentType: SalesOrderDocumentFormModel['documentType'],
): void {
  const current = formModel.value.documents[index]
  if (current === undefined || submitLocked.value) {
    return
  }
  updateDocument(index, refreshSalesOrderDocumentAutoTitle(
    current,
    formModel.value.customerName,
    documentType,
  ))
}

function handleDocumentTitleUpdate(index: number, value: unknown): void {
  const current = formModel.value.documents[index]
  if (current === undefined || submitLocked.value) {
    return
  }
  updateDocument(index, customizeSalesOrderDocumentTitle(
    current,
    String(value ?? ''),
  ))
}

function removeDocument(index: number): void {
  if (submitLocked.value) {
    return
  }
  const document = formModel.value.documents[index]
  if (document !== undefined) {
    documentPreviewRegistry.release(document.key)
    documentPreviewSnapshot.value = documentPreviewRegistry.snapshot()
  }
  formModel.value.documents = formModel.value.documents.filter(
    (_document, currentIndex) => currentIndex !== index,
  )
  clearFeedback('documents')
}

async function uploadFiles(files: readonly File[]): Promise<void> {
  if (
    files.length === 0
    || !canManageDocuments.value
    || submitLocked.value
    || documentUploading.value
  ) {
    return
  }
  const remaining = 20 - formModel.value.documents.length
  const selected = files.slice(0, Math.max(0, remaining))
  if (selected.length === 0) {
    documentUploadError.value = '订单凭证最多 20 个'
    return
  }
  documentAbortController?.abort()
  const controller = new AbortController()
  documentAbortController = controller
  documentUploading.value = true
  documentUploadError.value = ''
  try {
    for (const file of selected) {
      const mediaType = file.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT'
      const response = await salesOrdersApi.uploadTemporaryDocument(file, mediaType, controller.signal)
      if (controller.signal.aborted) {
        return
      }
      const autoTitleTimestamp = formatSalesOrderDocumentTitleTimestamp(new Date())
      const key = crypto.randomUUID()
      formModel.value.documents.push({
        ...response.data,
        key,
        documentType: 'OTHER',
        title: createSalesOrderDocumentAutoTitle(
          formModel.value.customerName,
          'OTHER',
          autoTitleTimestamp,
        ),
        autoTitleTimestamp,
        titleManuallyEdited: false,
        remark: '',
      })
      if (response.data.mediaType === 'IMAGE') {
        try {
          documentPreviewRegistry.register(key, file)
          documentPreviewSnapshot.value = documentPreviewRegistry.snapshot()
        }
        catch {
          // 服务端已成功接收临时文件，本地缩略图失败不应丢弃该凭证。
          documentUploadError.value = '文件已上传，但本地缩略图暂时无法显示'
        }
      }
    }
  }
  catch (error) {
    if (!isSalesOrderAbortError(error)) {
      documentUploadError.value = getSalesOrderApiFailure(error).message
    }
  }
  finally {
    if (documentAbortController === controller) {
      documentAbortController = null
      documentUploading.value = false
    }
  }
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void uploadFiles(files)
}

function handleOrderRemarkUpdate(value: unknown): void {
  if (submitLocked.value) {
    return
  }
  formModel.value.remark = String(value ?? '')
  clearFeedback('remark')
}

function responseIsCurrent(state: SalesOrderSubmittingState, controller: AbortController): boolean {
  return canApplySalesOrderResponse({
    aborted: controller.signal.aborted,
    authorized: canCreate.value,
    authEpoch: state.authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    requestVersion: state.requestVersion,
    latestRequestVersion: submitRequestVersion,
  })
}

function clearDocumentPreviews(): void {
  documentPreviewRegistry.clear()
  documentPreviewSnapshot.value = documentPreviewRegistry.snapshot()
}

/**
 * 正式保存成功、用户确认放弃都走同一重置边界，确保步骤到达状态、
 * 浮层与 Blob Object URL 不会泄漏到下一张订单。
 */
function resetSalesOrderForm(): void {
  clearDocumentPreviews()
  formModel.value = createSalesOrderFormModel(initialCurrency, todayIso)
  createSurface.value = 'form'
  activeStep.value = 0
  furthestReachedStep.value = 0
  detailsDrawerVisible.value = false
  submitConfirmVisible.value = false
  deferredOverlayAction.value = null
  pendingSubmissionFeedback.value = null
  clearFeedback()
}

async function waitForOverlayFocusRestore(): Promise<void> {
  // Reka FocusScope 在卸载清理中通过 setTimeout 恢复触发器焦点；跨过该 task 与下一帧后再接管最终焦点。
  await nextTick()
  await nextTick()
  await new Promise<void>(resolve => window.setTimeout(resolve, 0))
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
}

function restorePendingSubmissionFeedback(): void {
  const feedback = pendingSubmissionFeedback.value
  pendingSubmissionFeedback.value = null
  if (feedback === null) {
    return
  }
  if (feedback.step === null) {
    // 无字段的确定性失败或 unknown 保留在核对态，顶部全局提示提供重试或幂等恢复入口。
    return
  }
  createSurface.value = 'form'
  goToStep(feedback.step)
  focusFirstSalesOrderError(feedback.errors)
}

async function queueSubmissionFeedback(errors: SalesOrderFieldErrors): Promise<void> {
  pendingSubmissionFeedback.value = {
    errors: { ...errors },
    step: resolveSalesOrderCreateStepForErrors(errors),
  }
  if (submitConfirmVisible.value || submitConfirmationActive.value) {
    // 提交锁状态刚解除时先让 submitting 属性回流，否则 Modal 会拒绝程序化关闭。
    await nextTick()
    submitConfirmVisible.value = false
    return
  }
  restorePendingSubmissionFeedback()
}

function openDetailsDrawer(): void {
  if (createSurface.value !== 'form') {
    return
  }
  // active 必须先于 visible 写入，覆盖入场动画尚未发出 opened 时立即关闭的竞态。
  detailsDrawerActive.value = true
  detailsDrawerVisible.value = true
}

function openSubmitConfirmation(): void {
  submitConfirmationActive.value = true
  submitConfirmVisible.value = true
}

function openDiscardConfirmation(): void {
  discardActive.value = true
  discardVisible.value = true
}

async function runDeferredOverlayAction(): Promise<boolean> {
  if (deferredOverlayAction.value === null) {
    return false
  }
  await waitForOverlayFocusRestore()
  // 等待期间路由状态可能变化，因此真正打开前再次确认动作仍然有效。
  if (deferredOverlayAction.value === null) {
    return false
  }
  deferredOverlayAction.value = null
  openDiscardConfirmation()
  return true
}

async function executeSubmission(state: SalesOrderSubmittingState): Promise<void> {
  submitAbortController?.abort()
  const controller = new AbortController()
  submitAbortController = controller
  try {
    const response = await salesOrdersApi.create(
      state.snapshot,
      state.idempotencyKey,
      controller.signal,
    )
    if (!responseIsCurrent(state, controller)) {
      return
    }
    submission.value = resolveSalesOrderSubmissionSuccess(state, response.data)
    resetSalesOrderForm()
    toast.success(`销售订单 ${response.data.orderNo} 创建成功`)
    if (canRead.value) {
      await router.push({ name: 'operationsSalesOrders' })
    }
    else {
      // 仅有创建权限时留在当前页，并重新进入可编辑态创建下一单。
      submission.value = createSalesOrderSubmissionState()
    }
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || !responseIsCurrent(state, controller)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    formFailure.value = failure
    formError.value = failure.message
    replaceFieldErrors(failure.fieldErrors)
    submission.value = resolveSalesOrderSubmissionFailure(state, failure)
    await queueSubmissionFeedback(failure.fieldErrors)
  }
  finally {
    if (submitAbortController === controller) {
      submitAbortController = null
    }
  }
}

function requestSubmitConfirmation(): void {
  if (
    !canCreate.value
    || submission.value.phase !== 'editing'
    || createSurface.value !== 'review'
  ) {
    return
  }
  if (currencyUnavailable.value) {
    formError.value = '当前订单币种不可用，请返回列表重新选择或先启用该币种'
    return
  }
  if (documentUploading.value) {
    formError.value = '订单凭证正在上传，请等待上传完成后再提交'
    return
  }
  if (furthestReachedStep.value !== SALES_ORDER_CREATE_LAST_STEP) {
    formError.value = '请先依次完成左侧全部填写步骤'
    return
  }
  const result = buildCreateSalesOrderRequest(formModel.value, amountPrecision.value, todayIso)
  if (!result.valid) {
    replaceFieldErrors(result.fieldErrors)
    formError.value = '部分资料未通过校验，请修正后再正式保存'
    formFailure.value = null
    createSurface.value = 'form'
    const errorStep = resolveSalesOrderCreateStepForErrors(result.fieldErrors)
    if (errorStep !== null) {
      goToStep(errorStep)
      focusFirstSalesOrderError(result.fieldErrors)
    }
    return
  }
  if (!submitReady.value) {
    formError.value = '请先修正未通过的步骤或服务端字段错误'
    const firstInvalidStep = completedStepStates.value.findIndex(passed => !passed)
    if (firstInvalidStep >= 0) {
      createSurface.value = 'form'
      goToStep(firstInvalidStep)
      focusFirstSalesOrderError(fieldErrors.value)
    }
    return
  }

  openSubmitConfirmation()
}

async function handleDetailsDrawerClosed(): Promise<void> {
  detailsDrawerActive.value = false
  if (await runDeferredOverlayAction()) {
    return
  }
  await waitForOverlayFocusRestore()
  if (createSurface.value === 'review') {
    reviewHeadingRef.value?.focus({ preventScroll: true })
  }
  else if (isDesktopSummary.value) {
    // 跨越 xl 断点后原移动端触发按钮会隐藏，把焦点落回真实可见的桌面详情区域。
    summaryRegionRef.value?.focus({ preventScroll: true })
  }
}

async function handleSubmitConfirmationClosed(): Promise<void> {
  submitConfirmationActive.value = false
  if (await runDeferredOverlayAction()) {
    return
  }
  await waitForOverlayFocusRestore()
  restorePendingSubmissionFeedback()
}

async function handleDiscardClosed(): Promise<void> {
  discardActive.value = false
  await waitForOverlayFocusRestore()
  restorePendingSubmissionFeedback()
}

async function confirmSubmitOrder(): Promise<void> {
  if (!submitReady.value || submission.value.phase !== 'editing') {
    formError.value = '订单资料已变化，请返回检查后再提交'
    submitConfirmVisible.value = false
    return
  }

  // 弹窗打开后仍重新构建快照，不使用打开弹窗时的过期数据。
  const result = buildCreateSalesOrderRequest(formModel.value, amountPrecision.value, todayIso)
  if (!result.valid) {
    replaceFieldErrors(result.fieldErrors)
    formError.value = '订单资料已变更，请修正后再提交'
    await queueSubmissionFeedback(result.fieldErrors)
    return
  }

  clearGlobalFailure()
  const state = beginSalesOrderSubmission(
    submission.value,
    result.request,
    { authEpoch: appAccountStore.authEpoch, requestVersion: ++submitRequestVersion },
  )
  submission.value = state
  await executeSubmission(state)
}

function replayUnknownResult(): void {
  if (submission.value.phase !== 'unknown' || !canCreate.value) {
    return
  }
  if (submission.value.authEpoch !== appAccountStore.authEpoch) {
    formError.value = '当前身份已变化，不能重放旧请求；请放弃本次未知结果后重新建单'
    return
  }
  let state: SalesOrderSubmittingState
  try {
    state = replayUnknownSalesOrderSubmission(submission.value, {
      authEpoch: appAccountStore.authEpoch,
      requestVersion: ++submitRequestVersion,
    })
  }
  catch {
    formError.value = '旧请求当前无法安全重放；请放弃本次未知结果后重新建单'
    return
  }
  formError.value = ''
  formFailure.value = null
  submission.value = state
  void executeSubmission(state)
}

function requestUnknownAbandon(): void {
  if (submission.value.phase !== 'unknown') {
    return
  }
  discardIntent.value = 'unknown-abandon'
  if (!deferDiscardUntilOverlayClosed()) {
    openDiscardConfirmation()
  }
}

function requestBack(): void {
  void router.push({ name: 'operationsSalesOrders' })
}

function closeDiscard(): void {
  discardVisible.value = false
  discardIntent.value = null
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(false)
}

function confirmDiscard(): void {
  const intent = discardIntent.value
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  discardVisible.value = false
  discardIntent.value = null
  if (intent === 'unknown-abandon' && submission.value.phase === 'unknown') {
    submission.value = abandonUnknownSalesOrderSubmission(submission.value as SalesOrderUnknownState)
    resetSalesOrderForm()
    toast.info('已放弃本次未知结果')
    resolve?.(true)
    return
  }
  resetSalesOrderForm()
  resolve?.(true)
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!shouldConfirmDiscard.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

function deferDiscardUntilOverlayClosed(): boolean {
  if (detailsDrawerVisible.value || detailsDrawerActive.value) {
    deferredOverlayAction.value = 'navigation-discard'
    detailsDrawerVisible.value = false
    return true
  }
  if (submitConfirmVisible.value || submitConfirmationActive.value) {
    deferredOverlayAction.value = 'navigation-discard'
    submitConfirmVisible.value = false
    return true
  }
  if (deferredOverlayAction.value !== null) {
    // 当前浮层仍在退场时继续沿用离开确认，等待 closed 后再打开，避免两个确认层叠加。
    deferredOverlayAction.value = 'navigation-discard'
    return true
  }
  return false
}

onBeforeRouteLeave(() => {
  if (submission.value.phase === 'submitting') {
    toast.info('销售订单正在保存，请等待结果确认后再离开')
    return false
  }
  if (!shouldConfirmDiscard.value) {
    return true
  }
  if (pendingNavigationResolver !== null || discardVisible.value || discardActive.value) {
    return false
  }
  discardIntent.value = submission.value.phase === 'unknown'
    ? 'unknown-abandon'
    : 'navigation'
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
    if (!deferDiscardUntilOverlayClosed()) {
      openDiscardConfirmation()
    }
  })
})

watch(isDesktopSummary, (desktop) => {
  // 在 Drawer 打开期间跨过 xl 断点时主动关闭，避免与桌面右栏同时存在。
  if (desktop && detailsDrawerVisible.value) {
    detailsDrawerVisible.value = false
  }
})

onMounted(() => {
  if (selectedCurrency === null) {
    toast.error('请先从销售订单列表选择币种')
    void router.replace({ name: 'operationsSalesOrders' })
    return
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  void loadProductOptions()
})

onBeforeUnmount(() => {
  productRequestVersion += 1
  submitRequestVersion += 1
  productAbortController?.abort()
  if (productSearchTimer !== null) {
    clearTimeout(productSearchTimer)
    productSearchTimer = null
  }
  submitAbortController?.abort()
  documentAbortController?.abort()
  clearDocumentPreviews()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  pendingNavigationResolver?.(false)
  pendingNavigationResolver = null
})
</script>

<template>
  <div class="sales-order-create-page min-w-0" data-testid="sales-order-create-page">
    <FaPageHeader
      title="新增销售订单"
      :description="`订单币种已固定为 ${formModel.currencyCode}；正式保存时才派发订单编号。`"
    >
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 sm:min-h-9"
        :disabled="submission.phase === 'submitting'"
        @click="requestBack"
      >
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />返回销售订单
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canCreate">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权新增销售订单"
        description="当前身份缺少 sales-orders:create 权限。"
        class="py-12"
      />
    </FaPageMain>

    <div
      v-else
      data-testid="sales-order-create-layout"
      class="sales-order-create-layout m-4 min-w-0"
      :class="{
        'sales-order-create-layout--form': createSurface === 'form',
        'sales-order-create-layout--review': createSurface === 'review',
      }"
    >
      <div
        v-if="formError || submission.phase === 'unknown'"
        class="sales-order-alert-stack gap-4 grid"
      >
        <FaAlert
          v-if="formError"
          :title="formErrorTitle"
          variant="destructive"
          role="alert"
        >
          <template #description>
            <div class="gap-2 grid">
              <span>{{ formError }}</span>
              <code v-if="formFailure?.requestId" class="text-xs font-mono break-all">
                requestId: {{ formFailure.requestId }}
              </code>
            </div>
          </template>
        </FaAlert>

        <FaAlert
          v-if="submission.phase === 'unknown'"
          title="订单保存结果暂时无法确认"
          variant="destructive"
          role="alert"
        >
          <template #description>
            <div class="gap-3 grid">
              <p class="m-0">
                表单与幂等请求已经冻结。请使用相同请求重新确认，避免产生重复订单。
              </p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <FaButton type="button" class="min-h-11 sm:min-h-9" @click="replayUnknownResult">
                  使用相同请求重新确认
                </FaButton>
                <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="requestUnknownAbandon">
                  放弃本次确认
                </FaButton>
              </div>
            </div>
          </template>
        </FaAlert>
      </div>

      <FaPageMain
        class="sales-order-form-track m-0 min-w-0 overflow-visible"
        main-class="overflow-visible"
        :inert="createSurface === 'review'"
        :aria-hidden="createSurface === 'review' ? 'true' : undefined"
      >
        <FaForm
          ref="formRef"
          :model="formModel"
          :disabled="submitLocked"
          :aria-busy="submission.phase === 'submitting' ? 'true' : 'false'"
          class="min-w-0"
        >
          <div data-testid="sales-order-create-form-column" class="min-w-0">
            <nav
              ref="stepNavigationRef"
              class="sales-order-step-navigation mb-6 pb-5 border-b border-border"
              aria-label="新增销售订单填写步骤"
              tabindex="-1"
            >
              <p class="text-sm text-muted-foreground m-0 mb-4" aria-live="polite">
                第 {{ activeStep + 1 }} 步，共 {{ salesOrderSteps.length }} 步：{{ activeStepTitle }}
              </p>
              <FaSteps v-model="activeStep" :steps="salesOrderSteps" status="process" class="w-full" />
            </nav>

            <section
              v-show="activeStep === 0"
              aria-label="订单基础信息"
              data-testid="sales-order-step-base"
            >
              <FaCard
                title="订单基础信息"
                description="订单编号由 SALES_ORDER 规则在正式保存时派发。"
                content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
              >
                <div class="p-4 border border-border rounded-lg bg-muted/25 md:col-span-2">
                  <p class="text-sm font-medium m-0">
                    订单编号
                  </p>
                  <code class="text-sm text-muted-foreground font-mono mt-2 block">SALES_ORDER · AUTO</code>
                </div>
                <FaFormItem name="orderDate" label="出单日期" required :auto-bind="false">
                  <FaDate
                    :model-value="orderDateValue"
                    :max-value="todayDate"
                    :disabled="submitLocked"
                    picker
                    prevent-deselect
                    trigger-class="w-full min-h-11 sm:min-h-9"
                    @update:model-value="updateOrderDate"
                  />
                </FaFormItem>
                <FaFormItem name="issuer" label="出单人" :auto-bind="false">
                  <FaInput :model-value="issuerLabel" readonly class="w-full" />
                </FaFormItem>
                <FaFormItem name="currencyCode" label="订单币种">
                  <FaInput :model-value="formModel.currencyCode" readonly class="font-mono w-full" />
                </FaFormItem>
                <FaAlert
                  v-if="currencyUnavailable"
                  title="当前币种不可用于新订单"
                  description="请确认货币资料已启用，再返回列表重新进入。"
                  variant="destructive"
                  class="md:col-span-2"
                />
              </FaCard>
            </section>

            <section
              v-show="activeStep === 1"
              aria-label="客户与地址"
              data-testid="sales-order-step-customer"
            >
              <FaCard
                title="客户与地址快照"
                description="首版只保存在本订单内，不新增客户主数据。"
                content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
              >
                <FaFormItem name="customerName" label="客户姓名" required>
                  <FaInput
                    :model-value="formModel.customerName"
                    maxlength="128"
                    autocomplete="name"
                    class="w-full"
                    @update:model-value="handleCustomerNameUpdate"
                  />
                </FaFormItem>
                <FaFormItem name="customerPhone" label="客户电话" required>
                  <FaInput
                    v-model="formModel.customerPhone"
                    maxlength="64"
                    autocomplete="tel"
                    class="w-full"
                    @update:model-value="clearFeedback('customer.phone')"
                  />
                </FaFormItem>
                <FaFormItem
                  name="region"
                  label="三级地区"
                  required
                  :auto-bind="false"
                  class="md:col-span-2"
                >
                  <QsRegionSelector
                    v-model="formModel.region"
                    data-testid="sales-order-region-selector"
                    name="customerCityId"
                    required
                    :disabled="submitLocked"
                    @change="handleRegionChange"
                  />
                </FaFormItem>
                <FaFormItem
                  name="addressDetail"
                  label="详细地址"
                  required
                  class="md:col-span-2"
                  description="保存时会移除全部空白；请勿重复填写已选国家/地区、省/州或城市。"
                >
                  <FaTextarea
                    v-model="formModel.addressDetail"
                    maxlength="1000"
                    class="w-full"
                    placeholder="例如：苓雅区中正一路100号3楼"
                    @update:model-value="clearFeedback('customer.addressDetail')"
                  />
                </FaFormItem>
                <div class="p-3 border border-border rounded-lg bg-muted/25 md:col-span-2">
                  <p class="text-xs text-muted-foreground m-0">
                    完整地址预览（无空格拼接）
                  </p>
                  <p class="text-sm m-0 mt-1 break-all">
                    {{ fullAddressPreview || '完成三级地区与详细地址后显示' }}
                  </p>
                </div>
              </FaCard>
            </section>

            <section
              v-show="activeStep === 2"
              class="space-y-6"
              aria-label="产品明细与销售信息"
              data-testid="sales-order-step-products-sales"
            >
              <div class="min-w-0">
                <FaCard
                  title="产品明细"
                  description="选择当前币种的数据库产品，或新增仅用于本订单的临时产品。"
                  content-class="min-w-0"
                >
                  <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <FaFormItem name="productSearchKeyword" label="搜索数据库产品" :auto-bind="false" class="m-0 flex-1">
                      <FaInput
                        :model-value="productSearchKeyword"
                        type="text"
                        inputmode="search"
                        enterkeyhint="search"
                        class="w-full"
                        placeholder="输入产品编号或名称，最多返回 50 项"
                        :disabled="submitLocked"
                        @update:model-value="handleProductSearchKeyword"
                        @keydown.enter.prevent="runProductSearch"
                      />
                    </FaFormItem>
                    <FaButton
                      type="button"
                      variant="outline"
                      class="min-h-11 sm:min-h-9"
                      :loading="productLoading"
                      :disabled="submitLocked"
                      @click="runProductSearch"
                    >
                      搜索产品
                    </FaButton>
                  </div>
                  <p
                    v-if="productResultDescription"
                    class="text-xs text-muted-foreground m-0 mb-4"
                    role="status"
                    aria-live="polite"
                  >
                    {{ productResultDescription }}
                  </p>
                  <FaAlert
                    v-if="productError"
                    title="产品选项加载失败"
                    :description="productError"
                    variant="destructive"
                    class="mb-4"
                  />
                  <SalesOrderLines
                    :model-value="formModel.lines"
                    :currency="formModel.currencyCode"
                    :currencies="fixedCurrencies"
                    :disabled="submitLocked"
                    :field-errors="fieldErrors"
                    :product-options="productOptions"
                    @update:model-value="handleLinesUpdate"
                  />
                </FaCard>
              </div>

              <aside class="min-w-0">
                <FaCard
                  title="销售与付款约定"
                  description="两条金额等式均采用硬拦截，服务端会再次复核。"
                  content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
                >
                  <div class="p-4 border border-border rounded-lg bg-muted/25 md:col-span-2">
                    <p class="text-xs text-muted-foreground m-0">
                      产品明细汇总
                    </p>
                    <div class="qs-type-data-emphasis mt-1">
                      <AmountDisplay
                        :value="lineSubtotalAmount"
                        :currency="formModel.currencyCode"
                        :currencies="fixedCurrencies"
                      />
                    </div>
                  </div>
                  <FaFormItem name="agreedTotalAmount" label="手填销售总价" required :auto-bind="false" class="md:col-span-2">
                    <MoneyInput
                      v-model="formModel.agreedTotalAmount"
                      :currency="formModel.currencyCode"
                      :currencies="fixedCurrencies"
                      min="0"
                      :disabled="submitLocked"
                      name="agreedTotalAmount"
                      @update:model-value="handleAgreedTotalAmountUpdate"
                    />
                  </FaFormItem>
                  <FaFormItem name="depositDueAmount" label="约定定金" required :auto-bind="false">
                    <MoneyInput
                      v-model="formModel.depositDueAmount"
                      :currency="formModel.currencyCode"
                      :currencies="fixedCurrencies"
                      min="0"
                      :disabled="submitLocked"
                      name="depositDueAmount"
                      @update:model-value="handleDepositDueAmountUpdate"
                    />
                  </FaFormItem>
                  <FaFormItem name="balanceDueAmount" label="约定尾款" required :auto-bind="false">
                    <MoneyInput
                      v-model="formModel.balanceDueAmount"
                      :currency="formModel.currencyCode"
                      :currencies="fixedCurrencies"
                      min="0"
                      :disabled="submitLocked"
                      name="balanceDueAmount"
                      @update:model-value="clearFeedback('balanceDueAmount')"
                    />
                  </FaFormItem>
                  <div class="text-xs text-muted-foreground leading-5 p-3 border border-border rounded-lg md:col-span-2">
                    销售总价 = 明细汇总；约定定金 + 约定尾款 = 销售总价。实际收款将在订单创建后单独记录。
                  </div>
                </FaCard>
              </aside>
            </section>

            <section
              v-show="activeStep === 3"
              class="space-y-6"
              aria-label="订单凭证"
              data-testid="sales-order-step-documents"
            >
              <FaCard
                title="订单凭证"
                description="可先上传图片或文档；上传不会派发订单编号，正式保存时才关联。"
                content-class="gap-4 grid"
              >
                <template v-if="canManageDocuments">
                  <input
                    ref="fileInputRef"
                    type="file"
                    accept="image/*,.pdf,.doc,.docx"
                    multiple
                    class="sr-only"
                    :disabled="submitLocked || documentUploading"
                    @change="handleFileInput"
                  >
                  <FaButton
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full"
                    :loading="documentUploading"
                    :disabled="submitLocked || formModel.documents.length >= 20"
                    @click="openFilePicker"
                  >
                    <FaIcon name="i-lucide:upload-cloud" aria-hidden="true" />上传定金凭证、签收单等
                  </FaButton>
                  <p class="text-xs text-muted-foreground m-0">
                    移除只取消本订单关联，未使用的临时文件由系统后续清理。
                  </p>
                </template>
                <p v-else class="text-sm text-muted-foreground m-0">
                  当前身份没有 sales-orders:document 权限，可不附凭证直接创建订单。
                </p>
                <p v-if="documentUploadError" class="text-sm text-destructive m-0" role="alert">
                  {{ documentUploadError }}
                </p>
                <div
                  v-for="(document, index) in formModel.documents"
                  :key="document.key"
                  class="p-4 border border-border rounded-lg gap-3 grid grid-cols-1 md:grid-cols-2"
                >
                  <div class="flex gap-3 min-w-0 items-start justify-between md:col-span-2">
                    <div class="min-w-0">
                      <strong class="text-sm break-all">{{ document.originalFilename }}</strong>
                      <p class="text-xs text-muted-foreground font-mono m-0 mt-1">
                        {{ document.mimeType }} · {{ document.sizeBytes }} bytes
                      </p>
                    </div>
                    <FaButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      :disabled="submitLocked"
                      :aria-label="`移除凭证 ${document.originalFilename}`"
                      @click="removeDocument(index)"
                    >
                      移除
                    </FaButton>
                  </div>
                  <FaFormItem :name="`documents.${index}.documentType`" label="凭证类型" required>
                    <FaSelect
                      :model-value="document.documentType"
                      :options="[
                        { label: '定金凭证', value: 'DEPOSIT_VOUCHER' },
                        { label: '签收单', value: 'DELIVERY_RECEIPT' },
                        { label: '其他', value: 'OTHER' },
                      ]"
                      class="w-full"
                      @update:model-value="handleDocumentTypeUpdate(index, $event as SalesOrderDocumentFormModel['documentType'])"
                    />
                  </FaFormItem>
                  <FaFormItem :name="`documents.${index}.title`" label="标题">
                    <FaInput
                      :model-value="document.title"
                      maxlength="128"
                      class="w-full"
                      @update:model-value="handleDocumentTitleUpdate(index, $event)"
                    />
                  </FaFormItem>
                  <FaFormItem :name="`documents.${index}.remark`" label="备注" class="md:col-span-2">
                    <FaTextarea
                      :model-value="document.remark"
                      maxlength="500"
                      class="w-full"
                      @update:model-value="updateDocument(index, { remark: String($event ?? '') })"
                    />
                  </FaFormItem>
                </div>
              </FaCard>

              <FaCard title="订单备注" description="可记录本订单其他约定，不写入客户主数据。">
                <FaTextarea
                  :model-value="formModel.remark"
                  maxlength="2000"
                  class="w-full"
                  @update:model-value="handleOrderRemarkUpdate"
                />
              </FaCard>
            </section>

            <nav
              class="mt-6 pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              aria-label="订单填写步骤操作"
            >
              <FaButton
                type="button"
                variant="outline"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                :disabled="submission.phase === 'submitting'"
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
                  :disabled="submission.phase === 'submitting'"
                  @click="openDetailsDrawer"
                >
                  查看已填详情
                </FaButton>
              </div>
            </nav>
          </div>
        </FaForm>
      </FaPageMain>

      <Transition name="sales-order-summary-panel">
        <aside
          v-show="isDesktopSummary || createSurface === 'review'"
          data-testid="sales-order-create-summary-column"
          class="sales-order-summary-column min-w-0 self-start"
          :data-surface="createSurface"
          :aria-label="createSurface === 'review' ? '销售订单最终核对' : '已填销售订单详情'"
        >
          <div class="sales-order-summary-shell">
            <header
              v-if="createSurface === 'review'"
              data-testid="sales-order-create-review"
              class="sales-order-review-heading"
            >
              <p class="text-xs text-primary tracking-wide font-semibold m-0">
                最终核对
              </p>
              <h2
                ref="reviewHeadingRef"
                class="text-xl tracking-tight font-semibold m-0 mt-1 outline-none rounded-md focus-visible:ring-2 focus-visible:ring-primary/40"
                tabindex="-1"
              >
                核对销售订单
              </h2>
              <p class="text-sm text-muted-foreground leading-6 m-0 mt-2">
                请确认下列资料无误；只有二次确认后才会正式保存并派发订单编号。
              </p>
            </header>

            <div
              ref="summaryRegionRef"
              class="sales-order-summary-region outline-none overscroll-contain rounded-2xl min-h-0 focus-visible:ring-2 focus-visible:ring-primary/40"
              role="region"
              :aria-label="createSurface === 'review' ? '待提交销售订单详情' : '已填销售订单详情'"
              :style="reviewSummaryStyle"
              tabindex="0"
            >
              <QsSalesOrderDesc
                :model="salesOrderDescModel"
                :currencies="fixedCurrencies"
              />
            </div>

            <div class="sales-order-review-actions-layer">
              <div class="sales-order-review-actions-viewport">
                <Transition name="sales-order-submit-bar">
                  <div
                    v-if="createSurface === 'review'"
                    ref="reviewActionsRef"
                    data-testid="sales-order-review-actions"
                    class="sales-order-review-actions p-4 border border-border rounded-2xl bg-background/95 shadow-lg"
                  >
                    <p
                      id="sales-order-review-submit-status"
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
                        @click="returnToSalesOrderForm"
                      >
                        返回修改
                      </FaButton>
                      <FaButton
                        type="button"
                        class="min-h-11 w-full sm:min-h-9 sm:min-w-36 sm:w-auto"
                        :loading="submission.phase === 'submitting'"
                        :disabled="!submitReady"
                        aria-describedby="sales-order-review-submit-status"
                        @click="requestSubmitConfirmation"
                      >
                        提交订单
                      </FaButton>
                    </div>
                  </div>
                </Transition>
              </div>
            </div>
          </div>
        </aside>
      </Transition>
    </div>

    <QsGenericDrawer
      :model-value="detailsDrawerVisible"
      data-testid="sales-order-details-drawer"
      title="已填销售订单详情"
      description="实时核对当前已填资料；完成第四步后通过“下一步”进入最终核对。"
      placement="right"
      size="xl"
      :submitting="submission.phase === 'submitting'"
      @closed="handleDetailsDrawerClosed"
      @update:model-value="detailsDrawerVisible = $event"
    >
      <QsSalesOrderDesc
        :model="salesOrderDescModel"
        :currencies="fixedCurrencies"
        class="border-0 rounded-none shadow-none md:rounded-2xl"
      />
      <template #footer>
        <div class="flex w-full justify-end">
          <FaButton
            type="button"
            variant="outline"
            class="min-h-11 w-full md:w-auto"
            @click="detailsDrawerVisible = false"
          >
            继续填写
          </FaButton>
        </div>
      </template>
    </QsGenericDrawer>

    <QsGenericModal
      :model-value="submitConfirmVisible"
      data-testid="sales-order-submit-confirmation"
      title="确认提交销售订单？"
      description="确认后将正式保存订单，并由 SALES_ORDER 规则派发订单编号。"
      size="sm"
      :closable="false"
      :dismiss-on-overlay="false"
      :submitting="submission.phase === 'submitting'"
      @closed="handleSubmitConfirmationClosed"
      @update:model-value="submitConfirmVisible = $event"
    >
      <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-[5rem_minmax(0,1fr)]">
        <dt class="text-sm text-muted-foreground">
          客户
        </dt>
        <dd class="text-sm font-medium m-0 break-words">
          {{ salesOrderDescModel.customer.name || '未填写' }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          产品数
        </dt>
        <dd class="text-sm font-medium m-0">
          {{ salesOrderDescModel.lines.length }} 项
        </dd>
        <dt class="text-sm text-muted-foreground">
          币种
        </dt>
        <dd class="text-sm font-medium font-mono m-0">
          {{ formModel.currencyCode }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          销售总价
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay
            :value="formModel.agreedTotalAmount"
            :currency="formModel.currencyCode"
            :currencies="fixedCurrencies"
          />
        </dd>
        <dt class="text-sm text-muted-foreground">
          约定定金
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay
            :value="formModel.depositDueAmount"
            :currency="formModel.currencyCode"
            :currencies="fixedCurrencies"
          />
        </dd>
        <dt class="text-sm text-muted-foreground">
          约定尾款
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay
            :value="formModel.balanceDueAmount"
            :currency="formModel.currencyCode"
            :currencies="fixedCurrencies"
          />
        </dd>
      </dl>
      <template #footer>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="submission.phase === 'submitting'"
          @click="submitConfirmVisible = false"
        >
          返回检查
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 sm:min-h-9"
          :loading="submission.phase === 'submitting'"
          :disabled="!submitReady"
          @click="confirmSubmitOrder"
        >
          确认保存并派号
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      :model-value="discardVisible"
      :title="discardTitle"
      :description="discardDescription"
      size="sm"
      @closed="handleDiscardClosed"
      @update:model-value="$event ? (discardVisible = true) : closeDiscard()"
    >
      <p class="text-sm text-muted-foreground m-0">
        {{ discardDescription }}
      </p>
      <template #footer>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="closeDiscard">
          继续编辑
        </FaButton>
        <FaButton type="button" variant="destructive" class="min-h-11 sm:min-h-9" @click="confirmDiscard">
          确认放弃
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
.sales-order-create-page {
  --sales-order-sticky-top: calc(var(--g-slots-layout-top-height, 0px) + var(--g-header-actual-height, 0px) + var(--g-topbar-actual-height, 0px) + var(--g-main-container-padding-top, 0px) + 1rem);
  --sales-order-review-viewport-height: calc(100dvh - var(--sales-order-sticky-top));
}

.sales-order-step-navigation {
  scroll-margin-top: var(--sales-order-sticky-top);
}

.sales-order-create-layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
  transition:
    grid-template-columns 420ms cubic-bezier(0.22, 1, 0.36, 1),
    column-gap 420ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sales-order-alert-stack {
  grid-column: 1 / -1;
}

.sales-order-form-track,
.sales-order-summary-column {
  grid-column: 1;
  min-width: 0;
}

.sales-order-form-track {
  transition:
    opacity 260ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

/*
 * 表单退出流布局后仍保留淡出与位移动画；inert/aria-hidden 由模板同步控制，
 * 因而视觉过渡期间不会留下可聚焦、可误操作的隐藏字段。
 */
.sales-order-create-layout--review .sales-order-form-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-height: calc(100dvh - var(--sales-order-sticky-top));
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-1.25rem);
}

.sales-order-summary-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.sales-order-summary-region {
  overflow: visible;
}

.sales-order-review-heading {
  padding: 0.25rem 0.25rem 0;
  scroll-margin-top: var(--sales-order-sticky-top);
}

.sales-order-review-actions {
  display: grid;
  gap: 0.75rem;
  backdrop-filter: blur(12px);
}

.sales-order-review-actions-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

/*
 * 操作层覆盖完整核对区域，内部 viewport 才负责 sticky。这样即使详情很长，
 * 提交操作也会从进入核对态起停靠在可视底部，而不是等用户滚到文档末尾。
 */
.sales-order-review-actions-viewport {
  position: sticky;
  top: var(--sales-order-sticky-top);
  display: flex;
  align-items: flex-end;
  height: var(--sales-order-review-viewport-height);
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}

.sales-order-review-actions-viewport > .sales-order-review-actions {
  width: 100%;
  pointer-events: auto;
}

.sales-order-summary-panel-enter-active,
.sales-order-summary-panel-leave-active {
  transition:
    opacity 260ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sales-order-summary-panel-enter-from,
.sales-order-summary-panel-leave-to {
  opacity: 0;
  transform: translateY(0.75rem);
}

.sales-order-submit-bar-enter-active,
.sales-order-submit-bar-leave-active {
  transition:
    opacity 220ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sales-order-submit-bar-enter-from,
.sales-order-submit-bar-leave-to {
  opacity: 0;
  transform: translateY(calc(100% + 1rem));
}

@media (width >= 1280px) {
  .sales-order-create-layout--form {
    grid-template-columns: minmax(0, calc(100% - 31.5rem)) minmax(0, 30rem);
  }

  .sales-order-create-layout--review {
    grid-template-columns: minmax(0, 0) minmax(0, 100%);
    column-gap: 0;
  }

  .sales-order-summary-column {
    position: sticky;
    top: var(--sales-order-sticky-top);
    grid-column: 2;
    max-height: calc(100dvh - var(--sales-order-sticky-top) - 1rem);
  }

  .sales-order-create-layout--form .sales-order-summary-shell {
    max-height: inherit;
  }

  .sales-order-create-layout--form .sales-order-summary-region {
    overflow-y: auto;
  }

  .sales-order-create-layout--review .sales-order-form-track {
    width: calc(100% - 31.5rem);
  }
}

.sales-order-create-layout--review .sales-order-summary-column {
  position: relative;
  min-height: var(--sales-order-review-viewport-height);
  max-height: none;
}

.sales-order-create-layout--review .sales-order-summary-shell {
  position: relative;
  display: flex;
  min-height: inherit;
}

.sales-order-create-layout--review .sales-order-summary-region {
  overflow: visible;
}

@media (prefers-reduced-motion: reduce) {
  .sales-order-create-layout,
  .sales-order-form-track,
  .sales-order-summary-panel-enter-active,
  .sales-order-summary-panel-leave-active,
  .sales-order-submit-bar-enter-active,
  .sales-order-submit-bar-leave-active {
    transition: none;
  }

  .sales-order-create-layout--review .sales-order-form-track {
    transform: none;
  }

  .sales-order-summary-panel-enter-from,
  .sales-order-summary-panel-leave-to,
  .sales-order-submit-bar-enter-from,
  .sales-order-submit-bar-leave-to {
    opacity: 1;
    transform: none;
  }
}

/*
 * 当前布局由 window 滚动，而 FaPageMain 与外层容器的 overflow 会错误成为
 * sticky 参照系。只在新增销售订单存在时桥接为 visible，不改变公共布局默认值。
 */
:global(.layout .main-container:has(.sales-order-create-page)),
:global(#app-content:has(.sales-order-create-page)) {
  overflow: visible;
}
</style>
