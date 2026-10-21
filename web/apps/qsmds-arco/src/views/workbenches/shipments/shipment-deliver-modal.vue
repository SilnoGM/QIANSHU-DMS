<script setup lang="ts">
import type { PurchaseShipmentDeliverResultDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import purchaseShipmentsApi from '@/api/modules/purchase-shipments'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getPurchaseOrderApiFailure } from '@/views/operations/purchase-orders/purchase-order-list.logic'
import { formatShipmentNumber } from './logic'

defineOptions({ name: 'ShipmentDeliverModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  shipment: PurchaseShipmentListItemDto | null
  active?: boolean
}>(), { active: true })

const emit = defineEmits<{
  'delivered': [result: PurchaseShipmentDeliverResultDto]
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useQsToast()
const remark = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const shipmentLabel = computed(() => props.shipment === null
  ? ''
  : `${props.shipment.shipmentNo || t('purchaseShipments.unnumbered')} · ${formatShipmentNumber(props.shipment.partNumber)}`)

watch(() => props.modelValue, (value) => {
  if (value) {
    remark.value = ''
    error.value = null
  }
})

onBeforeUnmount(() => {
  controller?.abort()
})

function close(): void {
  controller?.abort()
  emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (!props.active || props.shipment === null || submitting.value) {
    return
  }
  const request = new AbortController()
  controller = request
  submitting.value = true
  error.value = null
  let completed = false
  try {
    const response = await purchaseShipmentsApi.deliver(
      props.shipment.id,
      { remark: remark.value.trim() || null },
      request.signal,
    )
    if (request.signal.aborted) {
      return
    }
    const result = response.data
    if (result.salesOrderSigned) {
      toast.success(t('purchaseShipments.deliverSigned'))
    }
    else if (result.salesOrderReceiptRequired) {
      toast.warning(t('purchaseShipments.deliverReceiptRequired'))
    }
    else if (result.remainingShipmentCount > 0) {
      toast.success(t('purchaseShipments.deliverRemaining', { count: result.remainingShipmentCount }))
    }
    else {
      toast.success(t('purchaseShipments.deliverSuccess'))
    }
    emit('delivered', result)
    completed = true
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
    }
    submitting.value = false
  }
  if (completed) {
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    v-model="open" :title="t('purchaseShipments.deliverTitle')" :description="shipmentLabel"
    :error="error" :submitting="submitting" size="md"
  >
    <div class="flex flex-col gap-4">
      <FaAlert
        icon="i-lucide:triangle-alert"
        :title="t('purchaseShipments.deliverWarningTitle')"
        :description="t('purchaseShipments.deliverWarningDescription')"
        class="border-primary/30 bg-primary/5"
      />
      <div v-if="shipment" class="p-3 border border-border rounded-lg flex flex-col gap-1 min-w-0">
        <span class="qs-type-data-emphasis [overflow-wrap:anywhere]">{{ shipment.shipmentNo || t('purchaseShipments.unnumbered') }}</span>
        <span class="qs-type-meta">{{ shipment.purchaseOrder.orderNo }} · {{ formatShipmentNumber(shipment.partNumber) }}</span>
        <span v-if="shipment.salesSource" class="qs-type-meta [overflow-wrap:anywhere]">{{ shipment.salesSource.orderNo }} · {{ shipment.salesSource.customerName }}</span>
      </div>
      <FaForm :model="{ deliveryRemark: remark }" :disabled="submitting">
        <FaFormItem name="deliveryRemark" :label="t('purchaseShipments.deliverRemark')" :auto-bind="false">
          <FaTextarea
            v-model="remark" :maxlength="500" :disabled="submitting" rows="3"
            :placeholder="t('purchaseShipments.deliverRemarkPlaceholder')"
          />
        </FaFormItem>
      </FaForm>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="submitting" @click="close">
        {{ t('purchaseShipments.cancel') }}
      </FaButton>
      <FaButton :loading="submitting" :disabled="!active || shipment === null" @click="submit">
        {{ t('purchaseShipments.deliverConfirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
