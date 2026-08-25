<script setup lang="ts">
import type {
  SalesOrderPaymentDraft,
  SalesOrderPaymentDraftErrors,
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
} from '@/api/generated/types.gen'

import type { CurrencyDescriptor } from '@/components/base/currency'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import {
  buildSalesOrderDeliveryReceiptRequest,
  buildSalesOrderPaymentRequest,
  formatSalesOrderLocalDateTime,
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
const toast = useQsToast()
const detail = ref<SalesOrderDetailDto | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const activeChangeTab = ref<'status' | 'amount'>('status')
const paymentModalVisible = ref(false)
const receiptModalVisible = ref(false)
const actionSubmitting = ref(false)
const actionUploading = ref(false)
const actionError = ref('')
const paymentErrors = shallowRef<SalesOrderPaymentDraftErrors>({})
const receiptErrors = shallowRef<SalesOrderPaymentDraftErrors>({})
const paymentType = ref<SalesOrderPaymentDraft['paymentType']>('DEPOSIT')
const paymentAmount = ref<null | string>(null)
const paymentReceivedAt = ref('')
const paymentMethod = ref('')
const paymentRemark = ref('')
const paymentVoucher = shallowRef<UploadedVoucher | null>(null)
const deliveryReceipt = shallowRef<UploadedVoucher | null>(null)
const deliveryReceiptRemark = ref('')
const paymentFileInputRef = useTemplateRef<HTMLInputElement>('paymentFileInputRef')
const receiptFileInputRef = useTemplateRef<HTMLInputElement>('receiptFileInputRef')
let requestVersion = 0
let detailAbortController: AbortController | null = null
let actionAbortController: AbortController | null = null
let initialActionConsumed = false

const modalVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const modalTitle = computed(() => ({
  payments: '实际收款记录',
  documents: '订单凭证',
  changes: '变更记录',
})[props.kind])
const modalDescription = computed(() => props.order === null
  ? '查看销售订单相关记录。'
  : `${props.order.orderNo} · ${props.order.customerName}`)
const modalIcon = computed(() => ({
  payments: 'i-lucide:hand-coins',
  documents: 'i-lucide:files',
  changes: 'i-lucide:history',
})[props.kind])
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
const canSubmitDeliveryReceipt = computed(() => auth('sales-orders:document'))
const actionLocked = computed(() => actionSubmitting.value || actionUploading.value)
const currencyPrecision = computed(() => props.currencies.find(
  currency => currency.code === detail.value?.currencyCode,
)?.minorUnit ?? 2)
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
    CANCELLED: '已取消',
    PENDING: '待处理',
    PREPARING: '备货中',
    SHIPPED: '已发货',
    SIGNED: '已签收',
    UNPAID: '未付款',
    PARTIALLY_PAID: '部分付款',
    PAID: '已付清',
  }[value] ?? value
}

function optionalText(value: string | null): string {
  return value?.trim() || '—'
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
  releaseUploadedVoucher(paymentVoucher.value)
  paymentType.value = 'DEPOSIT'
  paymentAmount.value = null
  paymentReceivedAt.value = formatSalesOrderLocalDateTime(new Date())
  paymentMethod.value = ''
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
  if (!canRecordPayment.value || detail.value === null) {
    return
  }
  resetPaymentForm()
  paymentModalVisible.value = true
}

function openReceiptModal(): void {
  if (!canSubmitDeliveryReceipt.value || detail.value === null) {
    return
  }
  resetReceiptForm()
  receiptModalVisible.value = true
}

function closePaymentModal(): void {
  if (!actionLocked.value) {
    paymentModalVisible.value = false
    resetPaymentForm()
  }
}

