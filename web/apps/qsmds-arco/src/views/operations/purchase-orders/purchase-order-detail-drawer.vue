<script setup lang="ts">
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import PurchaseOrderDetailActions from './purchase-order-detail-actions.vue'
import PurchaseOrderDocumentModal from './purchase-order-document-modal.vue'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

defineOptions({ name: 'PurchaseOrderDetailDrawer' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  order: PurchaseOrderListItemDto | null
}>()

const emit = defineEmits<{
  'detailUpdated': [detail: PurchaseOrderDetailDto]
  'update:modelValue': [value: boolean]
}>()

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const actionError = ref('')
const actionLocked = ref(false)
const documentModalVisible = ref(false)
const detailActionsRef = useTemplateRef<InstanceType<typeof PurchaseOrderDetailActions>>('detailActionsRef')
let requestVersion = 0
let detailAbortController: AbortController | null = null

const drawerVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const canAttachDocument = computed(() => auth('purchase-orders:document') && detail.value !== null && detail.value.orderStatus !== 'PENDING_REVIEW')
function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

function applyUpdatedDetail(updated: PurchaseOrderDetailDto): void {
  detail.value = updated
  emit('detailUpdated', updated)
}

/** 每次打开都读取详情，避免列表摘要在其他用户操作后成为写入依据。 */
async function loadDetail(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }
  cancelDetailRequest()
  const version = requestVersion
  const controller = new AbortController()
  detailAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  loadError.value = null
  detail.value = null
  try {
    const response = await purchaseOrdersApi.getById(orderId, controller.signal)
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || props.order?.id !== orderId
      || !props.modelValue
    ) {
      return
    }
    detail.value = response.data
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    loadError.value = getPurchaseOrderApiFailure(error).message
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      if (detailAbortController === controller) {
        detailAbortController = null
      }
    }
  }
}

function openPaymentDialog(): void {
  actionError.value = ''
  detailActionsRef.value?.openPaymentDialog()
}

watch(
  () => [props.modelValue, props.order?.id] as const,
  ([visible, orderId]) => {
    documentModalVisible.value = false
    if (!visible || orderId === undefined) {
      cancelDetailRequest()
      detailActionsRef.value?.cancelPendingRequests()
      detail.value = null
      loadError.value = null
      loading.value = false
      actionError.value = ''
      actionLocked.value = false
      return
    }
    actionError.value = ''
    void loadDetail()
  },
  { immediate: true },
)

watch(() => appAccountStore.authEpoch, () => {
  cancelDetailRequest()
  detailActionsRef.value?.cancelPendingRequests()
  drawerVisible.value = false
})

onBeforeUnmount(() => {
  cancelDetailRequest()
  detailActionsRef.value?.cancelPendingRequests()
})
</script>

<template>
  <QsPurchaseOrderDrawer
    v-model="drawerVisible"
    :order="order"
    :detail="detail"
    :currencies="currencies"
    :loading="loading"
    :error="loadError"
    :action-error="actionError"
    :busy="actionLocked"
    :can-manage-payment="canManagePayment"
    :can-attach-document="canAttachDocument"
    @reload="loadDetail"
    @record-payment="openPaymentDialog"
    @attach-document="documentModalVisible = canAttachDocument && !actionLocked"
  />

  <PurchaseOrderDetailActions
    v-if="detail"
    ref="detailActionsRef"
    :detail="detail"
    :currencies="currencies"
    @busy-change="actionLocked = $event"
    @detail-updated="applyUpdatedDetail"
    @failure="actionError = $event"
  />
  <PurchaseOrderDocumentModal
    v-if="detail && documentModalVisible" :key="detail.id" v-model="documentModalVisible" :detail="detail"
    @busy-change="actionLocked = $event" @detail-updated="applyUpdatedDetail"
  />
</template>
