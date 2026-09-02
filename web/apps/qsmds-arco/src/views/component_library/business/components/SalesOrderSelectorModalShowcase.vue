<script setup lang="ts">
import type { SalesOrderSelectorItem } from '@/components/business/QsSalesOrderSelectorModal/types'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import productDetail from '@/assets/images/component-library/image-group/product-detail.svg'
import productFront from '@/assets/images/component-library/image-group/product-front.svg'
import productLabel from '@/assets/images/component-library/image-group/product-label.svg'
import productSide from '@/assets/images/component-library/image-group/product-side.svg'
import QsSalesOrderSelectorModal from '@/components/business/QsSalesOrderSelectorModal/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'

defineOptions({ name: 'SalesOrderSelectorModalShowcase' })

const stateValues = ['default', 'selected', 'loading', 'empty', 'error'] as const
type ShowcaseState = typeof stateValues[number]
type ShowcaseView = 'UNPURCHASED' | 'PARTIALLY_PURCHASED' | 'COMPLETED_PURCHASE_ADD_ON'

const VIEW_ITEMS = [
  { value: 'UNPURCHASED', label: '未采购订单-采购' },
  { value: 'PARTIALLY_PURCHASED', label: '部分采购订单-采购' },
  { value: 'COMPLETED_PURCHASE_ADD_ON', label: '已完成采购-加购产品' },
] as const satisfies readonly QsStatusSwitchItem[]

function viewIncludesFulfillmentStatus(
  view: ShowcaseView,
  status: SalesOrderSelectorItem['fulfillmentStatus'],
): boolean {
  // 组件库使用履约状态把确定性 fixture 分到三个场景，只验证视图切换、计数与确认态；
  // 真实“采购记录/剩余数量”资格仍由采购域服务端查询负责。
  if (view === 'UNPURCHASED') {
    return status === 'PENDING'
  }
  if (view === 'PARTIALLY_PURCHASED') {
    return status === 'PREPARING'
  }
  return status === 'LAND_TRANSIT' || status === 'WAREHOUSE_ARRIVED'
}

function isShowcaseView(value: string): value is ShowcaseView {
  return value === 'UNPURCHASED'
    || value === 'PARTIALLY_PURCHASED'
    || value === 'COMPLETED_PURCHASE_ADD_ON'
}

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

function linePreview(
  lineId: string,
  productName: string,
  contentUrl: null | string = null,
): SalesOrderSelectorItem['lineSummary']['previews'][number] {
  return {
    lineId,
    productName,
    mainImage: contentUrl
      ? {
          id: `image-${lineId}`,
          contentUrl,
        }
      : null,
  }
}

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
    customerName: '千航贸易（台北）有限公司',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: {
      lineCount: 2,
      previews: [
        linePreview('confirmed-1-line-1', '千树标准组合柜', productFront),
        linePreview('confirmed-1-line-2', '本单临时包装服务'),
      ],
      totalQuantity: 3,
    },
  },
  {
    id: 'confirmed-2',
    orderNo: 'SO/20260829-00107',
    orderDate: '2026-08-29',
    issuer: { id: 'issuer-2', displayName: '李昕' },
    customerName: 'GREEN TREE SDN. BHD.',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: {
      lineCount: 4,
      previews: [
        linePreview('confirmed-2-line-1', '城市旅行收纳包', productFront),
        linePreview('confirmed-2-line-2', '墨蓝中号旅行收纳包', productSide),
        linePreview('confirmed-2-line-3', '沙棕大号旅行收纳包', productLabel),
        linePreview('confirmed-2-line-4', '本单临时安装服务'),
      ],
      totalQuantity: 12,
    },
  },
  {
    id: 'confirmed-3',
    orderNo: 'SO/20260828-00106',
    orderDate: '2026-08-28',
    issuer: { id: 'issuer-3', displayName: '孙伟' },
    customerName: '远山国际采购中心',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SEA_TRANSIT',
    paymentStatus: 'PAID',
    lineSummary: {
      lineCount: 1,
      previews: [
        linePreview('confirmed-3-line-1', '通勤分区收纳包', productDetail),
      ],
      totalQuantity: 2,
    },
  },
  {
    id: 'confirmed-4',
    orderNo: 'SO/20260827-00105',
    orderDate: '2026-08-27',
    issuer: { id: 'issuer-4', displayName: '陈卓' },
    customerName: '山海空间设计有限公司',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'WAREHOUSE_ARRIVED',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: {
      lineCount: 6,
      previews: [
        linePreview('confirmed-4-line-1', '千树标准组合柜', productFront),
        linePreview('confirmed-4-line-2', '墨蓝中号旅行收纳包', productSide),
        linePreview('confirmed-4-line-3', '沙棕大号旅行收纳包', productLabel),
        linePreview('confirmed-4-line-4', '通勤分区收纳包', productDetail),
        linePreview('confirmed-4-line-5', '订单专用包装服务'),
        linePreview('confirmed-4-line-6', '现场安装服务'),
      ],
      totalQuantity: 18,
    },
  },
  {
    id: 'draft',
    orderNo: 'SO/DRAFT',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    customerName: '草稿订单不应显示',
    orderStatus: 'DRAFT',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: {
      lineCount: 1,
      previews: [linePreview('draft-line-1', '草稿产品')],
      totalQuantity: 1,
    },
  },
  {
    id: 'reconciliation',
    orderNo: 'SO/RECONCILIATION',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    customerName: '待对账订单不应显示',
    orderStatus: 'PENDING_RECONCILIATION',
    fulfillmentStatus: 'SIGNED',
    paymentStatus: 'PAID',
    lineSummary: {
      lineCount: 1,
      previews: [linePreview('reconciliation-line-1', '待对账产品')],
      totalQuantity: 1,
    },
  },
  {
    id: 'completed',
    orderNo: 'SO/COMPLETED',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    customerName: '已完成订单不应显示',
    orderStatus: 'COMPLETED',
    fulfillmentStatus: 'SIGNED',
    paymentStatus: 'PAID',
    lineSummary: {
      lineCount: 1,
      previews: [linePreview('completed-line-1', '已完成产品')],
      totalQuantity: 1,
    },
  },
  {
    id: 'cancelled',
    orderNo: 'SO/CANCELLED',
    orderDate: '2026-08-30',
    issuer: { id: 'issuer-hidden', displayName: '隐藏数据' },
    customerName: '已取消订单不应显示',
    orderStatus: 'CANCELLED',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    lineSummary: {
      lineCount: 1,
      previews: [linePreview('cancelled-line-1', '已取消产品')],
      totalQuantity: 1,
    },
  },
]

