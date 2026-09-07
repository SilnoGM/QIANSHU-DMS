<script setup lang="ts">
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderDocumentDto,
  PurchaseOrderPaymentDto,
  PurchaseOrderPaymentRequestDto,
  PurchaseOrderTemporaryDocumentDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildPurchaseOrderCancellationRequest,
  buildPurchaseOrderFulfillmentRequest,
  buildPurchaseOrderPaymentRequest,
  buildPurchaseOrderPaymentVoidRequest,
  formatPurchaseOrderLocalDateTime,
  purchaseOrderPaymentTypeLabel,
} from './purchase-order-detail.logic'
import {
  canCancelPurchaseOrderFromList,
  fulfillmentStatusLabel,
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
  nextPurchaseOrderFulfillmentStatus,
} from './purchase-order-list.logic'

interface UploadedVoucher extends PurchaseOrderTemporaryDocumentDto {
  readonly previewUrl: string | null
}

type ActionDialog = 'cancel' | 'detach' | 'fulfillment' | 'payment' | 'void'

defineOptions({ name: 'PurchaseOrderDetailActions' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  detail: PurchaseOrderDetailDto
}>()

const emit = defineEmits<{
  busyChange: [busy: boolean]
  detailUpdated: [detail: PurchaseOrderDetailDto]
  failure: [message: string]
}>()

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const submitting = ref(false)
const uploading = ref(false)
const actionError = ref('')
const activeDialog = ref<ActionDialog | null>(null)
const actionReason = ref('')
const actionReasonError = ref('')
const selectedPayment = shallowRef<PurchaseOrderPaymentDto | null>(null)
const selectedDocument = shallowRef<PurchaseOrderDocumentDto | null>(null)
const paymentType = ref<PurchaseOrderPaymentRequestDto['paymentType']>('DEPOSIT')
const paymentAmount = ref<string | null>(null)
const paidAtLocal = ref('')
const paymentMethod = ref<string | null>(null)
const paymentRemark = ref('')
const paymentErrors = shallowRef<Readonly<Record<string, string>>>({})
const paymentVoucher = shallowRef<UploadedVoucher | null>(null)
const paymentFileInputRef = useTemplateRef<HTMLInputElement>('paymentFileInputRef')
let actionAbortController: AbortController | null = null

const canUpdate = computed(() => auth('purchase-orders:update'))
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const canManageDocument = computed(() => auth('purchase-orders:document'))
const actionLocked = computed(() => submitting.value || uploading.value)
const nextFulfillmentStatus = computed(() => nextPurchaseOrderFulfillmentStatus(props.detail))
const canRecordPayment = computed(() => (
  canManagePayment.value
  && props.detail.orderStatus === 'CONFIRMED'
  && props.detail.paymentStatus !== 'PAID'
))

const paymentTypeOptions = [
  { label: '定金', value: 'DEPOSIT' },
  { label: '尾款', value: 'BALANCE' },
  { label: '其他', value: 'OTHER' },
] satisfies Array<{
  label: string
  value: PurchaseOrderPaymentRequestDto['paymentType']
}>

function formatFileSize(value: string | null): string {
  if (value === null) {
    return '大小未知'
  }
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '大小未知'
  }
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function clearPaymentForm(): void {
  if (paymentVoucher.value?.previewUrl) {
    URL.revokeObjectURL(paymentVoucher.value.previewUrl)
  }
  paymentType.value = 'DEPOSIT'
  paymentAmount.value = null
  paidAtLocal.value = formatPurchaseOrderLocalDateTime(new Date())
  paymentMethod.value = null
  paymentRemark.value = ''
  paymentErrors.value = {}
  paymentVoucher.value = null
  if (paymentFileInputRef.value) {
    paymentFileInputRef.value.value = ''
  }
}

function clearActionState(): void {
  actionError.value = ''
  actionReason.value = ''
  actionReasonError.value = ''
  selectedPayment.value = null
  selectedDocument.value = null
}

function cancelPendingRequests(): void {
  actionAbortController?.abort()
  actionAbortController = null
  submitting.value = false
  uploading.value = false
}

function applyUpdatedDetail(updated: PurchaseOrderDetailDto, message: string): void {
  emit('detailUpdated', updated)
  activeDialog.value = null
  clearActionState()
  clearPaymentForm()
  toast.success(message)
}

function openPaymentDialog(): void {
  if (!canRecordPayment.value || actionLocked.value) {
    return
  }
  clearActionState()
  clearPaymentForm()
  activeDialog.value = 'payment'
}

function openFulfillmentDialog(): void {
  if (!canUpdate.value || nextFulfillmentStatus.value === null || actionLocked.value) {
    return
  }
  clearActionState()
  activeDialog.value = 'fulfillment'
}

function openCancelDialog(): void {
  if (!canUpdate.value || !canCancelPurchaseOrderFromList(props.detail) || actionLocked.value) {
    return
  }
  clearActionState()
  activeDialog.value = 'cancel'
}

function openVoidDialog(payment: PurchaseOrderPaymentDto): void {
  if (!canManagePayment.value || props.detail.orderStatus === 'PENDING_REVIEW' || payment.voidedAt !== null || actionLocked.value) {
    return
  }
  clearActionState()
  selectedPayment.value = payment
  activeDialog.value = 'void'
}

function openDetachDialog(document: PurchaseOrderDocumentDto): void {
  if (!canManageDocument.value || props.detail.orderStatus === 'PENDING_REVIEW' || document.detachedAt !== null || actionLocked.value) {
    return
  }
  clearActionState()
  selectedDocument.value = document
  activeDialog.value = 'detach'
}

function closeActionDialog(): void {
  if (actionLocked.value) {
    return
  }
  activeDialog.value = null
  clearActionState()
  clearPaymentForm()
}

function handleDialogUpdate(dialog: ActionDialog, visible: boolean): void {
  if (visible) {
    activeDialog.value = dialog
  }
  else {
    closeActionDialog()
  }
}

async function runDetailMutation(
  mutation: (detail: PurchaseOrderDetailDto, signal: AbortSignal) => Promise<PurchaseOrderDetailDto>,
  successMessage: string,
): Promise<void> {
  if (actionLocked.value) {
    return
  }
  actionAbortController?.abort()
  const controller = new AbortController()
  actionAbortController = controller
  const currentDetail = props.detail
  submitting.value = true
  actionError.value = ''
  try {
    const updated = await mutation(currentDetail, controller.signal)
    if (!controller.signal.aborted) {
      applyUpdatedDetail(updated, successMessage)
    }
  }
  catch (error) {
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(error)) {
      actionError.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      submitting.value = false
    }
  }
}

