<script setup lang="ts">
import type { SalesOrderWarehouseReceiptContextDto } from '../../../api/generated/types.gen'
import type { SalesWarehouseReceiptIntent } from './sales-order-warehouse-receipt.logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'
import { currentDateTimeValue } from '@/components/business/QsDateTimeField/logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import {
  buildSalesWarehouseReceiptIntent,
  countWarehouseReceiptParts,
  createWarehouseReceiptOrders,
  defaultWarehouseReceiptSelection,
  warehouseReceiptMinimumReceivedAt,
} from './sales-order-warehouse-receipt.logic'

const props = defineProps<{
  modelValue: boolean
  context: SalesOrderWarehouseReceiptContextDto | null
  loading: boolean
  submitting: boolean
  error: string | null
}>()
const emit = defineEmits<{
  'retry': []
  'submit': [intent: SalesWarehouseReceiptIntent]
  'update:modelValue': [value: boolean]
}>()
const { t } = useI18n()
const selectedIds = ref<string[]>([])
const receivedAt = ref('')
const remark = ref('')
const validationError = ref('')
const orders = computed(() => createWarehouseReceiptOrders(props.context))
const totalPartCount = computed(() => countWarehouseReceiptParts(orders.value))
const minimumReceivedAt = computed(() => warehouseReceiptMinimumReceivedAt(
  orders.value,
  selectedIds.value,
))
const locked = computed(() => (
  props.loading
  || props.submitting
  || props.error !== null
  || props.context === null
))
const canSubmit = computed(() => !locked.value && selectedIds.value.length > 0)

function resetDraft(): void {
  selectedIds.value = defaultWarehouseReceiptSelection(orders.value)
  receivedAt.value = currentDateTimeValue('second')
  remark.value = ''
  validationError.value = ''
}

function toggle(partId: string): void {
  if (locked.value || props.submitting) {
    return
  }
  selectedIds.value = selectedIds.value.includes(partId)
    ? selectedIds.value.filter(id => id !== partId)
    : [...selectedIds.value, partId]
  validationError.value = ''
}

function selectAll(): void {
  if (locked.value || props.submitting) {
    return
  }
  selectedIds.value = orders.value.flatMap(order => order.parts.map(part => part.id))
  validationError.value = ''
}

function submit(): void {
  if (!canSubmit.value || props.context === null) {
    return
  }
  const result = buildSalesWarehouseReceiptIntent({
    orders: orders.value,
    context: props.context,
    selectedIds: selectedIds.value,
    receivedAt: receivedAt.value,
    remark: remark.value,
    now: new Date(),
  })
  if (!result.valid) {
    validationError.value = t(`salesWarehouseReceipt.validation.${result.error}`)
    return
  }
  validationError.value = ''
  emit('submit', result.request)
}

