<script setup lang="ts">
import type { ReceiptSubmission } from '../../workbenches/sales-receipts/submission.logic'
import type {
  SalesOrderPaymentDraft,
  SalesOrderPaymentDraftErrors,
  SalesOrderPaymentStatusReasonTone,
  SalesOrderRecordsInitialAction,
  SalesOrderRecordsKind,
} from './sales-order-records-modal.logic'

import type {
  SalesOrderAmountRevisionDto,
  SalesOrderDetailDto,
  SalesOrderDocumentDto,
  SalesOrderListItemDto,
  SalesOrderPaymentDto,
  SalesOrderStatusHistoryDto,
  SalesOrderTemporaryDocumentDto,
  SalesReceiptRequestDetailDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import salesOrdersApi from '@/api/modules/sales-orders'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import OrderReceiptRequests from '../../workbenches/sales-receipts/order-receipt-requests.vue'
import { findReceiptSourcePage } from '../../workbenches/sales-receipts/order-receipt-summary.logic'
import { freezeReceiptSubmission, isReceiptResultUnknown } from '../../workbenches/sales-receipts/submission.logic'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import {
  buildSalesOrderDeliveryReceiptRequest,
  buildSalesOrderPaymentRequest,
  formatSalesOrderLocalDateTime,
  resolveSalesOrderModalCancelAction,
  resolveSalesOrderModalInitialState,
  splitSalesOrderPaymentStatusReason,
} from './sales-order-records-modal.logic'

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  initialAction: SalesOrderRecordsInitialAction
  kind: SalesOrderRecordsKind
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'detailUpdated': [detail: SalesOrderDetailDto]
  'update:modelValue': [value: boolean]
}>()

interface UploadedVoucher extends SalesOrderTemporaryDocumentDto {
  readonly previewUrl: null | string
}

const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const { t } = useI18n()
const receiptRequests = shallowRef<SalesReceiptRequestDetailDto[]>([])
const receiptPage = ref(1)
const activeReceiptTab = ref<'payments' | 'requests'>('payments')
const receiptFilter = ref<SalesReceiptRequestDetailDto['status'] | 'ALL'>('ALL')
const receiptCounts = ref({ PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0, VOIDED: 0 })
const receiptCount = computed(() => Object.values(receiptCounts.value).reduce((sum, value) => sum + value, 0))
const focusedReceiptId = ref<string | null>(null)
const focusedPaymentId = ref<string | null>(null)
const paymentRecordsRef = ref<HTMLElement | null>(null)
const sourceLoading = ref(false)
const sourceError = ref('')
let sourceController: AbortController | null = null
const receiptTotal = ref(0)
const pendingReceiptAmount = ref('0.0000')
const receiptSubmission = shallowRef<ReceiptSubmission | null>(null)
const receiptUnknown = ref(false)
const legacyVoidId = ref<string | null>(null)
const legacyVoidReason = ref('')
const legacyVoidError = ref('')
const resubmittedFromId = ref<string | null>(null)
const toast = useQsToast()
const detail = ref<SalesOrderDetailDto | null>(null)
const receiptTabs = computed(() => [
  { label: `实际收款（${detail.value?.payments.length ?? 0}）`, value: 'payments' },
  { label: `收款申请（${receiptCount.value}）`, value: 'requests' },
])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const activeChangeTab = ref<'status' | 'amount'>('status')
const modalState = ref(resolveSalesOrderModalInitialState(props.initialAction))
const actionSubmitting = ref(false)
const actionUploading = ref(false)
const actionError = ref('')
const paymentErrors = shallowRef<SalesOrderPaymentDraftErrors>({})
const receiptErrors = shallowRef<SalesOrderPaymentDraftErrors>({})
const paymentType = ref<SalesOrderPaymentDraft['paymentType']>('DEPOSIT')
const paymentAmount = ref<null | string>(null)
const paymentReceivedAt = ref('')
const paymentMethod = ref<string | null>(null)
const paymentRemark = ref('')
const paymentVoucher = shallowRef<UploadedVoucher | null>(null)
const deliveryReceipt = shallowRef<UploadedVoucher | null>(null)
const deliveryReceiptRemark = ref('')
const paymentFileInputRef = useTemplateRef<HTMLInputElement>('paymentFileInputRef')
const receiptFileInputRef = useTemplateRef<HTMLInputElement>('receiptFileInputRef')
let requestVersion = 0
let detailAbortController: AbortController | null = null
let actionAbortController: AbortController | null = null
const paymentMethodCatalog = useDictionaryCatalog('payment.method')

const modalVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const recordsModalTitle = computed(() => ({
  payments: '订单收款',
  documents: '订单凭证',
  changes: '变更记录',
})[props.kind])
const modalTitle = computed(() => ({
  'create-payment': t('salesReceipt.submit'),
  'create-receipt': '货物签收',
  'records': recordsModalTitle.value,
})[modalState.value.view])
const modalDescription = computed(() => props.order === null
  ? '查看销售订单相关记录。'
  : `${props.order.orderNo} · ${props.order.customerName}`)
const recordsModalIcon = computed(() => ({
  payments: 'i-lucide:hand-coins',
  documents: 'i-lucide:files',
  changes: 'i-lucide:history',
})[props.kind])
const modalIcon = computed(() => ({
  'create-payment': 'i-lucide:hand-coins',
  'create-receipt': 'i-lucide:package-check',
  'records': recordsModalIcon.value,
})[modalState.value.view])
const modalSize = computed(() => modalState.value.view === 'create-receipt' ? 'md' : 'xl')
const activeDocuments = computed(() => detail.value?.documents.filter(
  document => document.detachedAt === null,
) ?? [])
const changeTabs = computed(() => [
  {
    label: `状态变更（${detail.value?.statusHistory.length ?? 0}）`,
    value: 'status',
  },
  {
    label: `金额变更（${detail.value?.amountRevisions.length ?? 0}）`,
    value: 'amount',
  },
])
const canRecordPayment = computed(() => (
  auth('sales-orders:payment') && auth('sales-orders:document')
))
const actionLocked = computed(() => actionSubmitting.value || actionUploading.value)
const paymentLocked = computed(() => actionLocked.value || receiptUnknown.value)
// 收款原币契约保留四位小数，与资金账户人民币两位显示独立。
const paymentCurrencies = computed(() => props.currencies.map(currency => ({ ...currency, minorUnit: 4 as const })))
const paymentTypeOptions: Array<{
  label: string
  value: SalesOrderPaymentDraft['paymentType']
}> = [
  { label: '定金', value: 'DEPOSIT' },
  { label: '过程款', value: 'PROGRESS' },
  { label: '开票税金', value: 'INVOICE_TAX' },
  { label: '尾款', value: 'BALANCE' },
  { label: '其他', value: 'OTHER' },
]