function closeReceiptModal(): void {
  if (!actionLocked.value) {
    receiptModalVisible.value = false
    resetReceiptForm()
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
  if (orderId === undefined || actionLocked.value) {
    return
  }
  const result = buildSalesOrderPaymentRequest({
    amount: paymentAmount.value,
    paymentMethod: paymentMethod.value,
    paymentType: paymentType.value,
    receivedAt: paymentReceivedAt.value,
    remark: paymentRemark.value,
    voucherMediaAssetId: paymentVoucher.value?.mediaAssetId ?? null,
  }, currencyPrecision.value)
  if (!result.valid) {
    paymentErrors.value = result.fieldErrors
    actionError.value = '请修正未通过校验的收款信息'
    return
  }

  const controller = new AbortController()
  actionAbortController = controller
  actionSubmitting.value = true
  actionError.value = ''
  try {
    const response = await salesOrdersApi.recordPayment(orderId, result.request, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    detail.value = response.data
    emit('detailUpdated', response.data)
    paymentModalVisible.value = false
    resetPaymentForm()
    toast.success('实际收款记录添加成功')
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

async function submitDeliveryReceipt(): Promise<void> {
  const orderId = detail.value?.id
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
    receiptModalVisible.value = false
    resetReceiptForm()
    toast.success('签收单上传成功，订单进度保持不变')
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
    const response = await salesOrdersApi.getById(orderId, controller.signal)
    if (
      currentVersion !== requestVersion
      || controller.signal.aborted
      || props.order?.id !== orderId
      || !props.modelValue
    ) {
      return
    }
    detail.value = response.data
    if (!initialActionConsumed) {
      initialActionConsumed = true
      if (props.initialAction === 'payment') {
        openPaymentModal()
      }
      else if (props.initialAction === 'receipt') {
        openReceiptModal()
      }
    }
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
    if (!visible || orderId === undefined) {
      initialActionConsumed = false
      cancelDetailRequest()
      cancelActionRequest()
      paymentModalVisible.value = false
      receiptModalVisible.value = false
      resetPaymentForm()
      resetReceiptForm()
      detail.value = null
      errorMessage.value = null
      loading.value = false
      return
    }
    initialActionConsumed = false
    activeChangeTab.value = 'status'
    void loadDetail()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
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
    size="xl"
  >
    <template #header-leading>
      <FaIcon :name="modalIcon" class="size-5" aria-hidden="true" />
    </template>

    <template #header-extra>
      <FaButton
        v-if="kind === 'payments' && canRecordPayment"
        type="button"
        size="sm"
        @click="openPaymentModal"
      >
        <FaIcon name="i-lucide:circle-plus" aria-hidden="true" />新增实际收款
      </FaButton>
      <FaButton
        v-else-if="kind === 'documents' && canSubmitDeliveryReceipt"
        type="button"
        size="sm"
        @click="openReceiptModal"
      >
        <FaIcon name="i-lucide:package-check" aria-hidden="true" />货物签收
      </FaButton>
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadDetail">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />重新加载
      </FaButton>
    </template>

    <template v-if="detail">
      <section v-if="kind === 'payments'" aria-label="实际收款记录列表">
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
            class="py-4 gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto]"
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
              </div>
              <p class="qs-type-meta m-0 mt-2">
                收款时间：<DateTimeDisplay :value="payment.receivedAt" />
              </p>
              <dl class="text-sm m-0 mt-3 gap-x-5 gap-y-2 grid sm:grid-cols-2">
                <div>
                  <dt class="text-muted-foreground inline">
                    收款方式：
                  </dt><dd class="m-0 inline">
                    {{ optionalText(payment.paymentMethod) }}
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
              class="qs-type-data-emphasis text-emerald-700 font-semibold whitespace-nowrap dark:text-emerald-300 sm:text-right"
            />
          </li>
        </ul>
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
                class="text-sm mt-3 p-3 border border-border rounded-lg bg-muted/15 flex flex-wrap gap-x-4 gap-y-2 items-center"
              >
                <span>收款类型：{{ paymentTypeLabel(linkedPayment(document)!.paymentType) }}</span>
                <span class="inline-flex gap-1 items-center">
                  收款金额：
                  <AmountDisplay
                    :value="linkedPayment(document)!.amount"
                    :currency="detail.currencyCode"
                    :currencies="currencies"
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
                  原因：{{ optionalText(history.reason) }}
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
  </QsGenericModal>

  <QsGenericModal
    v-model="paymentModalVisible"
    title="新增实际收款"
    :description="detail === null ? undefined : `${detail.orderNo} · ${detail.customer.name}`"
    size="lg"
    :submitting="actionLocked"
    :dismiss-on-escape="!actionLocked"
    :dismiss-on-overlay="!actionLocked"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:hand-coins" class="size-5" aria-hidden="true" />
    </template>

    <FaAlert
      v-if="actionError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="收款信息未保存"
      :description="actionError"
      class="mb-4"
      role="alert"
    />

    <FaForm
      :model="{ paymentType, paymentAmount, paymentReceivedAt, paymentMethod, paymentRemark }"
      :disabled="actionLocked"
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
            :currencies="currencies"
            min="0.01"
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
        <FaFormItem name="paymentMethod" label="收款方式">
          <FaInput
            v-model="paymentMethod"
            maxlength="64"
            placeholder="例如：银行转账"
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
        :disabled="actionLocked"
        @change="handlePaymentFileInput"
      >
      <FaButton
        v-if="paymentVoucher === null"
        type="button"
        variant="outline"
        class="mt-3 min-h-11 w-full"
        :loading="actionUploading"
        :disabled="actionLocked"
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
          <p class="qs-type-meta m-0 mt-1">
            {{ paymentVoucher.mimeType }} · {{ paymentVoucher.sizeBytes }} bytes
          </p>
        </div>
        <FaButton type="button" variant="ghost" size="sm" :disabled="actionLocked" @click="removePaymentVoucher">
          移除
        </FaButton>
      </div>
      <p v-if="paymentErrors.voucher" class="text-xs text-destructive m-0 mt-1">
        {{ paymentErrors.voucher }}
      </p>
    </section>

    <template #footer>
      <FaButton type="button" variant="outline" :disabled="actionLocked" @click="closePaymentModal">
        取消
      </FaButton>
      <FaButton type="button" :loading="actionSubmitting" :disabled="actionLocked" @click="submitPayment">
        确认添加收款
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    v-model="receiptModalVisible"
    title="货物签收"
    :description="detail === null ? undefined : `${detail.orderNo} · ${detail.customer.name}`"
    size="md"
    :submitting="actionLocked"
    :dismiss-on-escape="!actionLocked"
    :dismiss-on-overlay="!actionLocked"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:package-check" class="size-5" aria-hidden="true" />
    </template>

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
      只需上传一份签收单。提交后作为订单级凭证保存，暂不自动更新订单进度。
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

    <template #footer>
      <FaButton type="button" variant="outline" :disabled="actionLocked" @click="closeReceiptModal">
        取消
      </FaButton>
      <FaButton type="button" :loading="actionSubmitting" :disabled="actionLocked" @click="submitDeliveryReceipt">
        确认货物签收
      </FaButton>
    </template>
  </QsGenericModal>
</template>