function submitFulfillment(): void {
  if (!canUpdate.value) {
    return
  }
  const toStatus = nextFulfillmentStatus.value
  if (toStatus === null) {
    return
  }
  const result = buildPurchaseOrderFulfillmentRequest(
    props.detail,
    toStatus,
    actionReason.value,
  )
  if (!result.valid) {
    actionReasonError.value = result.fieldError
    return
  }
  void runDetailMutation(async (current, signal) => {
    const response = await purchaseOrdersApi.updateFulfillmentStatus(
      current.id,
      result.request,
      signal,
    )
    return response.data
  }, `履约状态已更新为${fulfillmentStatusLabel(toStatus)}`)
}

function submitCancellation(): void {
  if (!canUpdate.value) {
    return
  }
  const result = buildPurchaseOrderCancellationRequest(props.detail, actionReason.value)
  if (!result.valid) {
    actionReasonError.value = result.fieldError
    return
  }
  void runDetailMutation(async (current, signal) => {
    const response = await purchaseOrdersApi.updateOrderStatus(
      current.id,
      result.request,
      signal,
    )
    return response.data
  }, props.detail.purchaseType === 'SALES_LINKED'
    ? '采购订单已取消，关联销售订单采购覆盖状态已重新计算'
    : '采购订单已取消')
}