function paymentTypeLabel(value: SalesOrderPaymentDto['paymentType']): string {
  return {
    BALANCE: '尾款',
    DEPOSIT: '定金',
    INVOICE_TAX: '开票税金',
    OTHER: '其他',
    PROGRESS: '过程款',
  }[value]
}

function paymentMethodLabel(value: string | null): string {
  if (value === null || value.trim() === '') {
    return '—'
  }
  return paymentMethodCatalog.resolve(value)?.label ?? value
}

function documentTypeLabel(value: SalesOrderDocumentDto['documentType']): string {
  return {
    DELIVERY_RECEIPT: '签收单',
    ORDER_ISSUANCE_VOUCHER: '出单凭证',
    PAYMENT_VOUCHER: '收款凭证',
  }[value]
}

/** 凭证类型以稳定语义色辅助识别，文字仍是凭证类型的唯一含义来源。 */
function documentTypeTagClass(value: SalesOrderDocumentDto['documentType']): string {
  return {
    DELIVERY_RECEIPT: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    ORDER_ISSUANCE_VOUCHER: 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300',
    PAYMENT_VOUCHER: 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  }[value]
}

function documentAssociationLabel(document: SalesOrderDocumentDto): string {
  return document.documentType === 'PAYMENT_VOUCHER'
    ? '已关联实际收款记录'
    : '订单级凭证'
}

function linkedPayment(document: SalesOrderDocumentDto): SalesOrderPaymentDto | null {
  return document.paymentId === null
    ? null
    : detail.value?.payments.find(payment => payment.id === document.paymentId) ?? null
}

function statusDimensionLabel(value: SalesOrderStatusHistoryDto['dimension']): string {
  return { ORDER: '订单状态', FULFILLMENT: '订单进度', PAYMENT: '付款状态' }[value]
}

function statusValueLabel(value: string): string {
  return {
    DRAFT: '草稿',
    CONFIRMED: '已确认',
    PENDING_RECONCILIATION: '待对账',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    PENDING: '待采购',
    PREPARING: '备货中',
    LAND_TRANSIT: '陆运中',
    WAREHOUSE_ARRIVED: '已到仓',
    SEA_TRANSIT: '海运中',
    SIGNED: '已签收',
    UNPAID: '未付款',
    PARTIALLY_PAID: '部分付款',
    PAID: '已付清',
  }[value] ?? value
}

function optionalText(value: string | null): string {
  return value?.trim() || '—'
}

/** 收款金额与剩余应收分别使用稳定的业务语义色，原因原文仍由文本片段完整组成。 */
function paymentStatusReasonSegmentClass(
  tone: SalesOrderPaymentStatusReasonTone,
): string {
  return {
    default: '',
    outstanding: 'text-destructive font-semibold',
    received: 'text-emerald-700 dark:text-emerald-300 font-semibold',
  }[tone]
}

function amountRevisionItems(revision: SalesOrderAmountRevisionDto) {
  return [
    {
      label: '销售总价',
      oldValue: revision.oldAgreedTotalAmount,
      newValue: revision.newAgreedTotalAmount,
    },
    {
      label: '定金',
      oldValue: revision.oldDepositDueAmount,
      newValue: revision.newDepositDueAmount,
    },
    {
      label: '尾款',
      oldValue: revision.oldBalanceDueAmount,
      newValue: revision.newBalanceDueAmount,
    },
  ]
}

function handleChangeTab(value: string | number): void {
  if (value === 'status' || value === 'amount') {
    activeChangeTab.value = value
  }
}

function releaseUploadedVoucher(voucher: UploadedVoucher | null): void {
  if (voucher?.previewUrl !== null && voucher?.previewUrl !== undefined) {
    URL.revokeObjectURL(voucher.previewUrl)
  }
}

function resetPaymentForm(): void {
  receiptSubmission.value = null
  receiptUnknown.value = false
  resubmittedFromId.value = null
  releaseUploadedVoucher(paymentVoucher.value)
  paymentType.value = 'DEPOSIT'
  paymentAmount.value = null
  paymentReceivedAt.value = formatSalesOrderLocalDateTime(new Date())
  paymentMethod.value = null
  paymentRemark.value = ''
  paymentVoucher.value = null
  paymentErrors.value = {}
  actionError.value = ''
}

function resetReceiptForm(): void {
  releaseUploadedVoucher(deliveryReceipt.value)
  deliveryReceipt.value = null
  deliveryReceiptRemark.value = ''
  receiptErrors.value = {}
  actionError.value = ''
}

function openPaymentModal(): void {
  cancelSourceRequest()
  if (!canRecordPayment.value || detail.value === null) {
    return
  }
  resetPaymentForm()
  modalState.value = { origin: 'records', view: 'create-payment' }
}

/** 单一弹窗宿主内切换视图，彻底避免表格快捷操作产生双弹窗闪屏。 */
function cancelActionView(): void {
  if (paymentLocked.value) {
    return
  }
  const action = resolveSalesOrderModalCancelAction(modalState.value)
  resetPaymentForm()
  resetReceiptForm()
  if (action === 'records') {
    modalState.value = { origin: 'records', view: 'records' }
  }
  else {
    modalVisible.value = false
  }
}

function clearPaymentError(field: string): void {
  paymentErrors.value = Object.fromEntries(
    Object.entries(paymentErrors.value).filter(([path]) => path !== field),
  )
  actionError.value = ''
}

function clearReceiptError(field: string): void {
  receiptErrors.value = Object.fromEntries(
    Object.entries(receiptErrors.value).filter(([path]) => path !== field),
  )
  actionError.value = ''
}

