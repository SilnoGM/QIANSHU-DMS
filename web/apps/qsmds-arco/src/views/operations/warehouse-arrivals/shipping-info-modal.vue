<script setup lang="ts">
import type { ShipmentShippingInfo } from './shipping-info.logic'
import type { PurchaseShipmentListItemDto, SalesOrderDetailDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildShipmentShippingInfo, canCopyShipmentShippingInfo, copyShipmentShippingInfo, shippingInfoFields } from './shipping-info.logic'

const props = defineProps<{
  shipment: PurchaseShipmentListItemDto | null
  salesOrder: SalesOrderDetailDto | null
  loading: boolean
  error: string | null
}>()
const emit = defineEmits<{ retry: [] }>()
const visible = defineModel<boolean>({ required: true })
const { t } = useI18n()
const toast = useQsToast()
const copying = ref(false)
const freightBearer = computed(() => t('warehouseArrivals.shippingInfoFreightBearer'))
const info = computed<ShipmentShippingInfo | null>(() => props.shipment === null
  ? null
  : buildShipmentShippingInfo(props.shipment, props.salesOrder, freightBearer.value))
const fields = computed(() => info.value === null ? [] : shippingInfoFields(info.value, t))
const missingSalesSource = computed(() => !props.loading && !props.error && props.shipment !== null && props.shipment.salesSource === null)
// 资料未齐时不允许复制：半份资料发到顺联航群比复制失败更难发现。
const copyDisabled = computed(() => !canCopyShipmentShippingInfo({ info: info.value, loading: props.loading, error: props.error }))

async function copy(): Promise<void> {
  const value = info.value
  if (value === null || copying.value) {
    return
  }
  copying.value = true
  try {
    // 复制成功才提示成功；剪贴板不可用或用户拒绝都按失败反馈，不谎报已复制。
    if (await copyShipmentShippingInfo(value, t, navigator.clipboard)) {
      toast.success(t('warehouseArrivals.shippingInfoCopied'))
    }
    else {
      toast.error(t('warehouseArrivals.shippingInfoCopyFailed'))
    }
  }
  finally {
    copying.value = false
  }
}
function reportBalanceWrong(): void {
  // TODO(后续接入)：尾款有误暂时只做轻提示，确认口径后接入尾款或代收款的修改流程。
  toast.info(t('warehouseArrivals.shippingInfoBalanceWrongUnavailable'))
}
</script>

<template>
  <QsGenericModal v-model="visible" :title="t('warehouseArrivals.shippingInfo')" size="md" :loading="loading" :error="error">
    <template #header-leading>
      <FaIcon name="i-lucide:clipboard-list" class="size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />{{ t('purchaseShipments.retry') }}
      </FaButton>
    </template>
    <div v-if="info" class="space-y-4">
      <dl class="m-0">
        <div v-for="(field, index) in fields" :key="field.key" class="min-w-0" :class="index > 0 && (field.groupStart ? 'mt-4 pt-4 border-t border-border' : 'mt-3')">
          <dt class="qs-type-meta text-muted-foreground">
            {{ field.label }}
          </dt>
          <dd class="m-0 mt-1 whitespace-pre-wrap break-words" :class="[field.key === 'shippingMark' ? 'qs-type-data' : 'qs-type-body', !field.value && 'text-muted-foreground']">
            {{ field.value || '—' }}
          </dd>
        </div>
      </dl>
      <p v-if="missingSalesSource" class="qs-type-meta text-muted-foreground m-0">
        {{ t('warehouseArrivals.shippingInfoNoSalesSource') }}
      </p>
    </div>
    <template #footer>
      <FaButton type="button" variant="destructive" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="reportBalanceWrong">
        {{ t('warehouseArrivals.shippingInfoBalanceWrong') }}
      </FaButton>
      <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="copying" :disabled="copyDisabled" @click="copy">
        <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />{{ t('warehouseArrivals.shippingInfoCopy') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
