<script setup lang="ts">
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { SalesOrderProductEditModalContext } from '@/components/business/QsSalesOrderProductsEditorModal/types'

import QsSalesOrderProductsEditorModal from '@/components/business/QsSalesOrderProductsEditorModal/index.vue'
import { createExistingSalesOrderLineDrafts } from '@/components/business/QsSalesOrderProductsEditorModal/logic'
import { dictionaryCatalogProviderKey } from '@/dictionary-catalog/injection'
import {
  createOrderProductFixtureEditorLines,
  createOrderProductFixtureLoader,
  createOrderProductFixtureProvider,
  ORDER_PRODUCT_FIXTURE_CURRENCIES,
} from '../fixtures/order-product.fixture'

defineOptions({ name: 'SalesOrderProductsEditorModalShowcase' })

provide(dictionaryCatalogProviderKey, createOrderProductFixtureProvider())

const stateValues = ['stable', 'deposit-risk', 'loading', 'error', 'mobile'] as const
type ShowcaseState = typeof stateValues[number]
const stateLabels: Readonly<Record<ShowcaseState, string>> = {
  'stable': '稳定状态',
  'deposit-risk': '定金风险',
  'loading': '加载状态',
  'error': '错误状态',
  'mobile': '移动布局',
}

const baseContext: SalesOrderProductEditModalContext = {
  salesOrder: {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20260902-00018',
    customerName: '千航贸易（台北）有限公司',
    currencyCode: 'TWD',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'WAREHOUSE_ARRIVED',
    paymentStatus: 'PARTIALLY_PAID',
    version: 9,
  },
  amounts: {
    lineSubtotalAmount: '180000.0000',
    agreedTotalAmount: '180000.0000',
    depositDueAmount: '60000.0000',
    balanceDueAmount: '120000.0000',
    paidAmount: '30000.0000',
    outstandingAmount: '150000.0000',
  },
  existingLines: [{
    id: 'existing-1',
    lineNumber: 1,
    lineType: 'CATALOG',
    productId: '22222222-2222-4222-8222-222222222222',
    productNo: 'PRD-202608-001',
    productName: '千树标准组合柜',
    description: '客户指定胡桃木色',
    standardUnitPriceAmount: '125000.0000',
    actualUnitPriceAmount: '120000.0000',
    quantity: 1,
    lineTotalAmount: '120000.0000',
    activePurchasedQuantity: 1,
    canDecrease: false,
  }, {
    id: 'existing-2',
    lineNumber: 2,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    productName: '订单专用安装服务',
    description: null,
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: '30000.0000',
    quantity: 2,
    lineTotalAmount: '60000.0000',
    activePurchasedQuantity: 0,
    canDecrease: true,
  }],
  availableLineCapacity: 98,
}

const visible = ref(false)
const selectedState = ref<ShowcaseState>('stable')
const context = shallowRef(baseContext)
const existingLineDrafts = ref(createExistingSalesOrderLineDrafts(baseContext))
const newLines = ref<readonly OrderProductLineModel[]>([])
const reason = ref('客户调整产品')
const lastEvent = ref('等待打开')
const loader = createOrderProductFixtureLoader()
const loading = computed(() => selectedState.value === 'loading')
const error = computed(() => selectedState.value === 'error'
  ? '销售产品修改上下文加载失败，请重试。'
  : null)

function selectState(state: ShowcaseState): void {
  selectedState.value = state
  context.value = baseContext
  existingLineDrafts.value = createExistingSalesOrderLineDrafts(baseContext).map(
    (draft, index) => state === 'deposit-risk' && index === 1
      ? { ...draft, desiredQuantity: '0' }
      : draft,
  )
  newLines.value = state === 'stable' || state === 'mobile'
    ? createOrderProductFixtureEditorLines('TWD').slice(0, 1)
    : []
  reason.value = '客户调整产品'
  lastEvent.value = `state · ${state}`
}

function openModal(): void {
  selectState(selectedState.value)
  visible.value = true
  lastEvent.value = `open · ${selectedState.value}`
}
</script>

<template>
  <section class="p-5 border border-border rounded-xl bg-background sm:p-7" aria-label="销售订单产品修改弹窗示例">
    <div class="flex flex-wrap gap-4 items-start justify-between">
      <div>
        <span class="text-xs text-primary tracking-[0.16em] font-semibold">纯业务弹窗</span>
        <h3 class="text-xl font-semibold m-0 mt-2">
          海运前销售产品修改
        </h3>
        <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
          验收采购锁定、数量增减、产品新增、金额预览和定金下调加强确认。
        </p>
      </div>
      <FaTag variant="secondary">
        QsSalesOrderProductsEditorModal
      </FaTag>
    </div>

    <div class="mt-6 gap-2 grid grid-cols-2 lg:grid-cols-5 sm:grid-cols-3">
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
        <FaIcon name="i-lucide:list-restart" class="size-4" aria-hidden="true" />
        打开修改产品弹窗
      </FaButton>
    </div>

    <QsSalesOrderProductsEditorModal
      v-model="visible"
      v-model:reason="reason"
      :existing-line-drafts="existingLineDrafts"
      :new-lines="newLines"
      :context="context"
      :currencies="ORDER_PRODUCT_FIXTURE_CURRENCIES"
      :load-products="loader"
      :loading="loading"
      :error="error"
      @update:existing-line-drafts="existingLineDrafts = $event"
      @update:new-lines="newLines = $event"
      @validation-error="lastEvent = `validation · ${$event}`"
      @review="lastEvent = `review · ${$event.newLines.length} 项新增`"
      @confirm="lastEvent = `confirm · v${$event.expectedVersion}`"
      @cancel="lastEvent = 'cancel'"
      @retry="selectState('stable')"
    />
  </section>
</template>
