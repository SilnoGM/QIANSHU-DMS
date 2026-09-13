<script setup lang="ts">
import type {
  FactoryShipmentIntent,
  FactoryShipmentModalContext,
  FactoryShipmentModalMode,
  FactoryShipmentSelectionMode,
} from './types'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildFactoryShipmentIntent,
  calculateFactoryShipmentImpact,
  defaultShipmentSelection,
  getPurchaseShipmentStatusMeta,
  isPendingFactoryShipment,
  sortFactoryShipmentOrders,
} from './logic'
import ShipmentParts from './ShipmentParts.vue'

defineOptions({ name: 'QsFactoryShipmentModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  mode: 'PURCHASE_ORDER' | 'SALES_ORDER'
  context: FactoryShipmentModalContext | null
  loading?: boolean
  submitting?: boolean
  error?: string | null
}>(), {
  loading: false,
  submitting: false,
  error: null,
})

const emit = defineEmits<{
  'cancel': []
  'retry': []
  'submit': [intent: FactoryShipmentIntent]
  'update:modelValue': [value: boolean]
}>()

const selectionMode = ref<FactoryShipmentSelectionMode>('SELECTED')
const selectedIds = ref<string[]>([])
const reason = ref('')

const sortedOrders = computed(() => sortFactoryShipmentOrders(
  props.context?.purchaseOrders ?? [],
))
const pendingOrders = computed(() => sortedOrders.value.filter(isPendingFactoryShipment))
const primaryOrder = computed(() => sortedOrders.value[0] ?? null)
const impact = computed(() => calculateFactoryShipmentImpact({
  mode: props.mode === 'PURCHASE_ORDER' ? 'SELECTED' : selectionMode.value,
  orders: sortedOrders.value,
  selectedIds: selectedIds.value,
}))
const canSubmit = computed(() => (
  !props.loading
  && !props.submitting
  && !props.error
  && impact.value.selectedCount > 0
))
const title = computed(() => props.mode === 'SALES_ORDER'
  ? '确认工厂发货范围'
  : '确认货件发货')
const description = computed(() => props.mode === 'SALES_ORDER'
  ? '选择本次实际发出的货件，未选择的货件可后续发货。'
  : '每个货件中的产品一次发出，多货件可分次发货。')

function resetDraft(_mode: FactoryShipmentModalMode): void {
  reason.value = ''
  selectionMode.value = 'SELECTED'
  selectedIds.value = defaultShipmentSelection(sortedOrders.value)
}

function setSelectionMode(mode: FactoryShipmentSelectionMode): void {
  if (props.submitting) {
    return
  }
  selectionMode.value = mode
  if (mode === 'ALL_PENDING') {
    selectedIds.value = pendingOrders.value.flatMap(order => order.parts.filter(part => part.status === 'ACTIVE' && part.shippedAt === null).map(part => part.id))
  }
}

function togglePart(partId: string): void {
  if (props.submitting) {
    return
  }
  selectionMode.value = 'SELECTED'
  selectedIds.value = selectedIds.value.includes(partId)
    ? selectedIds.value.filter(id => id !== partId)
    : [...selectedIds.value, partId]
}

function closeAsCancel(): void {
  emit('cancel')
  emit('update:modelValue', false)
}

function handleVisibility(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
  }
  else {
    closeAsCancel()
  }
}

function submit(): void {
  if (!canSubmit.value) {
    return
  }
  emit('submit', buildFactoryShipmentIntent({
    mode: props.mode === 'PURCHASE_ORDER' ? 'SELECTED' : selectionMode.value,
    orders: sortedOrders.value,
    selectedIds: selectedIds.value,
    reason: reason.value,
  }))
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      resetDraft(props.mode)
    }
  },
)