function openPaymentFilePicker(): void {
  if (!actionLocked.value && paymentVoucher.value === null) {
    paymentFileInputRef.value?.click()
  }
}

function openReceiptFilePicker(): void {
  if (!actionLocked.value && deliveryReceipt.value === null) {
    receiptFileInputRef.value?.click()
  }
}

async function uploadActionVoucher(
  file: File,
  target: 'payment' | 'receipt',
): Promise<void> {
  actionAbortController?.abort()
  const controller = new AbortController()
  actionAbortController = controller
  actionUploading.value = true
  actionError.value = ''
  try {
    const response = await salesOrdersApi.uploadTemporaryDocument(
      file,
      file.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
      controller.signal,
    )
    if (controller.signal.aborted) {
      return
    }
    const uploaded: UploadedVoucher = {
      ...response.data,
      previewUrl: response.data.mediaType === 'IMAGE' ? URL.createObjectURL(file) : null,
    }
    if (target === 'payment') {
      releaseUploadedVoucher(paymentVoucher.value)
      paymentVoucher.value = uploaded
      clearPaymentError('voucher')
    }
    else {
      releaseUploadedVoucher(deliveryReceipt.value)
      deliveryReceipt.value = uploaded
      clearReceiptError('receipt')
    }
  }
  catch (error) {
    if (!isSalesOrderAbortError(error)) {
      actionError.value = getSalesOrderApiFailure(error).message
    }
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      actionUploading.value = false
    }
  }
}

function handlePaymentFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) {
    void uploadActionVoucher(file, 'payment')
  }
}

function handleReceiptFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file !== undefined) {
    void uploadActionVoucher(file, 'receipt')
  }
}

function removePaymentVoucher(): void {
  if (actionLocked.value) {
    return
  }
  releaseUploadedVoucher(paymentVoucher.value)
  paymentVoucher.value = null
  clearPaymentError('voucher')
}

function removeDeliveryReceipt(): void {
  if (actionLocked.value) {
    return
  }
  releaseUploadedVoucher(deliveryReceipt.value)
  deliveryReceipt.value = null
  clearReceiptError('receipt')
}

async function submitPayment(): Promise<void> {
  const orderId = detail.value?.id
  if (orderId === undefined || actionLocked.value || !canRecordPayment.value) {
    return
  }
  if (receiptSubmission.value === null) {
    const result = buildSalesOrderPaymentRequest({
      amount: paymentAmount.value,
      paymentMethod: paymentMethod.value ?? '',
      paymentType: paymentType.value,
      receivedAt: paymentReceivedAt.value,
      remark: paymentRemark.value,
      voucherMediaAssetId: paymentVoucher.value?.mediaAssetId ?? null,
    }, 4)
    if (!result.valid) {
      paymentErrors.value = result.fieldErrors
      actionError.value = t('salesReceipt.invalid')
      return
    }
    receiptSubmission.value = freezeReceiptSubmission({
      ...result.request,
      ...(resubmittedFromId.value === null ? {} : { resubmittedFromId: resubmittedFromId.value }),
    }, crypto.randomUUID())
  }
  const controller = new AbortController()
  actionAbortController = controller
  actionSubmitting.value = true
  actionError.value = ''
  try {
    const frozen = receiptSubmission.value
    const submitted = await salesReceiptsApi.submit(orderId, frozen.payload, frozen.idempotencyKey, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    resetPaymentForm()
    modalState.value = { origin: 'records', view: 'records' }
    activeReceiptTab.value = 'requests'
    receiptFilter.value = 'ALL'
    receiptPage.value = 1
    focusedReceiptId.value = submitted.data.id
    toast.success(t('salesReceipt.submitted'))
    await loadDetail()
    if (detail.value) {
      emit('detailUpdated', detail.value)
    }
  }
  catch (error) {
    receiptUnknown.value = isReceiptResultUnknown(error)
    if (!receiptUnknown.value) {
      receiptSubmission.value = null
    }
    actionError.value = receiptUnknown.value
      ? t('salesReceipt.unknown')
      : getSalesOrderApiFailure(error).message
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      actionSubmitting.value = false
    }
  }
}

function resubmitReceipt(request: SalesReceiptRequestDetailDto): void {
  if (!canRecordPayment.value) {
    return
  }
  resetPaymentForm()
  paymentType.value = request.paymentType
  paymentAmount.value = request.amount
  paymentReceivedAt.value = formatSalesOrderLocalDateTime(new Date(request.receivedAt))
  paymentMethod.value = request.paymentMethod
  paymentRemark.value = request.remark ?? ''
  resubmittedFromId.value = request.id
  // 重提复用服务端冻结凭证；不得撤销原申请的凭证引用。
  paymentVoucher.value = {
    mediaAssetId: request.voucher.mediaAssetId,
    originalFilename: request.voucher.title,
    mediaType: 'DOCUMENT',
    mimeType: '',
    sizeBytes: '',
    previewUrl: null,
  }
  modalState.value = { origin: 'records', view: 'create-payment' }
}

async function voidLegacyPayment(): Promise<void> {
  if (!detail.value || !legacyVoidId.value || actionLocked.value || !auth('sales-receipts:void')) {
    return
  }
  if (!legacyVoidReason.value.trim()) {
    legacyVoidError.value = t('salesReceipt.reasonRequired')
    return
  }
  const current = new AbortController()
  actionAbortController = current
  actionSubmitting.value = true
  legacyVoidError.value = ''
  try {
    const response = await salesOrdersApi.voidPayment(detail.value.id, legacyVoidId.value, {
      expectedOrderVersion: detail.value.version,
      reason: legacyVoidReason.value.trim(),
    }, current.signal)
    if (current.signal.aborted) {
      return
    }
    detail.value = response.data
    emit('detailUpdated', response.data)
    legacyVoidId.value = null
    legacyVoidReason.value = ''
    toast.success(t('salesReceipt.saved'))
  }
  catch (failure) {
    if (!current.signal.aborted) {
      legacyVoidError.value = getSalesOrderApiFailure(failure).message
    }
  }
  finally {
    if (actionAbortController === current) {
      actionAbortController = null
      actionSubmitting.value = false
    }
  }
}

