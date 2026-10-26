<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderWarehouseReceiptRequestDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'
import { currentDateTimeValue } from '@/components/business/QsDateTimeField/logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { getPurchaseOrderPartRecords } from '@/components/business/QsPurchaseOrderDrawer/logic'
import { buildWarehouseReceiptRequest, eligibleWarehouseParts } from './logic'

const props = defineProps<{
  modelValue: boolean
  detail: PurchaseOrderDetailDto | null
  scopeIds?: readonly string[]
  loading: boolean
  submitting: boolean
  error: string | null
  needsReload: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'reload': []
  'submit': [request: PurchaseOrderWarehouseReceiptRequestDto]
}>()
const { t } = useI18n()
const selectedIds = ref<string[]>([])
const receivedAt = ref('')
const remark = ref('')
const validationError = ref('')
const parts = computed(() => {
  if (!props.detail) {
    return []
  }
  const ids = new Set(eligibleWarehouseParts(props.detail, props.scopeIds).map(part => part.id))
  return getPurchaseOrderPartRecords(props.detail).filter(part => ids.has(part.id))
})
const minimumShippedAt = computed(() => {
  if (!props.detail) {
    return undefined
  }
  const selected = eligibleWarehouseParts(props.detail, props.scopeIds)
    .filter(part => selectedIds.value.includes(part.id))
  const shippedAtValues = selected
    .map(part => part.shippedAt)
    .filter((value): value is string => value !== null)
  return shippedAtValues.reduce<string | undefined>(
    (minimum, value) => minimum === undefined || Date.parse(value) < Date.parse(minimum)
      ? value
      : minimum,
    undefined,
  )
})
const locked = computed(() => props.loading || props.submitting || props.needsReload || !!props.error)
function toggle(id: string): void {
  if (!locked.value) {
    selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id]
    validationError.value = ''
  }
}
function submit(): void {
  if (locked.value || !props.detail) {
    return
  }
  const result = buildWarehouseReceiptRequest({ detail: props.detail, scopeIds: props.scopeIds, selectedIds: selectedIds.value, receivedAt: receivedAt.value, remark: remark.value, now: new Date() })
  if (!result.valid) {
    validationError.value = t(result.error)
    return
  }
  validationError.value = ''
  emit('submit', result.request)
}
watch(() => [props.modelValue, props.detail] as const, ([open]) => {
  if (open) {
    selectedIds.value = parts.value.length === 1 ? [parts.value[0]!.id] : []
    receivedAt.value = currentDateTimeValue('second')
    remark.value = ''
    validationError.value = ''
  }
}, { immediate: true })
</script>

