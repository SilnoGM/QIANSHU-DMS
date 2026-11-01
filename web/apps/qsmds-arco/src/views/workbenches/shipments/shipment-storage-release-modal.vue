<script setup lang="ts">
import type { PurchaseShipmentDetailDto } from '@/api/generated/types.gen'
import { getApiClientFailureMessage } from '@/api/errors'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

defineOptions({ name: 'ShipmentStorageReleaseModal' })

const props = defineProps<{
  modelValue: boolean
  shipment: PurchaseShipmentDetailDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'released': []
}>()

const toast = useQsToast()
const overseasCatalog = useDictionaryCatalog('overseas.warehouse')
const reason = ref<'CUSTOMER_CANCEL' | 'CUSTOMER_REJECT' | 'OTHER'>('CUSTOMER_CANCEL')
const overseasWarehouse = ref('')
const note = ref('')
const submitting = ref(false)
// 同内容重试复用请求键：释放已提交但后续重算失败时，后端依赖同一键幂等重放并重试重算。
const pendingSubmission = ref<{ key: string, signature: string } | null>(null)

const loaded = computed(() => props.shipment?.loadedAt != null)
const mainlandLabel = computed(() => props.shipment?.destinationWarehouse?.label
  ?? props.shipment?.destinationWarehouseValue
  ?? '未记录')
const overseasOptions = computed(() => overseasCatalog.selectableItems.value.map(item => ({
  value: item.value,
  label: item.label,
})))

watch(() => props.modelValue, (open) => {
  if (open) {
    reason.value = 'CUSTOMER_CANCEL'
    overseasWarehouse.value = ''
    note.value = ''
    pendingSubmission.value = null
  }
})

async function submit(): Promise<void> {
  const shipment = props.shipment
  if (shipment === null) {
    return
  }
  if (loaded.value && overseasWarehouse.value === '') {
    toast.warning('请选择海外仓库')
    return
  }
  submitting.value = true
  const request = new AbortController()
  const payload = {
    shipmentIds: [shipment.id],
    locationScope: loaded.value ? 'OVERSEAS' as const : 'MAINLAND' as const,
    ...(loaded.value ? { overseasWarehouseValue: overseasWarehouse.value } : {}),
    reason: reason.value,
    note: note.value.trim() || undefined,
  }
  const signature = JSON.stringify(payload)
  const requestKey = pendingSubmission.value?.signature === signature
    ? pendingSubmission.value.key
    : crypto.randomUUID()
  pendingSubmission.value = { key: requestKey, signature }
  try {
    await shipmentStorageApi.release({ ...payload, requestKey }, request.signal)
    pendingSubmission.value = null
    toast.success('货件已释放进寄仓池')
    emit('released')
  }
  catch (failure) {
    toast.error(getApiClientFailureMessage(failure, '释放失败'))
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <FaModal
    :model-value="modelValue"
    title="释放货件进寄仓"
    size="md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="p-3 border border-border rounded-lg">
        <p class="qs-type-meta text-muted-foreground m-0">
          货件
        </p>
        <p class="mb-0 mt-1">
          {{ shipment?.shipmentNo ?? '—' }} · {{ shipment?.shippingMarkText ?? '无唛头' }}
        </p>
      </div>

      <div v-if="loaded">
        <label class="flex flex-col gap-1">
          <span class="text-sm">海外仓库</span>
          <FaSelect v-model="overseasWarehouse" :options="overseasOptions" placeholder="选择瑞锋台中仓或林口仓" />
        </label>
        <p class="qs-type-meta text-muted-foreground mb-0 mt-1">
          已装柜货件按海外仓处理；未到港也允许选择。
        </p>
      </div>
      <div v-else class="p-3 border border-border rounded-lg">
        <p class="qs-type-meta text-muted-foreground m-0">
          内地仓库
        </p>
        <p class="mb-0 mt-1">
          {{ mainlandLabel }}
        </p>
        <p class="qs-type-meta text-muted-foreground mb-0 mt-1">
          内地寄仓位置固定为原目的地仓库。
        </p>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-sm">原因</span>
        <FaSelect
          v-model="reason"
          :options="[
            { value: 'CUSTOMER_CANCEL', label: '客户取消' },
            { value: 'CUSTOMER_REJECT', label: '客户拒收' },
            { value: 'OTHER', label: '其他' },
          ]"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm">备注</span>
        <FaInput v-model="note" maxlength="500" placeholder="可空" />
      </label>
    </div>

    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="submitting" @click="emit('update:modelValue', false)">
          取消
        </FaButton>
        <FaButton :loading="submitting" @click="submit">
          确认释放
        </FaButton>
      </div>
    </template>
  </FaModal>
</template>
