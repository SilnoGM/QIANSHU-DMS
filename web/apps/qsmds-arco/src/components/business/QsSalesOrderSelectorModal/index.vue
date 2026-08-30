<script setup lang="ts">
import type {
  SalesOrderSelectorItem,
  SalesOrderSelectorPageChange,
} from './types'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  formatSalesOrderAmount,
  formatSalesOrderLineCount,
  formatSalesOrderQuantity,
  getSalesOrderFulfillmentStatusMeta,
  getSalesOrderPaymentStatusMeta,
  normalizeSalesOrderSelectorKeyword,
  resolveSalesOrderSelection,
  resolveSelectorPagination,
} from './logic'

defineOptions({ name: 'QsSalesOrderSelectorModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  items: readonly SalesOrderSelectorItem[]
  selectedOrderId?: string | null
  keyword?: string
  page?: number
  pageSize?: number
  total?: number
  loading?: boolean
  error?: string | null
  disabled?: boolean
  submitting?: boolean
}>(), {
  selectedOrderId: null,
  keyword: '',
  page: 1,
  pageSize: 20,
  total: 0,
  loading: false,
  error: null,
  disabled: false,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': [item: SalesOrderSelectorItem]
  'pageChange': [payload: SalesOrderSelectorPageChange]
  'retry': []
  'search': [keyword: string]
  'select': [item: SalesOrderSelectorItem]
  'update:keyword': [keyword: string]
  'update:modelValue': [value: boolean]
  'update:selectedOrderId': [value: string | null]
}>()

const keywordDraft = ref(props.keyword)
const selectedOrderIdDraft = ref<string | null>(props.selectedOrderId)

/**
 * 调用方仍应在服务端查询“已确认”数据；组件再次过滤是公共复用边界的最后防线，
 * 防止待对账、已完成、已取消或草稿订单因缓存或组合数据误入候选列表。
 */
const eligibleItems = computed(() => props.items.filter(
  item => item.orderStatus === 'CONFIRMED',
))
const selectedOrder = computed(() => resolveSalesOrderSelection(
  eligibleItems.value,
  selectedOrderIdDraft.value,
))
const pagination = computed(() => resolveSelectorPagination({
  page: props.page,
  pageSize: props.pageSize,
  total: props.total,
}))

function selectOrder(item: SalesOrderSelectorItem): void {
  if (props.disabled || props.loading || props.error) {
    return
  }

  selectedOrderIdDraft.value = item.id
  emit('update:selectedOrderId', item.id)
  emit('select', item)
}

function search(): void {
  const keyword = normalizeSalesOrderSelectorKeyword(keywordDraft.value)
  keywordDraft.value = keyword
  emit('update:keyword', keyword)
  emit('search', keyword)
}

function changePage(page: number): void {
  emit('pageChange', {
    page,
    pageSize: pagination.value.pageSize,
  })
}

function changePageSize(pageSize: number): void {
  emit('pageChange', {
    page: 1,
    pageSize,
  })
}

function closeAsCancel(): void {
  emit('cancel')
  emit('update:modelValue', false)
}

function handleModalVisibility(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }

  closeAsCancel()
}

function confirmSelection(): void {
  if (!selectedOrder.value || props.disabled || props.loading || props.error) {
    return
  }

  emit('confirm', selectedOrder.value)
  emit('update:modelValue', false)
}

watch(() => props.keyword, (value) => {
  keywordDraft.value = value
})

watch(() => props.selectedOrderId, (value) => {
  selectedOrderIdDraft.value = value
})