watch(
  () => [props.modelValue, props.context] as const,
  ([open]) => {
    if (open) {
      resetDraft()
    }
  },
  { immediate: true },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('salesWarehouseReceipt.title')"
    :description="t('salesWarehouseReceipt.description')"
    size="xl"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:warehouse" class="size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton type="button" variant="outline" size="sm" :disabled="submitting" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />{{ t('salesWarehouseReceipt.reload') }}
      </FaButton>
    </template>
    <div v-if="context" class="space-y-4">
      <div class="p-3 border border-border rounded-lg bg-muted/20 flex flex-wrap gap-3 items-center justify-between">
        <div class="flex gap-2 min-w-0 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('salesWarehouseReceipt.order') }}</span>
          <span class="qs-type-data-emphasis break-all">{{ context.salesOrder.orderNo }}</span>
          <CopyCellButton :text="context.salesOrder.orderNo" :label="t('salesWarehouseReceipt.order')" always-visible />
        </div>
        <div class="flex gap-2 min-w-0 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('salesWarehouseReceipt.customer') }}</span>
          <span class="qs-type-body-medium break-all">{{ context.salesOrder.customerName }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <span class="qs-type-meta text-muted-foreground">{{ t('salesWarehouseReceipt.selection', { selected: selectedIds.length, total: totalPartCount }) }}</span>
        <FaButton
          type="button"
          variant="outline"
          size="sm"
          class="text-primary border-primary/40 bg-primary/5"
          :disabled="locked || totalPartCount === 0"
          @click="selectAll"
        >
          <FaIcon name="i-lucide:list-checks" class="size-4" aria-hidden="true" />{{ t('salesWarehouseReceipt.selectAll') }}
        </FaButton>
      </div>
      <div v-if="totalPartCount" class="max-h-[min(26rem,42dvh)] overflow-y-auto space-y-4">
        <section v-for="order in orders" :key="order.id" class="space-y-2">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <div class="flex flex-wrap gap-2 min-w-0 items-center">
              <strong class="qs-type-data-emphasis break-all">{{ order.orderNo }}</strong>
              <span class="qs-type-meta text-muted-foreground break-all">{{ order.supplierLabel }}</span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <FaTag variant="outline" class="text-primary border-primary/30 bg-primary/10">
                {{ t('salesWarehouseReceipt.shipped') }}
              </FaTag>
              <span v-if="order.receivedPartCount > 0" class="qs-type-meta text-muted-foreground">
                {{ t('salesWarehouseReceipt.receivedCount', { count: order.receivedPartCount }) }}
              </span>
            </div>
          </div>
          <div class="space-y-2">
            <article
              v-for="part in order.parts"
              :key="part.id"
              class="p-3 border rounded-lg transition-colors"
              :class="selectedIds.includes(part.id) ? 'border-primary bg-primary/5' : 'border-border'"
            >
              <div class="flex gap-2 items-start">
                <FaButton
                  variant="ghost"
                  class="p-0 text-start flex-1 h-auto min-h-11 min-w-0 justify-start hover:bg-transparent"
                  :disabled="locked"
                  :aria-pressed="selectedIds.includes(part.id)"
                  :aria-label="t('salesWarehouseReceipt.part', { number: String(part.partNumber).padStart(2, '0') })"
                  @click="toggle(part.id)"
                >
                  <FaIcon
                    :name="selectedIds.includes(part.id) ? 'i-lucide:square-check' : 'i-lucide:square'"
                    class="text-primary shrink-0 size-5"
                    aria-hidden="true"
                  />
                  <span class="flex-1 min-w-0">
                    <span class="flex flex-wrap gap-2 items-center">
                      <span class="qs-type-data-emphasis break-all">{{ part.shipmentNo || t('salesWarehouseReceipt.unnumbered') }}</span>
                      <span class="qs-type-meta text-muted-foreground">{{ t('salesWarehouseReceipt.part', { number: String(part.partNumber).padStart(2, '0') }) }}</span>
                    </span>
                    <span class="qs-type-meta text-muted-foreground mt-1 flex gap-1 items-center">
                      {{ t('salesWarehouseReceipt.shippedAt') }} <DateTimeDisplay :value="part.shippedAt" />
                    </span>
                  </span>
                </FaButton>
                <CopyCellButton v-if="part.shipmentNo" :text="part.shipmentNo" :label="t('salesWarehouseReceipt.shipmentNo')" always-visible />
              </div>
              <div class="mt-2 flex gap-2 min-w-0 items-center">
                <span class="qs-type-data text-muted-foreground flex-1 whitespace-pre-wrap break-all">
                  {{ part.shippingMarkText ? t('salesWarehouseReceipt.mark', { value: part.shippingMarkText }) : t('salesWarehouseReceipt.noMark') }}
                </span>
                <CopyCellButton v-if="part.shippingMarkText" :text="part.shippingMarkText" :label="t('salesWarehouseReceipt.mark', { value: '' })" always-visible />
              </div>
              <div class="mt-1 flex gap-2 min-w-0 items-center">
                <span class="qs-type-meta text-muted-foreground shrink-0">{{ t('salesWarehouseReceipt.tracking') }}</span>
                <span class="qs-type-meta min-w-0 break-all" :class="!part.trackingNo && 'text-muted-foreground'">
                  {{ part.trackingNo || t('salesWarehouseReceipt.noTracking') }}
                </span>
              </div>
              <ul class="m-0 mt-3 p-0 list-none space-y-2">
                <li v-for="product in part.products" :key="product.purchaseOrderLineId" class="flex gap-3 items-center">
                  <ImageGroup v-if="product.imageSrc" :items="[{ src: product.imageSrc, alt: product.productName ?? '' }]" :size="40" :max-count="1" class="shrink-0" />
                  <span v-else class="text-muted-foreground border border-border rounded-md bg-muted/25 flex shrink-0 size-10 items-center justify-center">
                    <FaIcon name="i-lucide:image-off" class="size-4" aria-hidden="true" />
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="qs-type-body-medium break-all">
                      {{ product.productName || t('purchaseOrderDrawer.parts.productUnavailable') }}
                    </div>
                    <div v-if="product.productNo" class="qs-type-meta text-muted-foreground break-all">
                      {{ product.productNo }}
                    </div>
                    <div v-if="product.description" class="qs-type-meta text-muted-foreground break-all">
                      {{ t('salesWarehouseReceipt.descriptionLine', { value: product.description }) }}
                    </div>
                  </div>
                  <span class="qs-type-meta shrink-0">{{ t('salesWarehouseReceipt.quantity', { quantity: product.quantity }) }}</span>
                </li>
              </ul>
            </article>
          </div>
        </section>
      </div>
      <div v-else class="p-8 text-center border border-border rounded-lg border-dashed">
        <div class="qs-type-body-medium">
          {{ t('salesWarehouseReceipt.empty') }}
        </div>
        <p class="qs-type-meta text-muted-foreground mb-0">
          {{ t('salesWarehouseReceipt.emptyDescription') }}
        </p>
      </div>
      <div class="space-y-2">
        <label for="sales-warehouse-received-at" class="qs-type-body-medium">
          {{ t('salesWarehouseReceipt.receivedAt') }} <span class="text-destructive">*</span>
        </label>
        <QsDateTimeField
          id="sales-warehouse-received-at"
          v-model="receivedAt"
          precision="second"
          disable-future
          :min="minimumReceivedAt"
          :disabled="locked || totalPartCount === 0"
          :aria-label="t('salesWarehouseReceipt.receivedAt')"
          @change="validationError = ''"
        />
      </div>
      <div class="space-y-2">
        <label for="sales-warehouse-remark" class="qs-type-body-medium">{{ t('salesWarehouseReceipt.remark') }}</label>
        <FaTextarea
          id="sales-warehouse-remark"
          v-model="remark"
          :rows="3"
          :maxlength="500"
          :placeholder="t('salesWarehouseReceipt.remarkPlaceholder')"
          :disabled="locked || totalPartCount === 0"
        />
        <div class="qs-type-meta text-muted-foreground text-end" :class="[...remark.trim()].length > 500 && 'text-destructive'">
          {{ [...remark.trim()].length }}/500
        </div>
      </div>
      <p v-if="validationError" role="alert" class="qs-type-meta text-destructive m-0">
        {{ validationError }}
      </p>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="submitting" @click="emit('update:modelValue', false)">
        {{ t('salesWarehouseReceipt.cancel') }}
      </FaButton>
      <FaButton :disabled="!canSubmit" :loading="submitting" @click="submit">
        <FaIcon name="i-lucide:warehouse" class="size-4" aria-hidden="true" />
        {{ t('salesWarehouseReceipt.confirm', { count: selectedIds.length }) }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
