<script setup lang="ts">
import type { SalesOrderSelectorItem } from '@/components/business/QsSalesOrderSelectorModal/types'
import QsSalesOrderSelectorModal from '@/components/business/QsSalesOrderSelectorModal/index.vue'

defineOptions({ name: 'SalesOrderSelectorModalShowcase' })

const stateValues = ['default', 'selected', 'loading', 'empty', 'error'] as const
type ShowcaseState = typeof stateValues[number]

const stateDefinitions: Record<ShowcaseState, {
  description: string
  icon: string
  label: string
}> = {
  default: {
    description: '桌面数据行与移动端卡片',
    icon: 'i-lucide:list-checks',
    label: '默认状态',
  },
  empty: {
    description: '没有符合条件的候选订单',
    icon: 'i-lucide:search-x',
    label: '空数据',
  },
  error: {
    description: '请求失败与重新加载入口',
    icon: 'i-lucide:circle-alert',
    label: '错误状态',
  },
  loading: {
    description: '稳定骨架与加载语义',
    icon: 'i-lucide:loader-circle',
    label: '加载状态',
  },
  selected: {
    description: '预置单选并启用显式确认',
    icon: 'i-lucide:circle-check-big',
    label: '已选择',
  },
}

const showcaseStates = stateValues.map(value => ({
  ...stateDefinitions[value],
  value,
}))

/**
 * Fixture 故意混入所有不合格状态，便于组件库直接证明公共组件的防御性过滤有效。
 * 数据固定在本文件内，不接业务接口、不读取 Store，也不会产生写入副作用。
 */
const fixtureItems: readonly SalesOrderSelectorItem[] = [
  {
    id: 'confirmed-1',
    orderNo: 'SO/20260830-00108',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-1', displayName: '余树' },
    currencyCode: 'TWD',
    customerName: '千航贸易（台北）有限公司',
    agreedTotalAmount: '180000.0000',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: { lineCount: 2, totalQuantity: 3 },
  },
  {
    id: 'confirmed-2',
    orderNo: 'SO/20260829-00107',
    orderDate: '2026-08-29',
    issuer: { id: 'issuer-2', displayName: '李昕' },
    currencyCode: 'MYR',
    customerName: 'GREEN TREE SDN. BHD.',
    agreedTotalAmount: '86500.5000',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: { lineCount: 4, totalQuantity: 12 },
  },
  {
    id: 'confirmed-3',
    orderNo: 'SO/20260828-00106',
    orderDate: '2026-08-28',
    issuer: { id: 'issuer-3', displayName: '孙伟' },
    currencyCode: 'TWD',
    customerName: '远山国际采购中心',
    agreedTotalAmount: '62000.0000',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SEA_TRANSIT',
    paymentStatus: 'PAID',
    lineSummary: { lineCount: 1, totalQuantity: 2 },
  },
  {
    id: 'confirmed-4',
    orderNo: 'SO/20260827-00105',
    orderDate: '2026-08-27',
    issuer: { id: 'issuer-4', displayName: '陈卓' },
    currencyCode: 'TWD',
    customerName: '山海空间设计有限公司',
    agreedTotalAmount: '328000.0000',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'WAREHOUSE_ARRIVED',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: { lineCount: 6, totalQuantity: 18 },
  },
  {
    id: 'draft',
    orderNo: 'SO/DRAFT',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    currencyCode: 'TWD',
    customerName: '草稿订单不应显示',
    agreedTotalAmount: '1.0000',
    orderStatus: 'DRAFT',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: { lineCount: 1, totalQuantity: 1 },
  },
  {
    id: 'reconciliation',
    orderNo: 'SO/RECONCILIATION',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    currencyCode: 'TWD',
    customerName: '待对账订单不应显示',
    agreedTotalAmount: '1.0000',
    orderStatus: 'PENDING_RECONCILIATION',
    fulfillmentStatus: 'SIGNED',
    paymentStatus: 'PAID',
    lineSummary: { lineCount: 1, totalQuantity: 1 },
  },
  {
    id: 'completed',
    orderNo: 'SO/COMPLETED',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    currencyCode: 'TWD',
    customerName: '已完成订单不应显示',
    agreedTotalAmount: '1.0000',
    orderStatus: 'COMPLETED',
    fulfillmentStatus: 'SIGNED',
    paymentStatus: 'PAID',
    lineSummary: { lineCount: 1, totalQuantity: 1 },
  },
  {
    id: 'cancelled',
    orderNo: 'SO/CANCELLED',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    currencyCode: 'TWD',
    customerName: '已取消订单不应显示',
    agreedTotalAmount: '1.0000',
    orderStatus: 'CANCELLED',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: { lineCount: 1, totalQuantity: 1 },
  },
]