watch(
  () => props.context,
  () => {
    if (props.modelValue) {
      resetDraft(props.mode)
    }
  },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="title"
    :description="description"
    size="xl"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="handleVisibility"
  >
    <template #header-leading>
      <FaIcon
        :name="mode === 'SALES_ORDER' ? 'i-lucide:factory' : 'i-lucide:truck'"
        class="size-4"
        aria-hidden="true"
      />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" size="sm" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        重新加载
      </FaButton>
    </template>

    <div
      v-if="context"
      data-slot="factory-shipment-body"
      class="flex flex-col h-[min(35rem,calc(100dvh-14rem))] min-h-0 overflow-hidden"
    >
      <div
        v-if="context.salesOrder"
        class="mb-4 p-4 border border-border rounded-lg bg-muted/25 shrink-0 gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <div class="min-w-0">
          <span class="qs-type-meta text-muted-foreground block">销售订单</span>
          <strong class="qs-type-data-emphasis font-mono mt-1 block break-all">
            {{ context.salesOrder.orderNo }}
          </strong>
        </div>
        <div class="min-w-0 sm:text-end">
          <span class="qs-type-meta text-muted-foreground block">客户</span>
          <strong class="qs-type-body-medium mt-1 block truncate">
            {{ context.salesOrder.customerName }}
          </strong>
        </div>
      </div>

      <div class="mb-3 flex flex-wrap gap-3 items-center justify-between">
        <span class="qs-type-meta text-muted-foreground">本次发货 {{ impact.selectedCount }} 件 · 剩余 {{ impact.remainingCount }} 件</span>
        <FaButton type="button" variant="ghost" size="sm" :disabled="submitting || pendingOrders.length === 0" @click="setSelectionMode('ALL_PENDING')">
          全选未发货
        </FaButton>
      </div>
      <div data-slot="factory-shipment-order-list" class="pr-1 overscroll-contain flex-1 min-h-0 overflow-y-auto space-y-4">
        <template v-if="mode === 'PURCHASE_ORDER' && primaryOrder">
          <slot name="purchase-content" />
          <ShipmentParts :order="primaryOrder" :selected-ids="selectedIds" :disabled="submitting" @toggle="togglePart" />
        </template>
        <section v-for="order in mode === 'SALES_ORDER' ? sortedOrders : []" :key="order.id" class="space-y-3">
          <div class="flex flex-wrap gap-3 items-center justify-between">
            <strong class="qs-type-data-emphasis">{{ order.orderNo }}</strong>
            <FaTag variant="outline" :class="getPurchaseShipmentStatusMeta(order.fulfillmentStatus).className">
              {{ getPurchaseShipmentStatusMeta(order.fulfillmentStatus).label }}
            </FaTag>
          </div>
          <p class="qs-type-meta text-muted-foreground">
            {{ order.supplier.label }}
          </p>
          <p class="qs-type-data whitespace-pre-wrap break-all">
            基础唛头：{{ order.shippingMarkText || '未记录' }}
          </p>
          <ShipmentParts :order="order" :selected-ids="selectedIds" :disabled="submitting" @toggle="togglePart" />
        </section>
      </div>

      <div class="mt-4 shrink-0">
        <label for="factory-shipment-reason" class="qs-type-label block">发货说明（可选）</label>
        <FaTextarea
          id="factory-shipment-reason"
          v-model="reason"
          class="mt-2 w-full"
          :rows="2"
          :maxlength="500"
          placeholder="可填写本次发货需要留档的说明"
          :disabled="submitting"
        />
        <span class="qs-type-meta text-muted-foreground mt-1 text-end block">
          {{ [...reason].length }}/500
        </span>
      </div>
    </div>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="h-11 sm:h-9"
        :disabled="submitting"
        @click="closeAsCancel"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="h-11 sm:h-9"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        <FaIcon name="i-lucide:truck" class="size-4" aria-hidden="true" />
        确认发货（{{ impact.selectedCount }} 件）
      </FaButton>
    </template>
  </QsGenericModal>
</template>
