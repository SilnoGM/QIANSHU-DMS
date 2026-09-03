<script setup lang="ts">
import type {
  PurchaseOrderDetailDto,
  PurchaseOrderDocumentDto,
  PurchaseOrderListItemDto,
  PurchaseOrderPaymentDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPurchaseOrderDesc from '@/components/business/QsPurchaseOrderDesc/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import { mapPurchaseOrderDetailToDesc } from './purchase-order-desc.logic'
import PurchaseOrderDetailActions from './purchase-order-detail-actions.vue'
import {
  purchaseOrderPaymentTypeLabel,
  purchaseOrderStatusDimensionLabel,
  purchaseOrderStatusHistoryValueLabel,
} from './purchase-order-detail.logic'
import {
  fulfillmentStatusLabel,
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
  nextPurchaseOrderFulfillmentStatus,
  purchaseTypeLabel,
} from './purchase-order-list.logic'

export type PurchaseOrderDetailInitialAction = 'detail' | 'fulfillment' | 'payment' | 'cancel'

defineOptions({ name: 'PurchaseOrderDetailDrawer' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  initialAction: PurchaseOrderDetailInitialAction
  modelValue: boolean
  order: PurchaseOrderListItemDto | null
}>()

const emit = defineEmits<{
  'detailUpdated': [detail: PurchaseOrderDetailDto]
  'update:modelValue': [value: boolean]
}>()

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const paymentMethodCatalog = useDictionaryCatalog('payment.method')
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const actionError = ref('')
const actionLocked = ref(false)
const detailActionsRef = useTemplateRef<InstanceType<typeof PurchaseOrderDetailActions>>('detailActionsRef')
let requestVersion = 0
let detailAbortController: AbortController | null = null

const drawerVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const canUpdate = computed(() => auth('purchase-orders:update'))
const canManagePayment = computed(() => auth('purchase-orders:payment'))
const canManageDocument = computed(() => auth('purchase-orders:document'))
const nextFulfillmentStatus = computed(() => detail.value === null
  ? null
  : nextPurchaseOrderFulfillmentStatus(detail.value))
const drawerTitle = computed(() => props.order?.orderNo ?? '采购订单详情')
const drawerDescription = computed(() => props.order === null
  ? '查看采购订单、履约、付款和凭证。'
  : `${props.order.supplier.label} · ${purchaseTypeLabel(props.order.purchaseType)}`)
const purchaseOrderDescModel = computed(() => detail.value === null
  ? null
  : mapPurchaseOrderDetailToDesc(detail.value))
const canRecordPayment = computed(() => (
  canManagePayment.value
  && detail.value?.orderStatus === 'CONFIRMED'
  && detail.value.paymentStatus !== 'PAID'
))
const canCancelOrder = computed(() => (
  canUpdate.value && detail.value?.orderStatus === 'CONFIRMED'
))

function optionalText(value: string | null): string {
  return value?.trim() || '—'
}

function paymentMethodLabel(value: string): string {
  return paymentMethodCatalog.resolve(value)?.label ?? value
}

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

function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

function applyUpdatedDetail(updated: PurchaseOrderDetailDto): void {
  detail.value = updated
  emit('detailUpdated', updated)
}

function openInitialAction(): void {
  if (props.initialAction === 'fulfillment' && canUpdate.value && nextFulfillmentStatus.value) {
    detailActionsRef.value?.openFulfillmentDialog()
  }
  else if (props.initialAction === 'payment' && canRecordPayment.value) {
    detailActionsRef.value?.openPaymentDialog()
  }
  else if (props.initialAction === 'cancel' && canCancelOrder.value) {
    detailActionsRef.value?.openCancelDialog()
  }
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
    nextTick(openInitialAction)
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

function openFulfillmentDialog(): void {
  actionError.value = ''
  detailActionsRef.value?.openFulfillmentDialog()
}

function openCancelDialog(): void {
  actionError.value = ''
  detailActionsRef.value?.openCancelDialog()
}

function openVoidDialog(payment: PurchaseOrderPaymentDto): void {
  actionError.value = ''
  detailActionsRef.value?.openVoidDialog(payment)
}

function openDetachDialog(document: PurchaseOrderDocumentDto): void {
  actionError.value = ''
  detailActionsRef.value?.openDetachDialog(document)
}

function downloadDocument(document: PurchaseOrderDocumentDto): void {
  actionError.value = ''
  void detailActionsRef.value?.downloadDocument(document)
}

watch(
  () => [props.modelValue, props.order?.id, props.initialAction] as const,
  ([visible, orderId]) => {
    if (!visible || orderId === undefined) {
      cancelDetailRequest()
      detailActionsRef.value?.cancelPendingRequests()
      detail.value = null
      loadError.value = null
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
  <QsGenericDrawer
    v-model="drawerVisible"
    :title="drawerTitle"
    :description="drawerDescription"
    :loading="loading"
    :error="loadError"
    :submitting="actionLocked"
    size="xl"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:shopping-cart" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadDetail">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />重新加载
      </FaButton>
    </template>

    <FaAlert
      v-if="actionError"
      title="采购订单操作失败"
      :description="actionError"
      variant="destructive"
      class="mb-4"
    />

    <div v-if="detail && purchaseOrderDescModel" class="gap-6 grid">
      <QsPurchaseOrderDesc
        :model="purchaseOrderDescModel"
        :currencies="currencies"
      />

      <section aria-labelledby="purchase-detail-payments-title">
        <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
          <h3 id="purchase-detail-payments-title" class="qs-type-section-title m-0">
            实际付款
          </h3>
          <FaButton v-if="canRecordPayment" type="button" size="sm" @click="openPaymentDialog">
            <FaIcon name="i-lucide:circle-plus" aria-hidden="true" />记录付款
          </FaButton>
        </div>
        <FaEmpty v-if="detail.payments.length === 0" title="暂无实际付款" description="不存在凭证也可记录付款。" class="py-8" />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li v-for="payment in detail.payments" :key="payment.id" class="py-4 flex gap-4 items-start justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <strong>{{ purchaseOrderPaymentTypeLabel(payment.paymentType) }}</strong>
                <FaTag variant="outline" :class="payment.voidedAt === null ? 'text-primary' : 'text-destructive'">
                  {{ payment.voidedAt === null ? '有效' : '已作废' }}
                </FaTag>
                <AmountDisplay :value="payment.amount" currency="CNY" :currencies="currencies" />
              </div>
              <p class="qs-type-meta m-0 mt-2">
                付款时间：<DateTimeDisplay :value="payment.paidAt" /> · {{ paymentMethodLabel(payment.paymentMethod) }}
              </p>
              <p class="text-sm m-0 mt-2 break-words">
                {{ optionalText(payment.remark) }}
              </p>
              <p v-if="payment.voidedAt" class="text-sm text-destructive m-0 mt-2">
                作废原因：{{ payment.voidReason }}
              </p>
            </div>
            <FaButton v-if="canManagePayment && payment.voidedAt === null" type="button" variant="ghost" size="sm" @click="openVoidDialog(payment)">
              作废
            </FaButton>
          </li>
        </ul>
      </section>

      <section aria-labelledby="purchase-detail-documents-title">
        <h3 id="purchase-detail-documents-title" class="qs-type-section-title m-0 mb-3">
          付款凭证
        </h3>
        <FaEmpty v-if="detail.documents.length === 0" title="暂无付款凭证" description="付款凭证为可选项。" class="py-8" />
        <ul v-else class="m-0 p-0 list-none gap-3 grid">
          <li v-for="document in detail.documents" :key="document.id" class="p-3 border border-border rounded-lg flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <p class="font-medium m-0 flex gap-2 truncate items-center">
                <span class="truncate">{{ document.originalFilename }}</span>
                <FaTag v-if="document.detachedAt" variant="outline" class="text-muted-foreground shrink-0">
                  已解除
                </FaTag>
              </p>
              <p class="qs-type-meta m-0 mt-1">
                {{ document.mimeType ?? '未知类型' }} · {{ formatFileSize(document.sizeBytes) }} · <DateTimeDisplay :value="document.createdAt" />
              </p>
              <p v-if="document.detachedAt" class="qs-type-meta m-0 mt-1">
                解除时间：<DateTimeDisplay :value="document.detachedAt" />
              </p>
            </div>
            <div class="flex gap-2">
              <FaButton v-if="document.detachedAt === null" type="button" variant="outline" size="sm" @click="downloadDocument(document)">
                下载
              </FaButton>
              <FaButton v-if="canManageDocument && document.detachedAt === null" type="button" variant="ghost" size="sm" @click="openDetachDialog(document)">
                解除关联
              </FaButton>
            </div>
          </li>
        </ul>
      </section>

      <section aria-labelledby="purchase-detail-history-title">
        <h3 id="purchase-detail-history-title" class="qs-type-section-title m-0 mb-3">
          状态历史
        </h3>
        <FaEmpty v-if="detail.statusHistory.length === 0" title="暂无状态变更" class="py-8" />
        <ol v-else class="m-0 ml-2 p-0 list-none border-l border-border">
          <li v-for="history in detail.statusHistory" :key="history.id" class="pb-5 pl-5 relative last:pb-0">
            <span class="rounded-full bg-primary size-3 top-1 absolute -left-1.5" aria-hidden="true" />
            <p class="font-medium m-0">
              {{ purchaseOrderStatusDimensionLabel(history.dimension) }}：{{ purchaseOrderStatusHistoryValueLabel(history.fromStatus) }} → {{ purchaseOrderStatusHistoryValueLabel(history.toStatus) }}
            </p>
            <p class="qs-type-meta m-0 mt-1">
              <DateTimeDisplay :value="history.changedAt" /> · {{ history.changedBy.displayName }}
            </p>
            <p v-if="history.reason" class="text-sm m-0 mt-2 break-words">
              {{ history.reason }}
            </p>
          </li>
        </ol>
      </section>
    </div>

    <template #footer>
      <template v-if="detail">
        <FaButton v-if="canCancelOrder" type="button" variant="destructive" :disabled="actionLocked" @click="openCancelDialog">
          取消订单
        </FaButton>
        <FaButton v-if="canUpdate && nextFulfillmentStatus" type="button" variant="outline" :disabled="actionLocked" @click="openFulfillmentDialog">
          推进至{{ fulfillmentStatusLabel(nextFulfillmentStatus) }}
        </FaButton>
        <FaButton v-if="canRecordPayment" type="button" :disabled="actionLocked" @click="openPaymentDialog">
          记录付款
        </FaButton>
      </template>
    </template>
  </QsGenericDrawer>

  <PurchaseOrderDetailActions
    v-if="detail"
    ref="detailActionsRef"
    :detail="detail"
    :currencies="currencies"
    @busy-change="actionLocked = $event"
    @detail-updated="applyUpdatedDetail"
    @failure="actionError = $event"
  />
</template>
