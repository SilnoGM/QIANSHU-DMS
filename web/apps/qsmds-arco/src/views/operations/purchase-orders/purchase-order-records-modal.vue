<script setup lang="ts">
import type { PurchaseOrderRecordsKind } from './purchase-order-records-modal.logic'
import type { PurchaseOrderDetailDto, PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import PurchaseOrderChangeRecords from './purchase-order-change-records.vue'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'
import PurchaseOrderRecordList from './purchase-order-record-list.vue'
import { PURCHASE_ORDER_RECORD_ICONS } from './purchase-order-records-modal.logic'

const props = defineProps<{
  modelValue: boolean
  kind: PurchaseOrderRecordsKind
  order: PurchaseOrderListItemDto | null
  currencies: readonly CurrencyDescriptor[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'detailLoaded': [detail: PurchaseOrderDetailDto]
}>()
const { t } = useI18n()
const appAccountStore = useAppAccountStore()
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
let requestVersion = 0
let detailAbortController: AbortController | null = null
const modalVisible = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const description = computed(() => props.order ? `${props.order.orderNo} · ${props.order.supplier.label}` : '')

function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

/** 只在打开时读取详情；重试、换单、关闭和身份变化都会使旧响应失效。 */
async function loadDetail(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }
  cancelDetailRequest()
  const version = requestVersion
  const authEpoch = appAccountStore.authEpoch
  const controller = new AbortController()
  detailAbortController = controller
  loading.value = true
  detail.value = null
  errorMessage.value = null
  const stale = () => controller.signal.aborted || version !== requestVersion
    || authEpoch !== appAccountStore.authEpoch || props.order?.id !== orderId || !props.modelValue
  try {
    const response = await purchaseOrdersApi.getById(orderId, controller.signal)
    if (stale()) {
      return
    }
    detail.value = response.data
    emit('detailLoaded', response.data)
  }
  catch (error) {
    if (!stale() && !isPurchaseOrderAbortError(error)) {
      errorMessage.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      detailAbortController = null
    }
  }
}

watch(() => [props.modelValue, props.order?.id, props.kind] as const, ([visible, orderId]) => {
  cancelDetailRequest()
  detail.value = null
  errorMessage.value = null
  loading.value = false
  if (visible && orderId !== undefined) {
    void loadDetail()
  }
}, { immediate: true })
watch(() => appAccountStore.authEpoch, () => {
  cancelDetailRequest()
  detail.value = null
  modalVisible.value = false
})
onBeforeUnmount(cancelDetailRequest)
</script>

<template>
  <QsGenericModal v-model="modalVisible" :title="t(`purchaseOrderList.records.${kind}`)" :description="description" :loading="loading" :error="errorMessage" size="xl">
    <template #header-leading>
      <FaIcon :name="PURCHASE_ORDER_RECORD_ICONS[kind]" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadDetail">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchaseOrderDrawer.reload') }}
      </FaButton>
    </template>
    <template v-if="detail">
      <PurchaseOrderChangeRecords v-if="kind === 'changes'" :key="detail.id" :detail="detail" :currencies="currencies" />
      <PurchaseOrderRecordList v-else :detail="detail" :kind="kind" :currencies="currencies" />
    </template>
  </QsGenericModal>
</template>