function submitPaymentVoid(): void {
  if (!canManagePayment.value || props.detail.orderStatus === 'PENDING_REVIEW') {
    return
  }
  const payment = selectedPayment.value
  if (payment === null) {
    return
  }
  const result = buildPurchaseOrderPaymentVoidRequest(actionReason.value)
  if (!result.valid) {
    actionReasonError.value = result.fieldError
    return
  }
  void runDetailMutation(async (current, signal) => {
    const response = await purchaseOrdersApi.voidPayment(
      current.id,
      payment.id,
      result.request,
      signal,
    )
    return response.data
  }, '实际付款已作废')
}

function submitDocumentDetach(): void {
  if (!canManageDocument.value || props.detail.orderStatus === 'PENDING_REVIEW') {
    return
  }
  const document = selectedDocument.value
  if (document === null) {
    return
  }
  void runDetailMutation(async (current, signal) => {
    const response = await purchaseOrdersApi.detachDocument(
      current.id,
      document.id,
      signal,
    )
    return response.data
  }, '付款凭证已解除关联')
}

function openPaymentFilePicker(): void {
  if (canRecordPayment.value && canManageDocument.value && !actionLocked.value) {
    paymentFileInputRef.value?.click()
  }
}

async function handlePaymentFileInput(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined || !canRecordPayment.value || !canManageDocument.value || actionLocked.value) {
    return
  }
  actionAbortController?.abort()
  const controller = new AbortController()
  actionAbortController = controller
  uploading.value = true
  actionError.value = ''
  try {
    const response = await purchaseOrdersApi.uploadTemporaryDocument(
      file,
      file.type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT',
      controller.signal,
    )
    if (controller.signal.aborted) {
      return
    }
    if (paymentVoucher.value?.previewUrl) {
      URL.revokeObjectURL(paymentVoucher.value.previewUrl)
    }
    paymentVoucher.value = {
      ...response.data,
      previewUrl: response.data.mediaType === 'IMAGE' ? URL.createObjectURL(file) : null,
    }
    paymentErrors.value = Object.fromEntries(Object.entries(paymentErrors.value).filter(
      ([field]) => field !== 'voucher',
    ))
  }
  catch (error) {
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(error)) {
      actionError.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      uploading.value = false
    }
  }
}

function removePaymentVoucher(): void {
  if (actionLocked.value) {
    return
  }
  if (paymentVoucher.value?.previewUrl) {
    URL.revokeObjectURL(paymentVoucher.value.previewUrl)
  }
  paymentVoucher.value = null
}

function submitPayment(): void {
  if (!canRecordPayment.value) {
    return
  }
  const result = buildPurchaseOrderPaymentRequest({
    amount: paymentAmount.value,
    mediaAssetId: paymentVoucher.value?.mediaAssetId ?? null,
    now: new Date(),
    outstandingAmount: props.detail.outstandingAmount,
    paidAtLocal: paidAtLocal.value,
    paymentMethod: paymentMethod.value ?? '',
    paymentType: paymentType.value,
    remark: paymentRemark.value,
  })
  if (!result.valid) {
    paymentErrors.value = result.fieldErrors
    actionError.value = '请修正未通过校验的付款信息'
    return
  }
  void runDetailMutation(async (current, signal) => {
    const response = await purchaseOrdersApi.recordPayment(
      current.id,
      result.request,
      signal,
    )
    return response.data
  }, '实际付款记录添加成功')
}

