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
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

import SalesOrderCreateReview from './sales-order-create-review.vue'
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
  resolveSalesOrderIssuerLabel,
  resolveSalesOrderSubmissionFailure,
  resolveSalesOrderSubmissionSuccess,
  SALES_ORDER_CREATE_REVIEW_STEP,
  validateSalesOrderCreateStep,
} from './sales-order-create.logic'
import SalesOrderLines from './sales-order-lines.vue'

type DiscardIntent = 'navigation' | 'unknown-abandon'

defineOptions({ name: 'OperationsSalesOrderCreate' })

const salesOrderSteps: StepsItem[] = [
  { id: 'base', title: '基础信息' },
  { id: 'customer', title: '客户地址' },
  { id: 'products-sales', title: '产品与销售' },
  { id: 'documents', title: '订单凭证' },
  { id: 'review', title: '核对提交' },
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
const activeStep = ref<SalesOrderCreateStep>(0)
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
const discardIntent = ref<DiscardIntent | null>(null)
const formRef = useTemplateRef<FormExpose<SalesOrderFormModel>>('formRef')
const stepNavigationRef = useTemplateRef<HTMLElement>('stepNavigationRef')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInputRef')
const appliedFormErrorFields = new Set<string>()
let productRequestVersion = 0
let productAbortController: AbortController | null = null
let productSearchTimer: ReturnType<typeof setTimeout> | null = null
let submitRequestVersion = 0
let submitAbortController: AbortController | null = null
let documentAbortController: AbortController | null = null
let pendingNavigationResolver: ((allow: boolean) => void) | null = null

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
const activeStepTitle = computed(() => salesOrderSteps[activeStep.value]?.title ?? '')

function goToStep(step: number): void {
  activeStep.value = Math.min(
    Math.max(step, 0),
    SALES_ORDER_CREATE_REVIEW_STEP,
  ) as SalesOrderCreateStep
  // 各步骤高度不同，切换后回到进度区，避免沿用上一页底部滚动位置而漏看字段。
  void nextTick(() => {
    stepNavigationRef.value?.scrollIntoView({ block: 'start' })
  })
}

function previousStep(): void {
  goToStep(activeStep.value - 1)
}

function nextStep(): void {
  if (activeStep.value === 1 || activeStep.value === 2) {
    const result = validateSalesOrderCreateStep(
      formModel.value,
      activeStep.value,
      amountPrecision.value,
      todayIso,
    )
    if (!result.valid) {
      replaceFieldErrors(result.fieldErrors)
      formError.value = ''
      formFailure.value = null
      return
    }
    clearFeedback()
  }
  goToStep(activeStep.value + 1)
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

function clearFeedback(path?: string): void {
  const next = path === undefined
    ? {}
    : Object.fromEntries(Object.entries(fieldErrors.value).filter(([field]) => (
        field !== path && !field.startsWith(`${path}.`)
      )))
  replaceFieldErrors(next)
  formError.value = ''
  formFailure.value = null
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
      formModel.value.documents.push({
        ...response.data,
        key: crypto.randomUUID(),
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
    formModel.value = createSalesOrderFormModel(initialCurrency, todayIso)
    clearFeedback()
    toast.success(`销售订单 ${response.data.orderNo} 创建成功`)
    if (canRead.value) {
      await router.push({ name: 'operationsSalesOrders' })
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
    goToStep(resolveSalesOrderCreateStepForErrors(failure.fieldErrors))
    submission.value = resolveSalesOrderSubmissionFailure(state, failure)
  }
  finally {
    if (submitAbortController === controller) {
      submitAbortController = null
    }
  }
}

async function submitOrder(): Promise<void> {
  if (
    activeStep.value !== SALES_ORDER_CREATE_REVIEW_STEP
    || !canCreate.value
    || submission.value.phase !== 'editing'
  ) {
    return
  }
  if (currencyUnavailable.value) {
    formError.value = '当前订单币种不可用，请返回列表重新选择或先启用该币种'
    return
  }
  const result = buildCreateSalesOrderRequest(formModel.value, amountPrecision.value, todayIso)
  if (!result.valid) {
    replaceFieldErrors(result.fieldErrors)
    goToStep(resolveSalesOrderCreateStepForErrors(result.fieldErrors))
    formError.value = '部分资料未通过校验，请修正后再正式保存'
    formFailure.value = null
    return
  }
  clearFeedback()
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
  const state = replayUnknownSalesOrderSubmission(submission.value, {
    authEpoch: appAccountStore.authEpoch,
    requestVersion: ++submitRequestVersion,
  })
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
  discardVisible.value = true
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
    formModel.value = createSalesOrderFormModel(initialCurrency, todayIso)
    activeStep.value = 0
    clearFeedback()
    toast.info('已放弃本次未知结果')
    return
  }
  formModel.value = createSalesOrderFormModel(initialCurrency, todayIso)
  activeStep.value = 0
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
  if (!shouldConfirmDiscard.value) {
    return true
  }
  if (pendingNavigationResolver !== null) {
    return false
  }
  discardIntent.value = 'navigation'
  discardVisible.value = true
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
  })
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

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <FaAlert
        v-if="formError"
        class="mb-5"
        title="销售订单保存失败"
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
        class="mb-5"
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

      <FaForm
        ref="formRef"
        :model="formModel"
        :disabled="submitLocked"
        :aria-busy="submission.phase === 'submitting' ? 'true' : 'false'"
        class="min-w-0"
        @submit="submitOrder"
      >
        <nav
          ref="stepNavigationRef"
          class="mb-6 pb-5 border-b border-border scroll-mt-20"
          aria-label="新增销售订单填写步骤"
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
          class="gap-6 grid grid-cols-1 lg:grid-cols-12"
          aria-label="产品明细与销售信息"
          data-testid="sales-order-step-products-sales"
        >
          <div class="min-w-0 lg:col-span-8">
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

          <aside class="min-w-0 lg:col-span-4 lg:self-start">
            <FaCard
              title="销售与付款约定"
              description="两条金额等式均采用硬拦截，服务端会再次复核。"
              content-class="gap-4 grid"
            >
              <div class="p-4 border border-border rounded-lg bg-muted/25">
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
              <FaFormItem name="agreedTotalAmount" label="手填销售总价" required :auto-bind="false">
                <MoneyInput
                  v-model="formModel.agreedTotalAmount"
                  :currency="formModel.currencyCode"
                  :currencies="fixedCurrencies"
                  min="0"
                  :disabled="submitLocked"
                  name="agreedTotalAmount"
                  @update:model-value="clearFeedback('agreedTotalAmount')"
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
                  @update:model-value="clearFeedback('depositDueAmount')"
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
              <div class="text-xs text-muted-foreground leading-5 p-3 border border-border rounded-lg">
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
            <FaTextarea v-model="formModel.remark" maxlength="2000" class="w-full" />
          </FaCard>
        </section>

        <section
          v-show="activeStep === SALES_ORDER_CREATE_REVIEW_STEP"
          aria-label="核对并提交"
          data-testid="sales-order-step-review"
        >
          <SalesOrderCreateReview
            :model="formModel"
            :issuer-label="issuerLabel"
            :full-address="fullAddressPreview"
            :line-subtotal-amount="lineSubtotalAmount"
            :amount-precision="amountPrecision"
          />
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
          <div class="flex flex-col gap-2 sm:flex-row">
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
              v-if="activeStep < SALES_ORDER_CREATE_REVIEW_STEP"
              type="button"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              :disabled="submitLocked"
              @click="nextStep"
            >
              下一步
            </FaButton>
            <FaButton
              v-if="activeStep === SALES_ORDER_CREATE_REVIEW_STEP"
              type="submit"
              class="min-h-11 w-full sm:min-h-9 sm:w-auto"
              :loading="submission.phase === 'submitting'"
              :disabled="submission.phase !== 'editing' || currencyUnavailable"
            >
              正式保存并派号
            </FaButton>
          </div>
        </nav>
      </FaForm>
    </FaPageMain>

    <QsGenericModal
      :model-value="discardVisible"
      :title="discardTitle"
      :description="discardDescription"
      size="sm"
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
