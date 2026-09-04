<script setup lang="ts">
import type { FactoryShipmentModalContext } from '@/components/business/QsFactoryShipmentModal/types'

import QsFactoryShipmentModal from '@/components/business/QsFactoryShipmentModal/index.vue'

defineOptions({ name: 'FactoryShipmentModalShowcase' })

const stateValues = ['sales', 'purchase', 'loading', 'error'] as const
type ShowcaseState = typeof stateValues[number]

const stateLabels: Readonly<Record<ShowcaseState, string>> = {
  sales: '销售订单发货',
  purchase: '采购订单发货',
  loading: '加载状态',
  error: '错误状态',
}

const salesContext: FactoryShipmentModalContext = {
  salesOrder: {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20260904-00018',
    customerName: '千航贸易（台北）有限公司',
    fulfillmentStatus: 'PREPARING',
  },
  purchaseOrders: [
    {
      id: '21111111-1111-4111-8111-111111111111',
      orderNo: 'PO/20260904-00021',
      orderDate: '2026-09-04',
      supplier: { label: '华东家具制造有限公司' },
      fulfillmentStatus: 'ORDERED',
      version: 3,
      lineSummary: {
        lineCount: 2,
        totalQuantity: 6,
        previews: [],
      },
    },
    {
      id: '31111111-1111-4111-8111-111111111111',
      orderNo: 'PO/20260903-00016',
      orderDate: '2026-09-03',
      supplier: { label: '北辰五金供应链' },
      fulfillmentStatus: 'PREPARING',
      version: 5,
      lineSummary: {
        lineCount: 3,
        totalQuantity: 12,
        previews: [],
      },
    },
    {
      id: '41111111-1111-4111-8111-111111111111',
      orderNo: 'PO/20260901-00008',
      orderDate: '2026-09-01',
      supplier: { label: '南港包装服务中心' },
      fulfillmentStatus: 'SHIPPED',
      version: 7,
      lineSummary: {
        lineCount: 1,
        totalQuantity: 2,
        previews: [],
      },
    },
  ],
}

const purchaseContext: FactoryShipmentModalContext = {
  salesOrder: salesContext.salesOrder,
  purchaseOrders: [salesContext.purchaseOrders[0]!],
}

const visible = ref(false)
const selectedState = ref<ShowcaseState>('sales')
const submitting = ref(false)
const lastEvent = ref('等待打开')

const loading = computed(() => selectedState.value === 'loading')
const error = computed(() => selectedState.value === 'error'
  ? '发货上下文加载失败，请重试。'
  : null)

function selectState(state: ShowcaseState): void {
  selectedState.value = state
  submitting.value = false
  lastEvent.value = `state · ${state}`
}

function openModal(): void {
  visible.value = true
  lastEvent.value = `open · ${selectedState.value}`
}
</script>

<template>
  <section class="p-5 border border-border rounded-xl bg-background sm:p-7" aria-label="订单工厂发货弹窗示例">
    <div class="flex flex-wrap gap-4 items-start justify-between">
      <div class="min-w-0">
        <span class="text-xs text-primary tracking-[0.16em] font-semibold">发货范围确认</span>
        <h3 class="text-xl font-semibold m-0 mt-2">
          销售聚合发货与单采购发货
        </h3>
        <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
          销售模式选择本次实际发货的采购单，采购模式仅确认当前采购单；请求与状态推进仍由业务页面负责。
        </p>
      </div>
      <FaTag variant="secondary">
        QsFactoryShipmentModal
      </FaTag>
    </div>

    <div class="mt-6 gap-2 grid grid-cols-2 lg:grid-cols-4">
      <FaButton
        v-for="state in stateValues"
        :key="state"
        type="button"
        :variant="selectedState === state ? 'default' : 'outline'"
        @click="selectState(state)"
      >
        {{ stateLabels[state] }}
      </FaButton>
    </div>

    <div class="mt-5 p-4 border border-border rounded-lg bg-muted/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <span class="qs-type-meta text-muted-foreground break-all">{{ lastEvent }}</span>
      <FaButton
        type="button"
        data-testid="factory-shipment-modal-trigger"
        @click="openModal"
      >
        <FaIcon name="i-lucide:truck" class="size-4" aria-hidden="true" />
        打开发货弹窗
      </FaButton>
    </div>

    <QsFactoryShipmentModal
      v-if="selectedState !== 'purchase'"
      v-model="visible"
      mode="SALES_ORDER"
      :context="salesContext"
      :loading="loading"
      :submitting="submitting"
      :error="error"
      @submit="lastEvent = `submit · ${$event.targets.length} 张采购单`"
      @cancel="lastEvent = 'cancel'"
      @retry="selectState('sales')"
    />
    <QsFactoryShipmentModal
      v-else
      v-model="visible"
      mode="PURCHASE_ORDER"
      :context="purchaseContext"
      :submitting="submitting"
      @submit="lastEvent = `submit · ${$event.targets[0]?.purchaseOrderId ?? '-'}`"
      @cancel="lastEvent = 'cancel'"
    />
  </section>
</template>
