<script setup lang="ts">
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderDocumentDto,
  PurchaseOrderPaymentDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildPurchaseOrderCancellationRequest,
  buildPurchaseOrderFulfillmentRequest,
  buildPurchaseOrderPaymentVoidRequest,
  purchaseOrderPaymentTypeLabel,
} from './purchase-order-detail.logic'

import {
  canCancelPurchaseOrderFromList,
  fulfillmentStatusLabel,
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
  nextPurchaseOrderFulfillmentStatus,
} from './purchase-order-list.logic'
import PurchaseWarehouseReceiptAction from './purchase-warehouse-receipt-action.vue'

type ActionDialog = 'cancel' | 'detach' | 'fulfillment' | 'void'

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
const warehouseActionRef = useTemplateRef<InstanceType<typeof PurchaseWarehouseReceiptAction>>('warehouseActionRef')
const warehouseBusy = ref(false)
const submitting = ref(false)
const actionError = ref('')
const activeDialog = ref<ActionDialog | null>(null)
const actionReason = ref('')
const actionReasonError = ref('')
const selectedPayment = shallowRef<PurchaseOrderPaymentDto | null>(null)
const selectedDocument = shallowRef<PurchaseOrderDocumentDto | null>(null)
let actionAbortController: AbortController | null = null

const canUpdate = computed(() => auth('purchase-orders:update'))
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const canManageDocument = computed(() => auth('purchase-orders:document'))
const actionLocked = computed(() => submitting.value || warehouseBusy.value)
const nextFulfillmentStatus = computed(() => nextPurchaseOrderFulfillmentStatus(props.detail))

function clearActionState(): void {
  actionError.value = ''
  actionReason.value = ''
  actionReasonError.value = ''
  selectedPayment.value = null
  selectedDocument.value = null
}

function cancelPendingRequests(): void {
  warehouseActionRef.value?.reset()
  warehouseBusy.value = false
  actionAbortController?.abort()
  actionAbortController = null
  submitting.value = false
}

function applyUpdatedDetail(updated: PurchaseOrderDetailDto, message: string): void {
  emit('detailUpdated', updated)
  activeDialog.value = null
  clearActionState()
  toast.success(message)
}

function openWarehouseDialog(): void {
  if (canUpdate.value && !actionLocked.value) {
    clearActionState()
    void warehouseActionRef.value?.open(props.detail.id)
  }
}

function openFulfillmentDialog(): void {
  if (nextFulfillmentStatus.value === 'SIGNED') {
    openWarehouseDialog()
    return
  }
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
  if (toStatus === 'SIGNED') {
    activeDialog.value = null
    openWarehouseDialog()
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
})

onBeforeUnmount(() => {
  cancelPendingRequests()
})

defineExpose({
  cancelPendingRequests,
  downloadDocument,
  openCancelDialog,
  openDetachDialog,
  openFulfillmentDialog,
  openWarehouseDialog,
  openVoidDialog,
})
</script>

<template>
  <PurchaseWarehouseReceiptAction ref="warehouseActionRef" :active="canUpdate" @busy-change="warehouseBusy = $event" @detail-updated="emit('detailUpdated', $event)" />
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
