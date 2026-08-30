<script setup lang="ts">
import type {
  PurchaseOrderSourceSalesOrderListItemDto,
  PurchaseOrderSourceSalesOrdersDto,
} from '@/api/generated/types.gen'
import type {
  SalesOrderSelectorItem,
  SalesOrderSelectorPageChange,
} from '@/components/business/QsSalesOrderSelectorModal/types'

import QsSalesOrderSelectorModal from '@/components/business/QsSalesOrderSelectorModal/index.vue'

defineOptions({ name: 'PurchaseSourceSalesOrderSelector' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
  selectedOrderId?: string | null
  loadSalesOrders: (
    query: { keyword?: string, page: number, pageSize: number },
    signal: AbortSignal,
  ) => Promise<PurchaseOrderSourceSalesOrdersDto>
}>(), {
  disabled: false,
  selectedOrderId: null,
})

const emit = defineEmits<{
  'confirm': [item: PurchaseOrderSourceSalesOrderListItemDto]
  'update:modelValue': [value: boolean]
}>()

const keyword = ref('')
const items = ref<PurchaseOrderSourceSalesOrderListItemDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
let requestVersion = 0
let controller: AbortController | null = null

function reset(): void {
  controller?.abort()
  controller = null
  requestVersion += 1
  keyword.value = ''
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
    }, nextController.signal)
    if (nextController.signal.aborted || version !== requestVersion) {
      return
    }
    items.value = result.items
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

function confirmSelection(item: SalesOrderSelectorItem): void {
  if (props.disabled) {
    return
  }
  // 公共组件只暴露业务中立的最小类型；回传采购表单时必须取回当前请求中的
  // 原始 DTO，避免通过类型断言伪造采购域字段或接受已经被新请求替换的旧对象。
  const sourceItem = items.value.find(candidate => candidate.id === item.id)
  if (sourceItem !== undefined) {
    emit('confirm', sourceItem)
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
    :selected-order-id="selectedOrderId"
    :keyword="keyword"
    :page="page"
    :page-size="pageSize"
    :total="total"
    :loading="loading"
    :error="errorMessage"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
    @update:keyword="handleKeywordUpdate"
    @search="handleSearch"
    @page-change="handlePageChange"
    @retry="loadPage"
    @confirm="confirmSelection"
  />
</template>