const visible = ref(false)
const selectedState = ref<ShowcaseState>('default')
const selectedView = ref<ShowcaseView>('UNPURCHASED')
const selectedOrderId = ref<string | null>(null)
const canAddSalesOrderProducts = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const lastEvent = ref('等待打开')

const eligibleFixtureItems = computed(() => fixtureItems.filter(item => (
  item.orderStatus === 'CONFIRMED'
  && viewIncludesFulfillmentStatus(selectedView.value, item.fulfillmentStatus)
)))
const modalItems = computed(() => selectedState.value === 'empty' ? [] : eligibleFixtureItems.value)
const modalLoading = computed(() => selectedState.value === 'loading')
const modalError = computed(() => selectedState.value === 'error'
  ? '暂时无法读取销售订单，请检查网络后重新加载。'
  : null)
const modalTotal = computed(() => selectedState.value === 'empty' ? 0 : 108)
const confirmText = computed(() => selectedView.value === 'COMPLETED_PURCHASE_ADD_ON'
  ? '加购产品'
  : '确认选择')
const confirmDisabled = computed(() => (
  selectedView.value === 'COMPLETED_PURCHASE_ADD_ON'
  && !canAddSalesOrderProducts.value
))
const confirmDisabledReason = computed(() => confirmDisabled.value
  ? '缺少销售订单修改权限，无法加购产品'
  : null)
const viewItems = computed(() => withStatusSwitchCounts(
  VIEW_ITEMS,
  VIEW_ITEMS.map(item => ({
    value: item.value,
    count: fixtureItems.filter(candidate => (
      candidate.orderStatus === 'CONFIRMED'
      && viewIncludesFulfillmentStatus(item.value, candidate.fulfillmentStatus)
    )).length,
  })),
  { selectedValue: selectedView.value, selectedCount: modalTotal.value },
))

function selectState(state: ShowcaseState): void {
  selectedState.value = state
  selectedView.value = state === 'selected'
    ? 'PARTIALLY_PURCHASED'
    : 'UNPURCHASED'
  selectedOrderId.value = state === 'selected' ? 'confirmed-1' : null
  lastEvent.value = `state · ${state}`
}

function handleViewChange(value: string): void {
  if (!isShowcaseView(value)) {
    return
  }
  selectedView.value = value
  selectedOrderId.value = null
  page.value = 1
  lastEvent.value = `view · ${value}`
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
          <label class="qs-type-meta mt-4 flex gap-2 items-center">
            <input v-model="canAddSalesOrderProducts" type="checkbox">
            具备销售订单修改权限
          </label>
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
      :view="selectedView"
      :view-items="viewItems"
      :items="modalItems"
      :page="page"
      :page-size="pageSize"
      :total="modalTotal"
      :loading="modalLoading"
      :error="modalError"
      :confirm-text="confirmText"
      :confirm-disabled="confirmDisabled"
      :confirm-disabled-reason="confirmDisabledReason"
      :close-on-confirm="selectedView !== 'COMPLETED_PURCHASE_ADD_ON'"
      @search="handleSearch"
      @page-change="handlePageChange"
      @view-change="handleViewChange"
      @select="lastEvent = `select · ${$event.orderNo}`"
      @confirm="handleConfirm"
      @cancel="lastEvent = 'cancel'"
      @retry="handleRetry"
    />
  </section>
</template>