async function submitDeliveryReceipt(): Promise<void> {
  const orderId = detail.value?.id
  const previousOrderStatus = detail.value?.orderStatus
  if (orderId === undefined || actionLocked.value) {
    return
  }
  const result = buildSalesOrderDeliveryReceiptRequest(
    deliveryReceipt.value?.mediaAssetId ?? null,
    deliveryReceiptRemark.value,
  )
  if (!result.valid) {
    receiptErrors.value = result.fieldErrors
    actionError.value = '请修正未通过校验的签收信息'
    return
  }

  const controller = new AbortController()
  actionAbortController = controller
  actionSubmitting.value = true
  actionError.value = ''
  try {
    const response = await salesOrdersApi.submitDeliveryReceipt(
      orderId,
      result.request,
      controller.signal,
    )
    if (controller.signal.aborted) {
      return
    }
    detail.value = response.data
    emit('detailUpdated', response.data)
    const returnToRecords = modalState.value.origin === 'records'
    resetReceiptForm()
    if (returnToRecords) {
      modalState.value = { origin: 'records', view: 'records' }
    }
    else {
      modalVisible.value = false
    }
    toast.success(
      previousOrderStatus === 'CONFIRMED'
      && response.data.orderStatus === 'PENDING_RECONCILIATION'
        ? '订单已签收且已付清，已自动进入待对账'
        : '签收单上传成功，订单已进入已签收',
    )
  }
  catch (error) {
    if (!isSalesOrderAbortError(error)) {
      actionError.value = getSalesOrderApiFailure(error).message
    }
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      actionSubmitting.value = false
    }
  }
}

function cancelSourceRequest(): void {
  sourceController?.abort()
  sourceController = null
  sourceLoading.value = false
}

function handleReceiptTab(value: string | number): void {
  if (value === 'payments' || value === 'requests') {
    cancelSourceRequest()
    activeReceiptTab.value = value
  }
}

async function filterReceiptRequests(value: string | number): Promise<void> {
  if (!['ALL', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(String(value))) {
    return
  }
  receiptFilter.value = value as typeof receiptFilter.value
  receiptPage.value = 1
  focusedReceiptId.value = null
  await loadDetail()
}

async function showPayment(paymentId: string): Promise<void> {
  cancelSourceRequest()
  sourceError.value = ''
  activeReceiptTab.value = 'payments'
  focusedPaymentId.value = paymentId
  await nextTick()
  const element = [...(paymentRecordsRef.value?.querySelectorAll<HTMLElement>('[data-payment-id]') ?? [])].find(item => item.dataset.paymentId === paymentId)
  element?.scrollIntoView({ block: 'nearest' })
  element?.focus({ preventScroll: true })
}

async function showReceiptSource(paymentId: string): Promise<void> {
  const orderId = detail.value?.id
  if (!orderId || sourceLoading.value) {
    return
  }
  const controller = new AbortController()
  sourceController = controller
  sourceLoading.value = true
  sourceError.value = ''
  try {
    const result = await findReceiptSourcePage(paymentId, async page => (await salesReceiptsApi.orderRequests(orderId, { status: 'APPROVED', page, pageSize: 20 }, controller.signal)).data, controller.signal)
    if (controller.signal.aborted || !props.modelValue || props.order?.id !== orderId) {
      return
    }
    if (!result) {
      sourceError.value = '未找到对应的来源申请，请刷新后重试。'
      return
    }
    receiptFilter.value = 'APPROVED'
    receiptPage.value = result.page
    focusedReceiptId.value = result.requestId
    activeReceiptTab.value = 'requests'
    await loadDetail()
  }
  catch (error) {
    if (!controller.signal.aborted) {
      sourceError.value = getSalesOrderApiFailure(error).message
    }
  }
  finally {
    if (sourceController === controller) {
      sourceController = null
      sourceLoading.value = false
    }
  }
}

function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

function cancelActionRequest(): void {
  actionAbortController?.abort()
  actionAbortController = null
  actionSubmitting.value = false
  actionUploading.value = false
}

/** 每次打开都读取最新详情，避免列表计数和弹窗记录在状态变更后出现时间差。 */
async function loadDetail(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }

  cancelDetailRequest()
  const currentVersion = requestVersion
  const controller = new AbortController()
  detailAbortController = controller
  loading.value = true
  errorMessage.value = null
  detail.value = null

  try {
    const [response, requests] = await Promise.all([
      salesOrdersApi.getById(orderId, controller.signal),
      salesReceiptsApi.orderRequests(orderId, { page: receiptPage.value, pageSize: 20, status: receiptFilter.value === 'ALL' ? undefined : receiptFilter.value }, controller.signal),
    ])
    if (
      currentVersion !== requestVersion
      || controller.signal.aborted
      || props.order?.id !== orderId
      || !props.modelValue
    ) {
      return
    }
    detail.value = response.data
    receiptRequests.value = requests.data.items
    receiptTotal.value = requests.data.total
    receiptCounts.value = requests.data.statusCounts
    pendingReceiptAmount.value = requests.data.pendingAmount ?? '0.0000'
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || currentVersion !== requestVersion) {
      return
    }
    errorMessage.value = getSalesOrderApiFailure(error).message
  }
  finally {
    if (currentVersion === requestVersion) {
      loading.value = false
      detailAbortController = null
    }
  }
}

watch(
  () => [props.modelValue, props.order?.id, props.kind] as const,
  ([visible, orderId]) => {
    cancelSourceRequest()
    if (!visible || orderId === undefined) {
      cancelSourceRequest()
      cancelDetailRequest()
      cancelActionRequest()
      resetPaymentForm()
      resetReceiptForm()
      detail.value = null
      errorMessage.value = null
      loading.value = false
      return
    }
    modalState.value = resolveSalesOrderModalInitialState(props.initialAction)
    if (modalState.value.view === 'create-payment') {
      resetPaymentForm()
    }
    else if (modalState.value.view === 'create-receipt') {
      resetReceiptForm()
    }
    receiptPage.value = 1
    activeChangeTab.value = 'status'
    activeReceiptTab.value = 'payments'
    receiptFilter.value = 'ALL'
    focusedReceiptId.value = null
    focusedPaymentId.value = null
    sourceError.value = ''
    void loadDetail()
  },
  { immediate: true },
)