const visible = ref(false)
const selectedState = ref<ShowcaseState>('default')
const selectedOrderId = ref<string | null>(null)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const lastEvent = ref('等待打开')

const modalItems = computed(() => selectedState.value === 'empty' ? [] : fixtureItems)
const modalLoading = computed(() => selectedState.value === 'loading')
const modalError = computed(() => selectedState.value === 'error'
  ? '暂时无法读取销售订单，请检查网络后重新加载。'
  : null)
const modalTotal = computed(() => selectedState.value === 'empty' ? 0 : 108)

function selectState(state: ShowcaseState): void {
  selectedState.value = state
  selectedOrderId.value = state === 'selected' ? 'confirmed-1' : null
  lastEvent.value = `state · ${state}`
}

function openModal(): void {
  visible.value = true
  lastEvent.value = `open · ${selectedState.value}`
}

function handleSearch(value: string): void {
  page.value = 1
  lastEvent.value = `search · ${value || '全部'}`
}

function handlePageChange(payload: { page: number, pageSize: number }): void {
  page.value = payload.page
  pageSize.value = payload.pageSize
  lastEvent.value = `page · ${payload.page}/${payload.pageSize}`
}

function handleConfirm(item: SalesOrderSelectorItem): void {
  lastEvent.value = `confirm · ${item.orderNo}`
}

function handleRetry(): void {
  selectedState.value = 'default'
  lastEvent.value = 'retry · 已恢复默认状态'
}
</script>

<template>
  <section aria-labelledby="sales-order-selector-modal-title">
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:list-checks" class="size-5" aria-hidden="true" />
            <span class="text-xs tracking-[0.16em] font-semibold">可复用业务选择器</span>
          </div>
          <h3 id="sales-order-selector-modal-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl">
            销售订单单选与显式确认
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            选择状态后打开弹窗，验收搜索、候选资格、桌面数据行、移动端卡片、分页与确认动作。示例只使用本地确定性数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsSalesOrderSelectorModal
        </FaTag>
      </div>

      <div class="mt-6 gap-5 grid lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <fieldset class="m-0 p-4 border border-border rounded-lg bg-muted/20 sm:p-5">
          <legend class="qs-type-compact-label px-1">
            内容状态
          </legend>
          <div class="gap-2 grid sm:grid-cols-2 xl:grid-cols-5">
            <button
              v-for="state in showcaseStates"
              :key="state.value"
              type="button"
              :data-testid="`sales-order-selector-state-${state.value}`"
              class="p-3 text-start border rounded-lg bg-background transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              :class="selectedState === state.value
                ? 'border-primary ring-1 ring-primary/20'
                : 'border-border hover:border-primary/40'"
              :aria-pressed="selectedState === state.value"
              @click="selectState(state.value)"
            >
              <span class="flex gap-2 items-center">
                <FaIcon :name="state.icon" class="text-primary size-4" aria-hidden="true" />
                <strong class="qs-type-body-medium">{{ state.label }}</strong>
              </span>
              <span class="qs-type-meta text-muted-foreground mt-1.5 block">{{ state.description }}</span>
            </button>
          </div>
        </fieldset>

        <aside class="p-4 border border-border rounded-lg bg-background flex flex-col sm:p-5">
          <span class="qs-type-compact-label text-muted-foreground">当前状态</span>
          <strong class="text-lg mt-2">
            {{ stateDefinitions[selectedState].label }}
          </strong>
          <p class="qs-type-meta text-muted-foreground m-0 mt-2 break-all">
            {{ lastEvent }}
          </p>
          <FaButton
            data-testid="sales-order-selector-trigger"
            class="mt-5 w-full"
            @click="openModal"
          >
            <FaIcon name="i-lucide:list-checks" class="size-4" aria-hidden="true" />
            打开选择销售订单弹窗
          </FaButton>
        </aside>
      </div>
    </div>

    <QsSalesOrderSelectorModal
      v-model="visible"
      v-model:keyword="keyword"
      v-model:selected-order-id="selectedOrderId"
      :items="modalItems"
      :page="page"
      :page-size="pageSize"
      :total="modalTotal"
      :loading="modalLoading"
      :error="modalError"
      @search="handleSearch"
      @page-change="handlePageChange"
      @select="lastEvent = `select · ${$event.orderNo}`"
      @confirm="handleConfirm"
      @cancel="lastEvent = 'cancel'"
      @retry="handleRetry"
    />
  </section>
</template>
