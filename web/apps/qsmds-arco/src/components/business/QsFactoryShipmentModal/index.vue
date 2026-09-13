<script setup lang="ts">
import type {
  FactoryShipmentIntent,
  FactoryShipmentModalContext,
  FactoryShipmentModalMode,
  FactoryShipmentModalPurchaseOrder,
  FactoryShipmentSelectionMode,
} from './types'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import FactoryShipmentProductSummary from './FactoryShipmentProductSummary.vue'
import {
  buildFactoryShipmentIntent,
  calculateFactoryShipmentImpact,
  getPurchaseShipmentStatusMeta,
  isPendingFactoryShipment,
  sortFactoryShipmentOrders,
} from './logic'

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
const expandedOrderIds = ref<string[]>([])
const reason = ref('')

const sortedOrders = computed(() => sortFactoryShipmentOrders(
  props.context?.purchaseOrders ?? [],
))
const pendingOrders = computed(() => sortedOrders.value.filter(isPendingFactoryShipment))
const primaryOrder = computed(() => sortedOrders.value[0] ?? null)
const impact = computed(() => calculateFactoryShipmentImpact({
  mode: props.mode === 'PURCHASE_ORDER' ? 'SELECTED' : selectionMode.value,
  orders: sortedOrders.value,
  selectedIds: props.mode === 'PURCHASE_ORDER' && primaryOrder.value
    ? [primaryOrder.value.id]
    : selectedIds.value,
}))
const canSubmit = computed(() => (
  !props.loading
  && !props.submitting
  && !props.error
  && impact.value.selectedCount > 0
))
const title = computed(() => props.mode === 'SALES_ORDER'
  ? '确认工厂发货范围'
  : '确认本采购单已发货？')
const description = computed(() => props.mode === 'SALES_ORDER'
  ? '选择本次实际发货的关联采购单，系统将在提交后重新计算销售履约状态。'
  : '本次操作将当前采购订单整单标记为已发货。')

function resetDraft(mode: FactoryShipmentModalMode): void {
  reason.value = ''
  selectionMode.value = 'SELECTED'
  // 每次打开或切换上下文时恢复折叠态，避免沿用上一张销售订单的展开记录。
  expandedOrderIds.value = []
  selectedIds.value = mode === 'PURCHASE_ORDER' && primaryOrder.value
    ? [primaryOrder.value.id]
    : []
}

function setSelectionMode(mode: FactoryShipmentSelectionMode): void {
  if (props.submitting) {
    return
  }
  selectionMode.value = mode
  if (mode === 'ALL_PENDING') {
    selectedIds.value = pendingOrders.value.map(order => order.id)
  }
}

function toggleOrder(order: FactoryShipmentModalPurchaseOrder): void {
  if (props.submitting || !isPendingFactoryShipment(order)) {
    return
  }
  selectionMode.value = 'SELECTED'
  selectedIds.value = selectedIds.value.includes(order.id)
    ? selectedIds.value.filter(id => id !== order.id)
    : [...selectedIds.value, order.id]
}