watch(() => accountStore.authEpoch, () => {
  cancelSourceRequest()
  cancelDetailRequest()
  cancelActionRequest()
  resetPaymentForm()
  legacyVoidId.value = null
  legacyVoidReason.value = ''
  receiptRequests.value = []
  detail.value = null
  modalVisible.value = false
})

onBeforeUnmount(() => {
  cancelSourceRequest()
  cancelDetailRequest()
  cancelActionRequest()
  releaseUploadedVoucher(paymentVoucher.value)
  releaseUploadedVoucher(deliveryReceipt.value)
})
</script>

<template>
  <QsGenericModal
    v-model="modalVisible"
    :title="modalTitle"
    :description="modalDescription"
    :loading="loading"
    :error="errorMessage"
    :size="modalSize"
    :submitting="paymentLocked"
    :dismiss-on-escape="!paymentLocked"
    :dismiss-on-overlay="!paymentLocked"
  >
    <template #header-leading>
      <FaIcon :name="modalIcon" class="size-5" aria-hidden="true" />
    </template>

    <template #header-extra>
      <FaButton
        v-if="modalState.view === 'records' && kind === 'payments' && canRecordPayment"
        type="button"
        size="sm"
        @click="openPaymentModal"
      >
        <FaIcon name="i-lucide:circle-plus" aria-hidden="true" />{{ t('salesReceipt.submit') }}
      </FaButton>
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadDetail">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />重新加载
      </FaButton>
    </template>

    <template v-if="detail && modalState.view === 'records'">
      <section v-if="kind === 'payments'" aria-label="订单收款" class="flex flex-col gap-4">
        <dl class="m-0 p-4 border border-border rounded-xl bg-muted/15 gap-4 grid sm:grid-cols-3">
          <div>
            <dt class="qs-type-meta mb-2">
              有效已收款
            </dt><dd class="text-primary m-0">
              <AmountDisplay :value="detail.amounts.receivedAmount" :currency="detail.currencyCode" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta mb-2">
              待审核金额
            </dt><dd class="m-0">
              <AmountDisplay :value="pendingReceiptAmount" :currency="detail.currencyCode" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta mb-2">
              待收金额
            </dt><dd class="m-0">
              <AmountDisplay :value="detail.amounts.outstandingAmount" :currency="detail.currencyCode" :currencies="currencies" />
            </dd>
          </div>
        </dl>
        <p class="qs-type-meta m-0">
          待审核金额不计入有效已收款，也不抵扣待收金额。
        </p>
        <FaAlert v-if="sourceError" variant="destructive" :title="sourceError" />
        <FaTabs :model-value="activeReceiptTab" :list="receiptTabs" list-class="h-auto min-h-11 w-full" content-class="mt-4 min-w-0" @update:model-value="handleReceiptTab">
          <template #requests>
            <div class="mb-4 flex flex-wrap gap-2" aria-label="收款申请状态筛选">
              <FaButton v-for="option in [{ value: 'ALL', label: '全部' }, { value: 'PENDING_REVIEW', label: '待审核' }, { value: 'APPROVED', label: '已通过' }, { value: 'REJECTED', label: '已驳回' }]" :key="option.value" size="sm" :variant="receiptFilter === option.value ? 'default' : 'outline'" :aria-pressed="receiptFilter === option.value" @click="filterReceiptRequests(option.value)">
                {{ option.label }}
              </FaButton>
            </div>
            <OrderReceiptRequests v-model:page="receiptPage" :items="receiptRequests" :currencies="currencies" :total="receiptTotal" :focused-id="focusedReceiptId" :can-submit="canRecordPayment" @resubmit="resubmitReceipt" @page-change="loadDetail" @show-payment="showPayment" />
          </template>
          <template #payments>
            <div ref="paymentRecordsRef">
              <FaEmpty
                v-if="detail.payments.length === 0"
                icon="i-lucide:hand-coins"
                title="暂无实际收款记录"
                description="该订单还没有有效或已作废的收款记录。"
                class="py-10"
              />
              <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
                <li
                  v-for="payment in detail.payments"
                  :key="payment.id"
                  :data-payment-id="payment.id"
                  tabindex="-1"
                  :class="focusedPaymentId === payment.id ? 'ring-2 ring-primary/30' : ''"
                  class="px-3 py-4 rounded-lg gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap gap-2 items-center">
                      <h3 class="qs-type-section-title m-0">
                        {{ paymentTypeLabel(payment.paymentType) }}
                      </h3>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="payment.voidedAt === null
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-destructive/30 bg-destructive/10 text-destructive'"
                      >
                        {{ payment.voidedAt === null ? '有效' : '已作废' }}
                      </FaTag>
                      <FaButton v-if="payment.origin === 'REVIEWED'" variant="link" size="sm" :disabled="sourceLoading" @click="showReceiptSource(payment.id)">
                        查看来源申请
                      </FaButton>
                    </div>
                    <p class="qs-type-meta m-0 mt-2">
                      收款时间：<DateTimeDisplay :value="payment.receivedAt" />
                    </p>
                    <dl class="text-sm m-0 mt-3 gap-x-5 gap-y-2 grid sm:grid-cols-2">
                      <div>
                        <dt class="text-muted-foreground inline">
                          收款方式：
                        </dt><dd class="m-0 inline">
                          {{ paymentMethodLabel(payment.paymentMethod) }}
                        </dd>
                      </div>
                      <div class="sm:col-span-2">
                        <dt class="text-muted-foreground inline">
                          备注：
                        </dt><dd class="m-0 inline break-words">
                          {{ optionalText(payment.remark) }}
                        </dd>
                      </div>
                      <div class="sm:col-span-2">
                        <dt class="text-muted-foreground inline">
                          记录人：
                        </dt>
                        <dd class="m-0 inline-flex gap-2 items-center">
                          <QsPersonDisplay :display-name="payment.createdBy.displayName" size="sm" />
                          <DateTimeDisplay :value="payment.createdAt" />
                        </dd>
                      </div>
                    </dl>
                    <div class="mt-3 p-3 border border-border rounded-lg bg-muted/15 flex gap-3 min-w-0 items-center">
                      <FaImagePreview
                        v-if="payment.voucher.mediaType === 'IMAGE'"
                        :src="payment.voucher.contentUrl"
                        class="rounded-md shrink-0 size-14 object-cover"
                        :aria-label="`收款凭证 ${payment.voucher.title || payment.voucher.originalFilename}`"
                      />
                      <a
                        v-else
                        :href="payment.voucher.contentUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="border border-border rounded-md bg-background flex shrink-0 size-14 items-center justify-center"
                      >
                        <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-6" aria-hidden="true" />
                      </a>
                      <div class="min-w-0">
                        <p class="text-sm font-medium m-0 truncate">
                          {{ payment.voucher.title || payment.voucher.originalFilename }}
                        </p>
                        <p class="qs-type-meta m-0 mt-1 truncate">
                          {{ payment.voucher.originalFilename }}
                        </p>
                      </div>
                    </div>
                    <div
                      v-if="payment.voidedAt"
                      class="text-sm mt-3 p-3 border border-destructive/20 rounded-lg bg-destructive/5"
                    >
                      <p class="m-0 break-words">
                        作废原因：{{ optionalText(payment.voidReason) }}
                      </p>
                      <p class="text-muted-foreground m-0 mt-1">
                        {{ payment.voidedBy?.displayName ?? '未知用户' }} · <DateTimeDisplay :value="payment.voidedAt" />
                      </p>
                    </div>
                  </div>
                  <AmountDisplay
                    :value="payment.amount"
                    :currency="detail.currencyCode"
                    :currencies="currencies"
                    class="qs-type-data-emphasis text-primary font-semibold whitespace-nowrap self-start sm:text-right"
                  />
                  <div v-if="payment.origin === 'LEGACY'" class="sm:col-span-2">
                    <p class="text-sm text-muted-foreground">
                      {{ t('salesReceipt.legacy') }}
                    </p>
                    <FaButton v-if="!payment.voidedAt && detail.orderStatus !== 'COMPLETED' && auth('sales-receipts:void') && legacyVoidId !== payment.id" variant="outline" :disabled="actionLocked" @click="legacyVoidId = payment.id; legacyVoidReason = ''; legacyVoidError = ''">
                      {{ t('salesReceipt.void') }}
                    </FaButton>
                    <div v-if="legacyVoidId === payment.id" class="space-y-3">
                      <FaAlert v-if="legacyVoidError" variant="destructive" :title="legacyVoidError" />
                      <FaTextarea v-model="legacyVoidReason" :maxlength="500" :aria-label="t('salesReceipt.reason')" :placeholder="t('salesReceipt.reasonRequired')" :disabled="actionLocked" />
                      <div class="flex gap-3">
                        <FaButton variant="outline" :disabled="actionLocked" @click="legacyVoidId = null">
                          {{ t('salesReceipt.cancel') }}
                        </FaButton><FaButton :loading="actionSubmitting" :disabled="actionLocked" @click="voidLegacyPayment">
                          {{ t('salesReceipt.confirm') }}
                        </FaButton>
                      </div>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </template>
        </FaTabs>
      </section>

      <section v-else-if="kind === 'documents'" aria-label="订单凭证列表">
        <FaEmpty
          v-if="activeDocuments.length === 0"
          icon="i-lucide:files"
          title="暂无订单凭证"
          description="该订单目前没有有效凭证。"
          class="py-10"
        />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li
            v-for="document in activeDocuments"
            :key="document.id"
            class="py-4 flex gap-4 min-w-0 items-start"
          >
            <FaImagePreview
              v-if="document.mediaType === 'IMAGE'"
              :src="document.contentUrl"
              class="shrink-0 size-20 object-cover"
              role="img"
              :aria-label="`凭证图片 ${document.title || document.originalFilename}`"
            >
              <template #error>
                <div class="text-muted-foreground flex size-20 items-center justify-center">
                  <FaIcon name="i-lucide:image-off" class="size-8" aria-hidden="true" />
                  <span class="sr-only">凭证图片加载失败</span>
                </div>
              </template>
            </FaImagePreview>
            <a
              v-else
              :href="document.contentUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="border border-border rounded-lg bg-muted/30 flex shrink-0 size-20 items-center justify-center overflow-hidden"
              :aria-label="`打开凭证 ${document.title || document.originalFilename}`"
            >
              <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-8" aria-hidden="true" />
            </a>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <h3 class="qs-type-section-title m-0 break-words">
                  {{ document.title || document.originalFilename }}
                </h3>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="documentTypeTagClass(document.documentType)"
                >
                  {{ documentTypeLabel(document.documentType) }}
                </FaTag>
              </div>
              <p class="qs-type-meta m-0 mt-1 break-all">
                {{ document.originalFilename }}<template v-if="document.mimeType">
                  · {{ document.mimeType }}
                </template><template v-if="document.sizeBytes">
                  · {{ document.sizeBytes }} bytes
                </template>
              </p>
              <p class="text-sm m-0 mt-2 break-words">
                备注：{{ optionalText(document.remark) }}
              </p>
              <div
                v-if="linkedPayment(document)"
                class="text-sm mt-3 p-3 border border-primary/40 rounded-lg bg-primary/5 flex flex-wrap gap-x-4 gap-y-2 items-center"
              >
                <span>收款类型：{{ paymentTypeLabel(linkedPayment(document)!.paymentType) }}</span>
                <span class="inline-flex gap-1 items-center">
                  收款金额：
                  <AmountDisplay
                    :value="linkedPayment(document)!.amount"
                    :currency="detail.currencyCode"
                    :currencies="currencies"
                    class="text-primary"
                  />
                </span>
                <span>收款时间：<DateTimeDisplay :value="linkedPayment(document)!.receivedAt" /></span>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="linkedPayment(document)!.voidedAt === null
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'"
                >
                  {{ linkedPayment(document)!.voidedAt === null ? '有效' : '已作废' }}
                </FaTag>
              </div>
              <div class="qs-type-meta mt-3 flex flex-wrap gap-x-4 gap-y-2 items-center">
                <span class="inline-flex gap-2 items-center">
                  上传人：<QsPersonDisplay :display-name="document.createdBy.displayName" size="sm" />
                </span>
                <span>上传时间：<DateTimeDisplay :value="document.createdAt" /></span>
                <span>{{ documentAssociationLabel(document) }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section v-else-if="kind === 'changes'" aria-label="订单变更记录">
        <FaTabs
          :model-value="activeChangeTab"
          :list="changeTabs"
          list-class="h-auto min-h-11 w-full"
          content-class="mt-4 min-w-0"
          @update:model-value="handleChangeTab"
        >
          <template #status>
            <FaEmpty
              v-if="detail.statusHistory.length === 0"
              icon="i-lucide:history"
              title="暂无状态变更"
              description="订单状态、订单进度和付款状态尚无变更记录。"
              class="py-10"
            />
            <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
              <li v-for="history in detail.statusHistory" :key="history.id" class="py-4">
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <h3 class="qs-type-section-title m-0">
                    {{ statusDimensionLabel(history.dimension) }}
                  </h3>
                  <DateTimeDisplay :value="history.changedAt" class="qs-type-meta" />
                </div>
                <p class="m-0 mt-2 flex flex-wrap gap-2 items-center">
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ statusValueLabel(history.fromStatus) }}
                  </FaTag>
                  <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ statusValueLabel(history.toStatus) }}
                  </FaTag>
                </p>
                <p class="text-sm m-0 mt-3 break-words">
                  <span>原因：</span><span
                    v-for="(segment, index) in splitSalesOrderPaymentStatusReason(optionalText(history.reason))"
                    :key="`${history.id}-${index}`"
                    :class="paymentStatusReasonSegmentClass(segment.tone)"
                  >{{ segment.text }}</span>
                </p>
                <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
                  操作人：<QsPersonDisplay :display-name="history.changedBy.displayName" size="sm" />
                </div>
              </li>
            </ul>
          </template>

          <template #amount>
            <FaEmpty
              v-if="detail.amountRevisions.length === 0"
              icon="i-lucide:badge-dollar-sign"
              title="暂无金额变更"
              description="销售总价、定金和尾款尚无修改记录。"
              class="py-10"
            />
            <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
              <li v-for="revision in detail.amountRevisions" :key="revision.id" class="py-4">
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <h3 class="qs-type-section-title m-0">
                    金额约定变更
                  </h3>
                  <DateTimeDisplay :value="revision.changedAt" class="qs-type-meta" />
                </div>
                <div class="mt-3 gap-3 grid md:grid-cols-3">
                  <div
                    v-for="amount in amountRevisionItems(revision)"
                    :key="amount.label"
                    class="p-3 border border-border rounded-lg bg-muted/15"
                  >
                    <p class="qs-type-compact-label m-0">
                      {{ amount.label }}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2 items-center">
                      <AmountDisplay :value="amount.oldValue" :currency="detail.currencyCode" :currencies="currencies" />
                      <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
                      <AmountDisplay :value="amount.newValue" :currency="detail.currencyCode" :currencies="currencies" />
                    </div>
                  </div>
                </div>
                <p class="text-sm m-0 mt-3 break-words">
                  原因：{{ revision.reason }}
                </p>
                <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
                  操作人：<QsPersonDisplay :display-name="revision.changedBy.displayName" size="sm" />
                </div>
              </li>
            </ul>
          </template>
        </FaTabs>
      </section>
    </template>

    <template v-if="detail && modalState.view === 'create-payment'">
      <p v-if="resubmittedFromId" class="text-sm text-muted-foreground break-words">
        {{ t('salesReceipt.rejectedReason') }}: {{ receiptRequests.find(request => request.id === resubmittedFromId)?.reviewRemark }}
      </p>
      <FaAlert
        v-if="actionError"
        variant="destructive"
        icon="i-lucide:circle-alert"
        :title="t('salesReceipt.notSubmitted')"
        :description="actionError"
        class="mb-4"
        role="alert"
      />

      <FaForm
        :model="{ paymentType, paymentAmount, paymentReceivedAt, paymentMethod, paymentRemark }"
        :disabled="paymentLocked"
      >
        <div class="gap-x-4 gap-y-1 grid sm:grid-cols-2">
          <FaFormItem name="paymentType" label="收款类型" required>
            <FaSelect
              v-model="paymentType"
              :options="paymentTypeOptions"
              class="min-h-11 w-full sm:min-h-9"
              @update:model-value="clearPaymentError('paymentType')"
            />
            <p v-if="paymentErrors.paymentType" class="text-xs text-destructive m-0 mt-1">
              {{ paymentErrors.paymentType }}
            </p>
          </FaFormItem>
          <FaFormItem name="paymentAmount" label="收款金额" required>
            <MoneyInput
              v-model="paymentAmount"
              :currency="detail?.currencyCode ?? null"
              :currencies="paymentCurrencies"
              :disabled="paymentLocked"
              :currency-selectable="false"
              min="0.0001"
              @update:model-value="clearPaymentError('amount')"
            />
            <p v-if="paymentErrors.amount" class="text-xs text-destructive m-0 mt-1">
              {{ paymentErrors.amount }}
            </p>
          </FaFormItem>
          <FaFormItem name="paymentReceivedAt" label="收款时间" required>
            <FaInput
              v-model="paymentReceivedAt"
              type="datetime-local"
              class="min-h-11 w-full sm:min-h-9"
              @update:model-value="clearPaymentError('receivedAt')"
            />
            <p v-if="paymentErrors.receivedAt" class="text-xs text-destructive m-0 mt-1">
              {{ paymentErrors.receivedAt }}
            </p>
          </FaFormItem>
          <FaFormItem name="paymentMethod" label="收款方式" required>
            <QsDictionarySelect
              v-model="paymentMethod"
              dictionary-code="payment.method"
              :clearable="false"
              placeholder="请选择收款方式"
              class="min-h-11 w-full sm:min-h-9"
              @update:model-value="clearPaymentError('paymentMethod')"
            />
            <p v-if="paymentErrors.paymentMethod" class="text-xs text-destructive m-0 mt-1">
              {{ paymentErrors.paymentMethod }}
            </p>
          </FaFormItem>
          <FaFormItem name="paymentRemark" label="备注" class="sm:col-span-2">
            <FaTextarea
              v-model="paymentRemark"
              maxlength="500"
              class="w-full"
              input-class="min-h-20 max-h-36"
              @update:model-value="clearPaymentError('remark')"
            />
            <p v-if="paymentErrors.remark" class="text-xs text-destructive m-0 mt-1">
              {{ paymentErrors.remark }}
            </p>
          </FaFormItem>
        </div>
      </FaForm>

      <section class="mt-2" aria-labelledby="payment-voucher-title">
        <h3 id="payment-voucher-title" class="qs-type-section-title m-0">
          收款凭证 <span class="text-destructive" aria-hidden="true">*</span>
        </h3>
        <p class="qs-type-meta m-0 mt-1">
          每笔收款必须上传且只能上传一份凭证；系统提交时自动按“客户名-凭证类型-时间戳”命名。
        </p>
        <input
          ref="paymentFileInputRef"
          type="file"
          accept="image/*,.pdf,.doc,.docx"
          class="sr-only"
          :disabled="paymentLocked"
          @change="handlePaymentFileInput"
        >
        <FaButton
          v-if="paymentVoucher === null"
          type="button"
          variant="outline"
          class="mt-3 min-h-11 w-full"
          :loading="actionUploading"
          :disabled="paymentLocked"
          @click="openPaymentFilePicker"
        >
          <FaIcon name="i-lucide:upload-cloud" aria-hidden="true" />上传收款凭证
        </FaButton>
        <div v-else class="mt-3 p-3 border border-border rounded-lg flex gap-3 min-w-0 items-center">
          <FaImagePreview
            v-if="paymentVoucher.previewUrl"
            :src="paymentVoucher.previewUrl"
            class="rounded-md shrink-0 size-16 object-cover"
            :aria-label="`待提交收款凭证 ${paymentVoucher.originalFilename}`"
          />
          <div v-else class="border border-border rounded-md bg-muted/30 flex shrink-0 size-16 items-center justify-center">
            <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-7" aria-hidden="true" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium m-0 truncate">
              {{ paymentVoucher.originalFilename }}
            </p>
            <p v-if="paymentVoucher.mimeType" class="qs-type-meta m-0 mt-1">
              {{ paymentVoucher.mimeType }} · {{ paymentVoucher.sizeBytes }} bytes
            </p>
          </div>
          <FaButton type="button" variant="ghost" size="sm" :disabled="paymentLocked" @click="removePaymentVoucher">
            移除
          </FaButton>
        </div>
        <p v-if="paymentErrors.voucher" class="text-xs text-destructive m-0 mt-1">
          {{ paymentErrors.voucher }}
        </p>
      </section>
    </template>

    <template v-if="detail && modalState.view === 'create-receipt'">
      <FaAlert
        v-if="actionError"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="签收单未保存"
        :description="actionError"
        class="mb-4"
        role="alert"
      />
      <p class="text-sm text-muted-foreground m-0">
        只需上传一份签收单。提交后作为订单级凭证保存，并自动将订单进度更新为已签收。
      </p>
      <FaForm :model="{ deliveryReceiptRemark }" :disabled="actionLocked" class="mt-4">
        <FaFormItem name="deliveryReceiptRemark" label="备注（选填）">
          <FaTextarea
            v-model="deliveryReceiptRemark"
            :maxlength="500"
            class="w-full"
            input-class="min-h-20 max-h-36"
            placeholder="填写本次货物签收说明"
            @update:model-value="clearReceiptError('remark')"
          />
          <p v-if="receiptErrors.remark" class="text-xs text-destructive m-0 mt-1">
            {{ receiptErrors.remark }}
          </p>
        </FaFormItem>
      </FaForm>
      <input
        ref="receiptFileInputRef"
        data-testid="sales-order-delivery-receipt-input"
        type="file"
        accept="image/*,.pdf,.doc,.docx"
        class="sr-only"
        :disabled="actionLocked"
        @change="handleReceiptFileInput"
      >
      <FaButton
        v-if="deliveryReceipt === null"
        type="button"
        variant="outline"
        class="min-h-11 w-full"
        :loading="actionUploading"
        :disabled="actionLocked"
        @click="openReceiptFilePicker"
      >
        <FaIcon name="i-lucide:upload-cloud" aria-hidden="true" />上传签收单
      </FaButton>
      <div v-else class="mt-4 p-3 border border-border rounded-lg flex gap-3 min-w-0 items-center">
        <FaImagePreview
          v-if="deliveryReceipt.previewUrl"
          :src="deliveryReceipt.previewUrl"
          class="rounded-md shrink-0 size-16 object-cover"
          :aria-label="`待提交签收单 ${deliveryReceipt.originalFilename}`"
        />
        <div v-else class="border border-border rounded-md bg-muted/30 flex shrink-0 size-16 items-center justify-center">
          <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-7" aria-hidden="true" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium m-0 truncate">
            {{ deliveryReceipt.originalFilename }}
          </p>
          <p class="qs-type-meta m-0 mt-1">
            {{ deliveryReceipt.mimeType }} · {{ deliveryReceipt.sizeBytes }} bytes
          </p>
        </div>
        <FaButton type="button" variant="ghost" size="sm" :disabled="actionLocked" @click="removeDeliveryReceipt">
          移除
        </FaButton>
      </div>
      <p v-if="receiptErrors.receipt" class="text-xs text-destructive m-0 mt-1">
        {{ receiptErrors.receipt }}
      </p>
      <p class="qs-type-meta m-0 mt-3">
        系统提交时自动按“客户名-签收单-时间戳”命名。
      </p>
    </template>

    <template #footer>
      <template v-if="modalState.view === 'create-payment'">
        <FaButton type="button" variant="outline" :disabled="paymentLocked" @click="cancelActionView">
          取消
        </FaButton>
        <FaButton type="button" :loading="actionSubmitting" :disabled="actionLocked" @click="submitPayment">
          {{ receiptUnknown ? t('salesReceipt.retryOriginal') : t('salesReceipt.submit') }}
        </FaButton>
      </template>
      <template v-else-if="modalState.view === 'create-receipt'">
        <FaButton type="button" variant="outline" :disabled="actionLocked" @click="cancelActionView">
          取消
        </FaButton>
        <FaButton type="button" :loading="actionSubmitting" :disabled="actionLocked" @click="submitDeliveryReceipt">
          确认货物签收
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