async function downloadDocument(document: PurchaseOrderDocumentDto): Promise<void> {
  if (actionLocked.value) {
    return
  }
  actionAbortController?.abort()
  const controller = new AbortController()
  actionAbortController = controller
  submitting.value = true
  try {
    const response = await purchaseOrdersApi.getDocumentContent(
      props.detail.id,
      document.id,
      controller.signal,
    )
    if (controller.signal.aborted) {
      return
    }
    const url = URL.createObjectURL(response.data)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = document.originalFilename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  catch (error) {
    if (!controller.signal.aborted && !isPurchaseOrderAbortError(error)) {
      emit('failure', getPurchaseOrderApiFailure(error).message)
    }
  }
  finally {
    if (actionAbortController === controller) {
      actionAbortController = null
      submitting.value = false
    }
  }
}

watch(actionLocked, busy => emit('busyChange', busy), { immediate: true })

watch(() => appAccountStore.authEpoch, () => {
  cancelPendingRequests()
  activeDialog.value = null
  clearActionState()
  clearPaymentForm()
})

onBeforeUnmount(() => {
  cancelPendingRequests()
  clearPaymentForm()
})

defineExpose({
  cancelPendingRequests,
  downloadDocument,
  openCancelDialog,
  openDetachDialog,
  openFulfillmentDialog,
  openPaymentDialog,
  openVoidDialog,
})
</script>

<template>
  <QsGenericModal
    :model-value="activeDialog === 'payment'"
    title="记录实际付款"
    :description="`${detail.orderNo} · 未付 ${detail.outstandingAmount} CNY`"
    size="lg"
    :submitting="actionLocked"
    @update:model-value="handleDialogUpdate('payment', $event)"
  >
    <FaAlert v-if="actionError" title="付款信息未保存" :description="actionError" variant="destructive" class="mb-4" />
    <FaForm :model="{ paymentType, paymentAmount, paidAtLocal, paymentMethod, paymentRemark }" :disabled="actionLocked">
      <div class="gap-x-4 gap-y-1 grid sm:grid-cols-2">
        <FaFormItem name="paymentType" label="付款类型" required>
          <FaSelect v-model="paymentType" :options="paymentTypeOptions" class="w-full" />
        </FaFormItem>
        <FaFormItem name="paymentAmount" label="付款金额" required>
          <MoneyInput v-model="paymentAmount" currency="CNY" :currencies="currencies" :currency-selectable="false" min="0.01" />
          <p v-if="paymentErrors.amount" class="text-xs text-destructive m-0 mt-1">
            {{ paymentErrors.amount }}
          </p>
        </FaFormItem>
        <FaFormItem name="paidAtLocal" label="付款时间" required>
          <FaInput v-model="paidAtLocal" type="datetime-local" class="w-full" />
          <p v-if="paymentErrors.paidAt" class="text-xs text-destructive m-0 mt-1">
            {{ paymentErrors.paidAt }}
          </p>
        </FaFormItem>
        <FaFormItem name="paymentMethod" label="付款方式" required>
          <QsDictionarySelect v-model="paymentMethod" dictionary-code="payment.method" placeholder="选择付款方式" />
          <p v-if="paymentErrors.paymentMethod" class="text-xs text-destructive m-0 mt-1">
            {{ paymentErrors.paymentMethod }}
          </p>
        </FaFormItem>
        <FaFormItem name="paymentRemark" label="付款备注" class="sm:col-span-2">
          <FaTextarea v-model="paymentRemark" maxlength="500" input-class="min-h-20" />
          <p v-if="paymentErrors.remark" class="text-xs text-destructive m-0 mt-1">
            {{ paymentErrors.remark }}
          </p>
        </FaFormItem>
      </div>
    </FaForm>
    <section class="mt-3" aria-labelledby="purchase-payment-voucher-title">
      <h3 id="purchase-payment-voucher-title" class="qs-type-section-title m-0">
        付款凭证（可选）
      </h3>
      <p class="qs-type-meta m-0 mt-1">
        不存在凭证也可记录付款；上传凭证需要 purchase-orders:document 权限。
      </p>
      <input ref="paymentFileInputRef" type="file" accept="image/*,.pdf,.doc,.docx" class="sr-only" :disabled="actionLocked" @change="handlePaymentFileInput">
      <FaButton v-if="paymentVoucher === null && canManageDocument" type="button" variant="outline" class="mt-3" :loading="uploading" @click="openPaymentFilePicker">
        <FaIcon name="i-lucide:upload-cloud" aria-hidden="true" />上传付款凭证
      </FaButton>
      <div v-else-if="paymentVoucher" class="mt-3 p-3 border border-border rounded-lg flex gap-3 items-center justify-between">
        <div class="min-w-0">
          <p class="font-medium m-0 truncate">
            {{ paymentVoucher.originalFilename }}
          </p>
          <p class="qs-type-meta m-0 mt-1">
            {{ paymentVoucher.mimeType }} · {{ formatFileSize(paymentVoucher.sizeBytes) }}
          </p>
        </div>
        <FaButton type="button" variant="ghost" size="sm" @click="removePaymentVoucher">
          移除
        </FaButton>
      </div>
    </section>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="actionLocked" @click="closeActionDialog">
        取消
      </FaButton>
      <FaButton type="button" :loading="submitting" :disabled="actionLocked" @click="submitPayment">
        确认付款
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    :model-value="activeDialog === 'fulfillment'"
    title="推进采购履约状态？"
    :description="nextFulfillmentStatus ? `下一状态：${fulfillmentStatusLabel(nextFulfillmentStatus)}` : undefined"
    size="sm"
    :submitting="submitting"
    @update:model-value="handleDialogUpdate('fulfillment', $event)"
  >
    <FaAlert v-if="actionError" title="履约状态未更新" :description="actionError" variant="destructive" class="mb-4" />
    <FaTextarea v-model="actionReason" maxlength="500" placeholder="填写履约说明（可选）" input-class="min-h-24" />
    <p v-if="actionReasonError" class="text-xs text-destructive m-0 mt-1">
      {{ actionReasonError }}
    </p>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="closeActionDialog">
        取消
      </FaButton>
      <FaButton type="button" :loading="submitting" @click="submitFulfillment">
        确认推进
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    :model-value="activeDialog === 'cancel'"
    title="取消采购订单？"
    description="取消后不能继续履约或新增付款；已有有效付款时必须先作废。"
    size="sm"
    :submitting="submitting"
    @update:model-value="handleDialogUpdate('cancel', $event)"
  >
    <FaAlert v-if="actionError" title="采购订单未取消" :description="actionError" variant="destructive" class="mb-4" />
    <FaTextarea v-model="actionReason" maxlength="500" placeholder="填写取消原因（可选）" input-class="min-h-24" />
    <p v-if="actionReasonError" class="text-xs text-destructive m-0 mt-1">
      {{ actionReasonError }}
    </p>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="closeActionDialog">
        返回
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="submitting" @click="submitCancellation">
        确认取消
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    :model-value="activeDialog === 'void'"
    title="作废实际付款？"
    :description="selectedPayment ? `${purchaseOrderPaymentTypeLabel(selectedPayment.paymentType)} · ${selectedPayment.amount} CNY` : undefined"
    size="sm"
    :submitting="submitting"
    @update:model-value="handleDialogUpdate('void', $event)"
  >
    <FaAlert v-if="actionError" title="实际付款未作废" :description="actionError" variant="destructive" class="mb-4" />
    <FaTextarea v-model="actionReason" maxlength="500" placeholder="填写作废原因" input-class="min-h-24" />
    <p v-if="actionReasonError" class="text-xs text-destructive m-0 mt-1">
      {{ actionReasonError }}
    </p>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="closeActionDialog">
        返回
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="submitting" @click="submitPaymentVoid">
        确认作废
      </FaButton>
    </template>
  </QsGenericModal>

  <QsGenericModal
    :model-value="activeDialog === 'detach'"
    title="解除付款凭证关联？"
    :description="selectedDocument?.originalFilename"
    size="sm"
    :submitting="submitting"
    @update:model-value="handleDialogUpdate('detach', $event)"
  >
    <FaAlert v-if="actionError" title="凭证关联未解除" :description="actionError" variant="destructive" class="mb-4" />
    <p class="text-sm text-muted-foreground m-0">
      凭证记录会保留解除时间和操作人，不会物理删除历史。
    </p>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="closeActionDialog">
        返回
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="submitting" @click="submitDocumentDetach">
        确认解除
      </FaButton>
    </template>
  </QsGenericModal>
</template>