function toggleOrderExpanded(orderId: string): void {
  expandedOrderIds.value = expandedOrderIds.value.includes(orderId)
    ? expandedOrderIds.value.filter(id => id !== orderId)
    : [...expandedOrderIds.value, orderId]
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
    selectedIds: props.mode === 'PURCHASE_ORDER' && primaryOrder.value
      ? [primaryOrder.value.id]
      : selectedIds.value,
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

      <div
        v-if="mode === 'SALES_ORDER'"
        data-slot="factory-shipment-sales-layout"
        class="flex-1 gap-4 grid min-h-0 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"
      >
        <section class="flex flex-col min-h-0 min-w-0">
          <div class="pb-3 shrink-0 gap-2 grid sm:grid-cols-2" aria-label="发货范围">
            <button
              type="button"
              class="p-3 text-start border rounded-lg transition-colors"
              :class="selectionMode === 'SELECTED'
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border text-muted-foreground hover:border-primary/50'"
              :aria-pressed="selectionMode === 'SELECTED'"
              :disabled="submitting"
              @click="setSelectionMode('SELECTED')"
            >
              <strong class="qs-type-body-medium block">指定采购单</strong>
              <span class="qs-type-meta mt-1 block">选择一张或多张实际发货订单</span>
            </button>
            <button
              type="button"
              class="p-3 text-start border rounded-lg transition-colors"
              :class="selectionMode === 'ALL_PENDING'
                ? 'border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'border-border text-muted-foreground hover:border-amber-500/50'"
              :aria-pressed="selectionMode === 'ALL_PENDING'"
              :disabled="submitting || pendingOrders.length === 0"
              @click="setSelectionMode('ALL_PENDING')"
            >
              <strong class="qs-type-body-medium block">全部待发货采购单</strong>
              <span class="qs-type-meta mt-1 block">共 {{ pendingOrders.length }} 张待处理</span>
            </button>
          </div>

          <div
            data-slot="factory-shipment-order-list"
            class="pr-1 overscroll-contain flex-1 min-h-0 overflow-x-hidden overflow-y-auto"
            aria-label="关联采购单列表"
          >
            <article
              v-for="order in sortedOrders"
              :key="order.id"
              data-slot="factory-shipment-order-card"
              class="p-4 border rounded-lg min-w-0 w-full transition-colors [&+&]:mt-2"
              :class="[
                isPendingFactoryShipment(order)
                  ? 'bg-background'
                  : 'border-border bg-muted/40 text-muted-foreground',
                selectedIds.includes(order.id) && isPendingFactoryShipment(order)
                  ? 'border-primary bg-primary/[0.035] ring-1 ring-primary/20'
                  : 'border-border',
              ]"
            >
              <div class="gap-3 grid min-w-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                <button
                  type="button"
                  data-slot="factory-shipment-order-select"
                  class="rounded-md flex size-10 items-center justify-center disabled:cursor-not-allowed"
                  :disabled="submitting || !isPendingFactoryShipment(order)"
                  :aria-label="isPendingFactoryShipment(order)
                    ? `${order.orderNo}：${selectedIds.includes(order.id) ? '取消选择' : '选择发货'}`
                    : `${order.orderNo}：已发货`"
                  :aria-pressed="selectedIds.includes(order.id)"
                  @click="toggleOrder(order)"
                >
                  <span
                    class="border rounded flex shrink-0 size-5 items-center justify-center"
                    :class="selectedIds.includes(order.id)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40 bg-background'"
                    aria-hidden="true"
                  >
                    <FaIcon
                      v-if="isPendingFactoryShipment(order) && selectedIds.includes(order.id)"
                      name="i-lucide:check"
                      class="size-3.5"
                    />
                    <FaIcon
                      v-else-if="!isPendingFactoryShipment(order)"
                      name="i-lucide:package-check"
                      class="size-3.5"
                    />
                  </span>
                </button>
                <button
                  type="button"
                  data-slot="factory-shipment-order-expand"
                  class="text-start rounded-md min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  :aria-label="`${order.orderNo}：${expandedOrderIds.includes(order.id) ? '收起采购产品' : '展开采购产品'}`"
                  :aria-expanded="expandedOrderIds.includes(order.id)"
                  :aria-controls="`factory-shipment-products-${order.id}`"
                  @click="toggleOrderExpanded(order.id)"
                >
                  <strong class="qs-type-data-emphasis font-mono block break-all">
                    {{ order.orderNo }}
                  </strong>
                  <span class="qs-type-meta text-muted-foreground mt-1 block truncate">
                    {{ order.orderDate }} · {{ order.supplier.label }}
                  </span>
                  <span class="qs-type-meta text-muted-foreground mt-1 block">
                    {{ order.lineSummary.lineCount }} 项产品 · 共 {{ order.lineSummary.totalQuantity }} 件
                  </span>
                  <span class="qs-type-meta text-primary mt-2 flex gap-1 items-center">
                    {{ expandedOrderIds.includes(order.id) ? '收起产品' : '查看产品' }}
                    <FaIcon
                      :name="expandedOrderIds.includes(order.id)
                        ? 'i-lucide:chevron-up'
                        : 'i-lucide:chevron-down'"
                      class="size-4"
                      aria-hidden="true"
                    />
                  </span>
                </button>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag w-fit sm:justify-self-end"
                  :class="getPurchaseShipmentStatusMeta(order.fulfillmentStatus).className"
                >
                  {{ getPurchaseShipmentStatusMeta(order.fulfillmentStatus).label }}
                </FaTag>
              </div>
              <div
                v-if="expandedOrderIds.includes(order.id)"
                :id="`factory-shipment-products-${order.id}`"
              >
                <FactoryShipmentProductSummary
                  :previews="order.lineSummary.previews"
                  display-mode="FULL"
                />
              </div>
            </article>
          </div>
        </section>

        <aside class="p-4 border border-amber-500/30 rounded-lg bg-amber-500/5 self-start">
          <span class="text-amber-700 flex gap-2 items-center dark:text-amber-300">
            <FaIcon name="i-lucide:route" class="size-4" aria-hidden="true" />
            <strong class="qs-type-section-title">发货影响</strong>
          </span>
          <dl class="m-0 mt-4 gap-3 grid">
            <div class="flex gap-4 items-baseline justify-between">
              <dt class="qs-type-meta text-muted-foreground">
                本次发货
              </dt>
              <dd class="qs-type-data-emphasis font-mono m-0">
                {{ impact.selectedCount }} 张
              </dd>
            </div>
            <div class="flex gap-4 items-baseline justify-between">
              <dt class="qs-type-meta text-muted-foreground">
                剩余待发货
              </dt>
              <dd class="qs-type-data-emphasis font-mono m-0">
                {{ impact.remainingCount }} 张
              </dd>
            </div>
          </dl>
          <div
            class="qs-type-body-medium mt-4 p-3 border rounded-md"
            :class="impact.willAdvanceSalesOrder
              ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
              : 'border-border bg-background text-muted-foreground'"
          >
            {{ impact.willAdvanceSalesOrder
              ? '销售订单将进入陆运中'
              : '销售订单将保持备货中' }}
          </div>
        </aside>
      </div>

      <section v-else-if="primaryOrder" class="overscroll-contain flex-1 min-h-0 overflow-y-auto">
        <slot name="purchase-content">
          <div class="p-4 border border-border rounded-lg bg-background gap-4 grid">
            <div class="gap-4 grid sm:grid-cols-2">
              <div class="min-w-0">
                <span class="qs-type-meta text-muted-foreground block">采购订单</span>
                <strong class="qs-type-data-emphasis font-mono mt-1 block break-all">
                  {{ primaryOrder.orderNo }}
                </strong>
              </div>
              <div class="min-w-0 sm:text-end">
                <span class="qs-type-meta text-muted-foreground block">供应商</span>
                <strong class="qs-type-body-medium mt-1 block truncate">
                  {{ primaryOrder.supplier.label }}
                </strong>
              </div>
            </div>
            <div class="pt-4 border-t border-border/70 flex flex-wrap gap-3 items-center justify-between">
              <span class="qs-type-meta text-muted-foreground">
                {{ primaryOrder.lineSummary.lineCount }} 项产品 · 共 {{ primaryOrder.lineSummary.totalQuantity }} 件
              </span>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="getPurchaseShipmentStatusMeta(primaryOrder.fulfillmentStatus).className"
              >
                {{ getPurchaseShipmentStatusMeta(primaryOrder.fulfillmentStatus).label }}
              </FaTag>
            </div>
            <FactoryShipmentProductSummary :previews="primaryOrder.lineSummary.previews" />
          </div>
          <FaAlert
            v-if="primaryOrder.fulfillmentStatus === 'ORDERED'"
            class="mt-4"
            icon="i-lucide:route"
            title="系统将顺序推进采购履约状态"
            description="确认后系统将完成备货状态并将本采购单标记为已发货。"
          />
        </slot>
      </section>

      <div class="mt-4 shrink-0">
        <label for="factory-shipment-reason" class="qs-type-label block">发货说明（可选）</label>
        <FaTextarea
          id="factory-shipment-reason"
          v-model="reason"
          class="mt-2 w-full"
          :rows="2"
          :maxlength="500"
          placeholder="可填写厂区、批次或其他需要留档的说明"
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
        确认发货<span v-if="mode === 'SALES_ORDER'"> {{ impact.selectedCount }} 张</span>
      </FaButton>
    </template>
  </QsGenericModal>
</template>