<template>
  <QsGenericModal :model-value="modelValue" :title="t('purchaseWarehouseReceipt.title')" :description="t('purchaseWarehouseReceipt.description')" size="xl" :loading="loading" :error="error" :submitting="submitting" @update:model-value="emit('update:modelValue', $event)">
    <template #header-leading>
      <FaIcon name="i-lucide:warehouse" class="size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" size="sm" :disabled="submitting" @click="emit('reload')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" />{{ t('purchaseWarehouseReceipt.reload') }}
      </FaButton>
    </template>
    <div v-if="detail" class="space-y-4">
      <div class="p-3 border border-border rounded-lg bg-muted/20 flex flex-wrap gap-3 items-center justify-between">
        <div class="flex gap-2 min-w-0 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('purchaseWarehouseReceipt.order') }}</span><span class="qs-type-data-emphasis break-all">{{ detail.orderNo }}</span><CopyCellButton :text="detail.orderNo" :label="t('purchaseWarehouseReceipt.order')" always-visible />
        </div>
        <span class="qs-type-body-medium break-all">{{ detail.supplier.label }}</span>
      </div>
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <span class="qs-type-meta text-muted-foreground">{{ t('purchaseWarehouseReceipt.selection', { selected: selectedIds.length, total: parts.length }) }}</span>
        <FaButton variant="outline" size="sm" class="text-primary border-primary/40 bg-primary/5" :disabled="locked || !parts.length" @click="selectedIds = parts.map(part => part.id)">
          <FaIcon name="i-lucide:list-checks" class="size-4" />{{ t('purchaseWarehouseReceipt.selectAll') }}
        </FaButton>
      </div>
      <div v-if="parts.length" class="max-h-[min(24rem,40dvh)] overflow-y-auto space-y-2">
        <article v-for="part in parts" :key="part.id" class="p-3 border rounded-lg transition-colors" :class="selectedIds.includes(part.id) ? 'border-primary bg-primary/5' : 'border-border'">
          <div class="flex gap-2 items-start">
            <FaButton variant="ghost" class="p-0 text-start flex-1 h-auto min-h-11 min-w-0 justify-start hover:bg-transparent" :disabled="locked" :aria-pressed="selectedIds.includes(part.id)" @click="toggle(part.id)">
              <FaIcon :name="selectedIds.includes(part.id) ? 'i-lucide:square-check' : 'i-lucide:square'" class="text-primary shrink-0 size-5" />
              <span class="flex-1 min-w-0"><span class="qs-type-data-emphasis block break-all">{{ part.shipmentNo || t('purchaseWarehouseReceipt.unnumbered') }}</span><span class="qs-type-meta text-muted-foreground mt-1 block">{{ t('purchaseWarehouseReceipt.part', { number: String(part.partNumber).padStart(2, '0') }) }} · <DateTimeDisplay :value="part.shippedAt" /></span></span>
            </FaButton>
            <CopyCellButton v-if="part.shipmentNo" :text="part.shipmentNo" :label="t('purchaseWarehouseReceipt.shipmentNo')" always-visible />
          </div>
          <div class="mt-2 flex gap-2 min-w-0 items-center">
            <span class="qs-type-data text-muted-foreground flex-1 whitespace-pre-wrap break-all">{{ part.shippingMarkText ? t('purchaseWarehouseReceipt.mark', { value: part.shippingMarkText }) : t('purchaseWarehouseReceipt.noMark') }}</span><CopyCellButton v-if="part.shippingMarkText" :text="part.shippingMarkText" :label="t('purchaseWarehouseReceipt.mark', { value: '' })" always-visible />
          </div>
          <ul class="m-0 mt-3 p-0 list-none space-y-2">
            <li v-for="item in part.items" :key="item.purchaseOrderLineId" class="flex gap-3 items-center">
              <ImageGroup v-if="item.imageSrc" :items="[{ src: item.imageSrc, alt: item.productName ?? '' }]" :size="40" :max-count="1" class="shrink-0" />
              <span v-else class="text-muted-foreground border border-border rounded-md bg-muted/25 flex shrink-0 size-10 items-center justify-center"><FaIcon name="i-lucide:image-off" class="size-4" /></span>
              <div class="flex-1 min-w-0">
                <div class="qs-type-body-medium break-all">
                  {{ item.productName || t('purchaseOrderDrawer.parts.productUnavailable') }}
                </div><div class="qs-type-meta text-muted-foreground break-all">
                  {{ item.productNo || t('purchaseOrderDesc.lineTypes.CUSTOM') }}
                </div>
              </div>
              <span class="qs-type-meta shrink-0">{{ t('purchaseWarehouseReceipt.quantity', { quantity: item.quantity }) }}</span>
            </li>
          </ul>
        </article>
      </div>
      <div v-else class="p-8 text-center border border-border rounded-lg border-dashed">
        <div class="qs-type-body-medium">
          {{ t('purchaseWarehouseReceipt.empty') }}
        </div><p class="qs-type-meta text-muted-foreground mb-0">
          {{ t('purchaseWarehouseReceipt.emptyDescription') }}
        </p>
      </div>
      <div class="space-y-2">
        <label for="warehouse-received-at" class="qs-type-body-medium">{{ t('purchaseWarehouseReceipt.receivedAt') }} <span class="text-destructive">*</span></label>
        <QsDateTimeField
          id="warehouse-received-at"
          v-model="receivedAt"
          precision="second"
          disable-future
          :min="minimumShippedAt"
          :disabled="locked || !parts.length"
          :aria-label="t('purchaseWarehouseReceipt.receivedAt')"
          @change="validationError = ''"
        />
      </div>
      <div class="space-y-2">
        <label for="warehouse-remark" class="qs-type-body-medium">{{ t('purchaseWarehouseReceipt.remark') }}</label><FaTextarea id="warehouse-remark" v-model="remark" :rows="3" :placeholder="t('purchaseWarehouseReceipt.remarkPlaceholder')" :disabled="locked || !parts.length" /><div class="qs-type-meta text-muted-foreground text-end" :class="[...remark.trim()].length > 500 && 'text-destructive'">
          {{ [...remark.trim()].length }}/500
        </div>
      </div>
      <p v-if="validationError" role="alert" class="qs-type-meta text-destructive m-0">
        {{ validationError }}
      </p>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="submitting" @click="emit('update:modelValue', false)">
        {{ t('purchaseWarehouseReceipt.cancel') }}
      </FaButton><FaButton :disabled="locked || !selectedIds.length" :loading="submitting" @click="submit">
        <FaIcon name="i-lucide:warehouse" class="size-4" />{{ t('purchaseWarehouseReceipt.confirm', { count: selectedIds.length }) }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