watch(() => props.modelValue, (open) => {
  if (!open) {
    return
  }

  keywordDraft.value = props.keyword
  selectedOrderIdDraft.value = props.selectedOrderId
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="选择销售订单"
    description="选择一张已确认且仍在履约中的销售订单。"
    size="xl"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="handleModalVisibility"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:receipt-text" class="size-4" aria-hidden="true" />
    </template>

    <div
      data-slot="sales-order-selector-body"
      class="max-h-[min(36rem,calc(100dvh-13.5rem))] min-w-0 overflow-x-hidden overflow-y-auto"
    >
      <div class="pb-4 border-b border-border/70 gap-3 grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <form class="flex gap-2 min-w-0" role="search" @submit.prevent="search">
          <FaInput
            v-model="keywordDraft"
            class="flex-1 min-w-0"
            placeholder="搜索销售订单号或客户名"
            aria-label="搜索销售订单号或客户名"
            :disabled="disabled || loading"
          />
          <FaButton
            type="submit"
            variant="outline"
            class="px-0 shrink-0 size-11 sm:px-4 sm:size-auto"
            :disabled="disabled || loading"
            aria-label="搜索销售订单"
          >
            <FaIcon name="i-lucide:search" class="size-4" aria-hidden="true" />
            <span class="hidden sm:inline">搜索</span>
          </FaButton>
        </form>

        <div class="flex flex-wrap gap-2 items-center sm:justify-end">
          <FaTag variant="outline" class="text-primary qs-type-status-tag border-primary/30 bg-primary/5">
            订单状态：已确认
          </FaTag>
          <span class="qs-type-meta text-muted-foreground">
            共 {{ pagination.total }} 张
          </span>
        </div>
      </div>

      <div class="pt-4 min-h-80">
        <div
          v-if="loading"
          class="gap-3 grid"
          role="status"
          aria-live="polite"
        >
          <span class="sr-only">正在加载符合条件的销售订单</span>
          <div
            v-for="index in 4"
            :key="index"
            class="p-4 border border-border rounded-lg bg-background gap-3 grid sm:grid-cols-[1.3fr_1fr_0.75fr_1fr_0.9fr]"
            aria-hidden="true"
          >
            <div class="rounded bg-muted h-5 animate-pulse" />
            <div class="rounded bg-muted h-5 animate-pulse" />
            <div class="rounded bg-muted h-5 animate-pulse" />
            <div class="rounded bg-muted h-5 animate-pulse" />
            <div class="rounded bg-muted h-5 animate-pulse" />
          </div>
        </div>

        <div
          v-else-if="error"
          class="py-12 text-center flex flex-col items-center"
          role="alert"
        >
          <span class="text-destructive rounded-lg bg-destructive/10 flex size-11 items-center justify-center">
            <FaIcon name="i-lucide:circle-alert" class="size-5" aria-hidden="true" />
          </span>
          <h3 class="text-base font-semibold m-0 mt-4">
            销售订单加载失败
          </h3>
          <p class="text-sm text-muted-foreground m-0 mt-2 max-w-md">
            {{ error }}
          </p>
          <FaButton type="button" variant="outline" class="mt-5" @click="emit('retry')">
            <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
            重新加载
          </FaButton>
        </div>

        <FaEmpty
          v-else-if="eligibleItems.length === 0"
          icon="i-lucide:search-x"
          title="没有符合条件的销售订单"
          description="请调整销售订单号或客户名后重新搜索。"
          class="py-12"
        />

        <template v-else>
          <div class="hidden sm:block" role="radiogroup" aria-label="销售订单候选列表">
            <div class="text-xs text-muted-foreground px-4 pb-2 gap-4 grid grid-cols-[1.35fr_1fr_0.75fr_1fr_0.9fr]">
              <span>销售订单</span>
              <span>客户 / 出单人</span>
              <span>产品明细</span>
              <span class="text-end">约定总价</span>
              <span class="text-end">订单状态</span>
            </div>
            <button
              v-for="item in eligibleItems"
              :key="item.id"
              type="button"
              role="radio"
              :aria-checked="selectedOrderIdDraft === item.id"
              class="p-4 text-start border rounded-lg bg-background gap-4 grid grid-cols-[1.35fr_1fr_0.75fr_1fr_0.9fr] min-w-0 w-full transition-colors items-center [&+&]:mt-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              :class="selectedOrderIdDraft === item.id
                ? 'border-primary bg-primary/[0.035] ring-1 ring-primary/20'
                : 'border-border hover:border-primary/50'"
              :disabled="disabled"
              @click="selectOrder(item)"
            >
              <span class="flex gap-3 min-w-0 items-center">
                <span
                  class="border-2 rounded-full flex shrink-0 size-4 items-center justify-center"
                  :class="selectedOrderIdDraft === item.id ? 'border-primary' : 'border-muted-foreground/50'"
                  aria-hidden="true"
                >
                  <span v-if="selectedOrderIdDraft === item.id" class="rounded-full bg-primary size-2" />
                </span>
                <span class="min-w-0">
                  <strong class="qs-type-data-emphasis font-mono block break-all">{{ item.orderNo }}</strong>
                  <span class="qs-type-meta text-muted-foreground mt-1 block">{{ item.orderDate }}</span>
                </span>
              </span>
              <span class="min-w-0">
                <strong class="qs-type-body-medium block truncate">{{ item.customerName }}</strong>
                <span class="qs-type-meta text-muted-foreground mt-1 block truncate">{{ item.issuer.displayName }}</span>
              </span>
              <span class="min-w-0">
                <strong class="qs-type-body-medium block">{{ formatSalesOrderLineCount(item.lineSummary.lineCount) }}</strong>
                <span class="qs-type-meta text-muted-foreground mt-1 block">{{ formatSalesOrderQuantity(item.lineSummary.totalQuantity) }}</span>
              </span>
              <strong class="qs-type-data-emphasis font-mono text-end break-words">
                {{ formatSalesOrderAmount(item.agreedTotalAmount, item.currencyCode) }}
              </strong>
              <span class="flex flex-col gap-1.5 min-w-0 items-end">
                <FaTag variant="outline" class="qs-type-status-tag" :class="getSalesOrderFulfillmentStatusMeta(item.fulfillmentStatus).className">
                  {{ getSalesOrderFulfillmentStatusMeta(item.fulfillmentStatus).label }}
                </FaTag>
                <FaTag variant="outline" class="qs-type-status-tag" :class="getSalesOrderPaymentStatusMeta(item.paymentStatus).className">
                  {{ getSalesOrderPaymentStatusMeta(item.paymentStatus).label }}
                </FaTag>
              </span>
            </button>
          </div>

          <div class="gap-3 grid sm:hidden" role="radiogroup" aria-label="销售订单候选列表">
            <button
              v-for="item in eligibleItems"
              :key="item.id"
              type="button"
              role="radio"
              :aria-checked="selectedOrderIdDraft === item.id"
              class="p-4 text-start border rounded-lg bg-background min-w-0 w-full transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              :class="selectedOrderIdDraft === item.id
                ? 'border-primary bg-primary/[0.035] ring-1 ring-primary/20'
                : 'border-border'"
              :disabled="disabled"
              @click="selectOrder(item)"
            >
              <span class="flex gap-3 min-w-0 items-start">
                <span
                  class="mt-1 border-2 rounded-full flex shrink-0 size-4 items-center justify-center"
                  :class="selectedOrderIdDraft === item.id ? 'border-primary' : 'border-muted-foreground/50'"
                  aria-hidden="true"
                >
                  <span v-if="selectedOrderIdDraft === item.id" class="rounded-full bg-primary size-2" />
                </span>
                <span class="flex-1 min-w-0">
                  <strong class="qs-type-data-emphasis font-mono block break-all">{{ item.orderNo }}</strong>
                  <span class="qs-type-meta text-muted-foreground mt-1 block">{{ item.orderDate }}</span>
                </span>
                <strong class="qs-type-data-emphasis font-mono text-end max-w-[9rem] break-words">
                  {{ formatSalesOrderAmount(item.agreedTotalAmount, item.currencyCode) }}
                </strong>
              </span>
              <span class="mt-4 gap-3 grid grid-cols-2">
                <span class="min-w-0">
                  <span class="qs-type-meta text-muted-foreground block">客户 / 出单人</span>
                  <strong class="qs-type-body-medium mt-1 block truncate">{{ item.customerName }}</strong>
                  <span class="qs-type-meta text-muted-foreground block truncate">{{ item.issuer.displayName }}</span>
                </span>
                <span>
                  <span class="qs-type-meta text-muted-foreground block">产品明细</span>
                  <strong class="qs-type-body-medium mt-1 block">{{ formatSalesOrderLineCount(item.lineSummary.lineCount) }}</strong>
                  <span class="qs-type-meta text-muted-foreground block">{{ formatSalesOrderQuantity(item.lineSummary.totalQuantity) }}</span>
                </span>
              </span>
              <span class="mt-4 pt-3 border-t border-border/70 flex flex-col gap-1.5 items-end">
                <FaTag variant="outline" class="qs-type-status-tag" :class="getSalesOrderFulfillmentStatusMeta(item.fulfillmentStatus).className">
                  {{ getSalesOrderFulfillmentStatusMeta(item.fulfillmentStatus).label }}
                </FaTag>
                <FaTag variant="outline" class="qs-type-status-tag" :class="getSalesOrderPaymentStatusMeta(item.paymentStatus).className">
                  {{ getSalesOrderPaymentStatusMeta(item.paymentStatus).label }}
                </FaTag>
              </span>
            </button>
          </div>

          <div class="mt-4 pt-4 border-t border-border/70 gap-3 grid sm:grid-cols-[1fr_auto] sm:items-center">
            <span class="qs-type-meta text-muted-foreground">
              显示 {{ pagination.rangeStart }}–{{ pagination.rangeEnd }}，共 {{ pagination.total }} 张
            </span>
            <FaPagination
              :page="pagination.page"
              :size="pagination.pageSize"
              :sizes="[20, 50, 100]"
              :total="pagination.total"
              layout="pager, sizes"
              class="min-w-max hidden sm:flex"
              @update:page="changePage"
              @update:size="changePageSize"
            />
            <div class="flex gap-2 sm:hidden">
              <FaButton
                type="button"
                variant="outline"
                class="flex-1 size-11"
                :disabled="pagination.page <= 1"
                @click="changePage(pagination.page - 1)"
              >
                上一页
              </FaButton>
              <FaButton
                type="button"
                variant="outline"
                class="flex-1 size-11"
                :disabled="pagination.page >= pagination.pageCount"
                @click="changePage(pagination.page + 1)"
              >
                下一页
              </FaButton>
            </div>
          </div>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2 w-full sm:pb-0 sm:flex-row sm:items-center">
        <p class="qs-type-meta text-muted-foreground m-0 flex-1 min-w-0 truncate">
          {{ selectedOrder ? `已选择：${selectedOrder.orderNo} · ${selectedOrder.customerName}` : '请选择一张销售订单' }}
        </p>
        <FaButton type="button" variant="outline" class="h-11 sm:h-9 sm:order-1" :disabled="submitting" @click="closeAsCancel">
          取消
        </FaButton>
        <FaButton
          type="button"
          class="h-11 sm:h-9 sm:order-2"
          :loading="submitting"
          :disabled="!selectedOrder || disabled || loading || Boolean(error)"
          @click="confirmSelection"
        >
          确认选择
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
