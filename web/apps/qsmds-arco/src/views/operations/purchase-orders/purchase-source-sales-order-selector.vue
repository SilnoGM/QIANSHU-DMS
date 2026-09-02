<script setup lang="ts">
import type { PurchaseSourceSalesOrderSelection } from './purchase-source-sales-order-selector.types'
import type {
  PurchaseOrderSourceSalesOrderListItemDto,
  PurchaseOrderSourceSalesOrdersDto,
} from '@/api/generated/types.gen'
import type { PurchaseOrderSourceSalesOrdersQuery } from '@/api/modules/purchase-orders'
import type {
  SalesOrderSelectorItem,
  SalesOrderSelectorPageChange,
} from '@/components/business/QsSalesOrderSelectorModal/types'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'

import QsSalesOrderSelectorModal from '@/components/business/QsSalesOrderSelectorModal/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'

type PurchaseSourceSalesOrderView = PurchaseOrderSourceSalesOrdersDto['view']

defineOptions({ name: 'PurchaseSourceSalesOrderSelector' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
  canAddSalesOrderProducts?: boolean
  selectedOrderId?: string | null
  loadSalesOrders: (
    query: PurchaseOrderSourceSalesOrdersQuery,
    signal: AbortSignal,
  ) => Promise<PurchaseOrderSourceSalesOrdersDto>
}>(), {
  disabled: false,
  canAddSalesOrderProducts: false,
  selectedOrderId: null,
})

const emit = defineEmits<{
  'confirm': [selection: PurchaseSourceSalesOrderSelection]
  'update:modelValue': [value: boolean]
}>()

const SOURCE_VIEW_ITEMS = [
  { value: 'UNPURCHASED', label: '未采购订单-采购' },
  { value: 'PARTIALLY_PURCHASED', label: '部分采购订单-采购' },
  { value: 'COMPLETED_PURCHASE_ADD_ON', label: '已完成采购-加购产品' },
] as const satisfies readonly QsStatusSwitchItem[]

function isPurchaseSourceSalesOrderView(
  value: string,
): value is PurchaseSourceSalesOrderView {
  return value === 'UNPURCHASED'
    || value === 'PARTIALLY_PURCHASED'
    || value === 'COMPLETED_PURCHASE_ADD_ON'
}

const keyword = ref('')
const selectedView = ref<PurchaseSourceSalesOrderView>('UNPURCHASED')
const counts = ref<PurchaseOrderSourceSalesOrdersDto['counts']>([])
const items = ref<PurchaseOrderSourceSalesOrderListItemDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const confirmText = computed(() => selectedView.value === 'COMPLETED_PURCHASE_ADD_ON'
  ? '加购产品'
  : '确认选择')
const confirmDisabled = computed(() => (
  selectedView.value === 'COMPLETED_PURCHASE_ADD_ON'
  && !props.canAddSalesOrderProducts
))
const confirmDisabledReason = computed(() => confirmDisabled.value
  ? '缺少销售订单修改权限，无法加购产品'
  : null)
let requestVersion = 0
let controller: AbortController | null = null
const viewItems = computed(() => withStatusSwitchCounts(
  SOURCE_VIEW_ITEMS,
  counts.value,
  {
    selectedValue: selectedView.value,
    selectedCount: total.value,
  },
))

function reset(): void {
  controller?.abort()
  controller = null
  requestVersion += 1
  keyword.value = ''
  selectedView.value = 'UNPURCHASED'
  counts.value = []
  items.value = []
  page.value = 1
  total.value = 0
  loading.value = false
  errorMessage.value = null
}

async function loadPage(): Promise<void> {
  if (props.disabled || !props.modelValue) {
    return
  }
  controller?.abort()
  const nextController = new AbortController()
  controller = nextController
  const version = ++requestVersion
  loading.value = true
  errorMessage.value = null
  try {
    const result = await props.loadSalesOrders({
      ...(keyword.value === '' ? {} : { keyword: keyword.value }),
      page: page.value,
      pageSize: pageSize.value,
      view: selectedView.value,
    }, nextController.signal)
    if (nextController.signal.aborted || version !== requestVersion) {
      return
    }
    items.value = result.items
    counts.value = result.counts
    page.value = result.page
    pageSize.value = result.pageSize
    total.value = result.total
  }
  catch {
    if (nextController.signal.aborted || version !== requestVersion) {
      return
    }
    errorMessage.value = '销售订单加载失败，请重试'
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      if (controller === nextController) {
        controller = null
      }
    }
  }
}

function handleSearch(value: string): void {
  keyword.value = value
  page.value = 1
  void loadPage()
}

function handleKeywordUpdate(value: string): void {
  keyword.value = value
}

function handlePageChange(payload: SalesOrderSelectorPageChange): void {
  page.value = payload.page
  pageSize.value = payload.pageSize
  void loadPage()
}

function handleViewChange(value: string): void {
  if (!isPurchaseSourceSalesOrderView(value) || value === selectedView.value) {
    return
  }
  selectedView.value = value
  page.value = 1
  // 上一个响应已经包含同一搜索条件下两个视图的可信计数；切换瞬间先使用目标
  // 计数校准工具栏和分页，避免把旧视图 total 短暂显示到新视图。
  total.value = counts.value.find(item => item.value === value)?.count ?? 0
  void loadPage()
}

function confirmSelection(item: SalesOrderSelectorItem): void {
  if (props.disabled) {
    return
  }
  // 公共组件只暴露业务中立的最小类型；回传采购表单时必须取回当前请求中的
  // 原始 DTO，避免通过类型断言伪造采购域字段或接受已经被新请求替换的旧对象。
  const sourceItem = items.value.find(candidate => candidate.id === item.id)
  if (sourceItem !== undefined) {
    emit('confirm', { item: sourceItem, view: selectedView.value })
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) {
    reset()
    return
  }
  reset()
  nextTick(() => void loadPage())
})

watch(() => props.disabled, (disabled) => {
  if (disabled && props.modelValue) {
    emit('update:modelValue', false)
  }
})

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <QsSalesOrderSelectorModal
    :model-value="modelValue"
    :items="items"
    :view="selectedView"
    :view-items="viewItems"
    :selected-order-id="selectedOrderId"
    :keyword="keyword"
    :page="page"
    :page-size="pageSize"
    :total="total"
    :loading="loading"
    :error="errorMessage"
    :disabled="disabled"
    :confirm-text="confirmText"
    :confirm-disabled="confirmDisabled"
    :confirm-disabled-reason="confirmDisabledReason"
    :close-on-confirm="selectedView !== 'COMPLETED_PURCHASE_ADD_ON'"
    @update:model-value="emit('update:modelValue', $event)"
    @update:keyword="handleKeywordUpdate"
    @search="handleSearch"
    @page-change="handlePageChange"
    @view-change="handleViewChange"
    @retry="loadPage"
    @confirm="confirmSelection"
  />
</template>
