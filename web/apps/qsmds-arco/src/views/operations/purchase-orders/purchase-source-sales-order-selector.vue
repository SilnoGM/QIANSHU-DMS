<script setup lang="ts">
import type {
  PurchaseOrderSourceSalesOrderListItemDto,
  PurchaseOrderSourceSalesOrdersDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'PurchaseSourceSalesOrderSelector' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
  loadSalesOrders: (
    query: { keyword?: string, page: number, pageSize: number },
    signal: AbortSignal,
  ) => Promise<PurchaseOrderSourceSalesOrdersDto>
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'confirm': [item: PurchaseOrderSourceSalesOrderListItemDto]
  'update:modelValue': [value: boolean]
}>()

const keywordDraft = ref('')
const appliedKeyword = ref('')
const items = ref<PurchaseOrderSourceSalesOrderListItemDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')
let requestVersion = 0
let controller: AbortController | null = null

function reset(): void {
  controller?.abort()
  controller = null
  requestVersion += 1
  keywordDraft.value = ''
  appliedKeyword.value = ''
  items.value = []
  page.value = 1
  total.value = 0
  loading.value = false
  errorMessage.value = ''
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
  errorMessage.value = ''
  try {
    const result = await props.loadSalesOrders({
      ...(appliedKeyword.value === '' ? {} : { keyword: appliedKeyword.value }),
      page: page.value,
      pageSize: pageSize.value,
    }, nextController.signal)
    if (nextController.signal.aborted || version !== requestVersion) {
      return
    }
    items.value = result.items
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

function applyKeyword(): void {
  const normalized = keywordDraft.value.trim().normalize('NFKC')
  if (normalized === appliedKeyword.value && page.value === 1) {
    return
  }
  appliedKeyword.value = normalized
  page.value = 1
  void loadPage()
}

function handlePageChange(): void {
  void loadPage()
}

function selectItem(item: PurchaseOrderSourceSalesOrderListItemDto): void {
  if (props.disabled) {
    return
  }
  emit('confirm', { ...item })
  emit('update:modelValue', false)
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
  <QsGenericModal
    :model-value="modelValue"
    title="选择销售订单"
    description="只显示可用于采购同步的已确认销售订单。选择后将读取其剩余可采购明细。"
    size="xl"
    class="sm:!max-w-[64rem]"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="mb-4 flex gap-2">
      <FaInput
        v-model="keywordDraft"
        placeholder="搜索销售订单号或客户名"
        aria-label="搜索销售订单号或客户名"
        :disabled="disabled"
        @keydown.enter.prevent="applyKeyword"
      />
      <FaButton type="button" variant="outline" :disabled="disabled" @click="applyKeyword">
        <FaIcon name="i-lucide:search" aria-hidden="true" />搜索
      </FaButton>
    </div>

    <div class="min-h-80">
      <div v-if="loading" class="gap-3 grid" role="status" aria-label="正在加载销售订单">
        <div v-for="index in 4" :key="index" class="p-4 border border-border rounded-xl">
          <div class="rounded bg-muted h-5 w-1/3 animate-pulse" />
          <div class="mt-3 rounded bg-muted h-4 w-2/3 animate-pulse" />
        </div>
      </div>
      <FaAlert
        v-else-if="errorMessage"
        title="销售订单加载失败"
        :description="errorMessage"
        variant="destructive"
      >
        <template #actions>
          <FaButton type="button" variant="outline" size="sm" @click="loadPage">
            重新加载
          </FaButton>
        </template>
      </FaAlert>
      <FaEmpty
        v-else-if="items.length === 0"
        icon="i-lucide:search-x"
        title="没有可同步的销售订单"
        description="请调整订单号或客户名后重试。"
        class="py-14"
      />
      <div v-else class="gap-3 grid md:grid-cols-2">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="p-4 text-left border border-border rounded-xl bg-background min-w-0 transition-colors focus-visible:outline-none hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/40"
          :disabled="disabled"
          @click="selectItem(item)"
        >
          <div class="flex gap-3 items-start justify-between">
            <span class="qs-type-data-emphasis font-mono break-all">{{ item.orderNo }}</span>
            <span class="qs-type-meta shrink-0">{{ item.orderDate }}</span>
          </div>
          <p class="font-medium m-0 mt-3 truncate">
            {{ item.customerName }}
          </p>
          <p class="qs-type-meta m-0 mt-3">
            选择后同步剩余可采购产品；销售币种不写入采购订单。
          </p>
        </button>
      </div>
    </div>

    <FaPagination
      v-if="total > 0"
      v-model:page="page"
      v-model:size="pageSize"
      :sizes="[20, 50, 100]"
      :total="total"
      layout="pager, sizes, ->, total"
      class="mt-4 min-w-max"
      @update:page="handlePageChange"
      @update:size="handlePageChange"
    />
  </QsGenericModal>
</template>
