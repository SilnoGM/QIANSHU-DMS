<script setup lang="ts">
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { SalesOrderAddOnModalContext } from '@/components/business/QsSalesOrderAddOnProductsModal/types'

import QsSalesOrderAddOnProductsModal from '@/components/business/QsSalesOrderAddOnProductsModal/index.vue'
import { dictionaryCatalogProviderKey } from '@/dictionary-catalog/injection'
import {
  createOrderProductFixtureEditorLines,
  createOrderProductFixtureLoader,
  createOrderProductFixtureProvider,
  ORDER_PRODUCT_FIXTURE_CURRENCIES,
} from '../fixtures/order-product.fixture'

defineOptions({ name: 'SalesOrderAddOnProductsModalShowcase' })

provide(dictionaryCatalogProviderKey, createOrderProductFixtureProvider())

const stateValues = ['stable', 'empty', 'loading', 'error', 'full', 'mobile'] as const
type ShowcaseState = typeof stateValues[number]

const stateLabels: Readonly<Record<ShowcaseState, string>> = {
  stable: '稳定状态',
  empty: '空编辑区',
  loading: '加载状态',
  error: '错误状态',
  full: '行数已满',
  mobile: '移动布局',
}

const baseContext: SalesOrderAddOnModalContext = {
  salesOrder: {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20260902-00018',
    customerName: '千航贸易（台北）有限公司',
    currencyCode: 'TWD',
    fulfillmentStatus: 'WAREHOUSE_ARRIVED',
    paymentStatus: 'PAID',
    version: 9,
  },
  amounts: {
    lineSubtotalAmount: '180000.00',
    agreedTotalAmount: '180000.00',
    depositDueAmount: '60000.00',
    balanceDueAmount: '120000.00',
    paidAmount: '180000.00',
    outstandingAmount: '0.00',
  },
  existingLines: [{
    id: 'existing-1',
    lineNumber: 1,
    lineType: 'CATALOG',
    productNo: 'PRD-202608-001',
    productName: '千树标准组合柜',
    actualUnitPriceAmount: '120000.00',
    quantity: 1,
    lineTotalAmount: '120000.00',
  }, {
    id: 'existing-2',
    lineNumber: 2,
    lineType: 'CUSTOM',
    productNo: null,
    productName: '订单专用安装服务',
    actualUnitPriceAmount: '30000.00',
    quantity: 2,
    lineTotalAmount: '60000.00',
  }],
  availableLineCapacity: 8,
}

const visible = ref(false)
const selectedState = ref<ShowcaseState>('stable')
const lines = ref<readonly OrderProductLineModel[]>([])
const reason = ref('客户加购产品')
const lastEvent = ref('等待打开')
const loader = createOrderProductFixtureLoader()
const context = computed(() => selectedState.value === 'full'
  ? { ...baseContext, availableLineCapacity: 0 }
  : baseContext)
const loading = computed(() => selectedState.value === 'loading')
const error = computed(() => selectedState.value === 'error'
  ? '销售订单加购上下文加载失败，请重试。'
  : null)

function selectState(state: ShowcaseState): void {
  selectedState.value = state
  lines.value = state === 'stable' || state === 'mobile'
    ? createOrderProductFixtureEditorLines('TWD').slice(0, 1)
    : []
  reason.value = '客户加购产品'
  lastEvent.value = `state · ${state}`
}

function openModal(): void {
  selectState(selectedState.value)
  visible.value = true
  lastEvent.value = `open · ${selectedState.value}`
}
</script>

<template>
  <section class="p-5 border border-border rounded-xl bg-background sm:p-7" aria-label="销售订单加购产品弹窗示例">
    <div class="flex flex-wrap gap-4 items-start justify-between">
      <div>
        <span class="text-xs text-primary tracking-[0.16em] font-semibold">纯业务弹窗</span>
        <h3 class="text-xl font-semibold m-0 mt-2">
          销售订单海运前加购
        </h3>
        <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
          验收原产品只读、新增产品编辑、金额预览、二次确认以及加载和错误恢复。
        </p>
      </div>
      <FaTag variant="secondary">
        QsSalesOrderAddOnProductsModal
      </FaTag>
    </div>

    <div class="mt-6 gap-2 grid grid-cols-2 lg:grid-cols-6 sm:grid-cols-3">
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
      <FaButton type="button" @click="openModal">
        <FaIcon name="i-lucide:package-plus" class="size-4" aria-hidden="true" />
        打开加购产品弹窗
      </FaButton>
    </div>

    <QsSalesOrderAddOnProductsModal
      v-model="visible"
      v-model:reason="reason"
      :lines="lines"
      :context="context"
      supplier-value="ISLAND_WEAVE"
      :currencies="ORDER_PRODUCT_FIXTURE_CURRENCIES"
      :load-products="loader"
      :loading="loading"
      :error="error"
      @update:lines="lines = $event"
      @review="lastEvent = `review · ${$event.lines.length} 项`"
      @confirm="lastEvent = `confirm · ${$event.lines.length} 项`"
      @cancel="lastEvent = 'cancel'"
      @retry="selectState('stable')"
    />
  </section>
</template>
