<script setup lang="ts">
import type {
  ExistingCatalogLine,
  ProductIncrementCandidate,
  ProductPageLoader,
  ProductSelectionChange,
  ProductSelectorCurrency,
  ProductSelectorItem,
} from './types'

import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import QsGenericModal from '../QsGenericModal/index.vue'
import {
  canApplyProductSelectorResponse,
  confirmProductIncrement,
  createExistingCatalogLineIndex,
  createProductSelectorQueryKey,
  createSelectedProductItems,
  mergeProductSelectorItems,
  normalizeProductSelectorKeyword,
  removeProductFromSession,
  selectProductForSession,
} from './logic'

defineOptions({ name: 'QsProductSelector' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  currency: ProductSelectorCurrency
  existingLines: readonly ExistingCatalogLine[]
  loadProducts: ProductPageLoader
  disabled?: boolean
  pageSize?: number
}>(), {
  disabled: false,
  pageSize: 20,
})

const emit = defineEmits<{
  'confirm': [changes: readonly ProductSelectionChange[]]
  'update:modelValue': [value: boolean]
}>()

// FaSelect 底层保留空字符串用于清空状态，不能把它作为 SelectItem 的 value。
// 字典供应商值均为字符串，因此使用数值 0 作为仅限当前选择器 UI 的“全部”哨兵，不会与真实字典值冲突。
const ALL_SUPPLIERS_OPTION_VALUE = 0 as const

const supplierCatalog = useDictionaryCatalog('service_provider.supplier')
const keywordDraft = ref('')
const appliedKeyword = ref('')
const supplierValue = ref<string>()
const items = shallowRef<readonly ProductSelectorItem[]>([])
const changes = shallowRef<readonly ProductSelectionChange[]>([])
const page = ref(0)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const productError = ref('')
const pageError = ref('')
const incrementProductId = ref<string | null>(null)
const incrementCandidate = shallowRef<ProductIncrementCandidate | null>(null)
const failedImages = shallowRef<ReadonlySet<string>>(new Set())
let requestVersion = 0
let activeQueryKey = ''
let activeController: AbortController | null = null
let keywordTimer: ReturnType<typeof setTimeout> | undefined

const existingByProductId = computed(() => (
  createExistingCatalogLineIndex(props.existingLines)
))
const selectedItems = computed(() => createSelectedProductItems(
  props.existingLines,
  changes.value,
))
const selectedByProductId = computed(() => new Map(selectedItems.value.map(item => (
  [item.productId, item]
))))
const supplierOptions = computed(() => [{ label: '全部供应商', value: ALL_SUPPLIERS_OPTION_VALUE }, ...(
  supplierCatalog.catalog.value?.items ?? []
).map(item => ({
  label: item.effectiveEnabled ? item.label : `${item.label}（已停用）`,
  value: item.value,
}))])
const hasNextPage = computed(() => items.value.length < total.value)

function clearKeywordTimer(): void {
  if (keywordTimer !== undefined) {
    clearTimeout(keywordTimer)
    keywordTimer = undefined
  }
}

function resetSession(): void {
  clearKeywordTimer()
  activeController?.abort()
  activeController = null
  requestVersion += 1
  keywordDraft.value = ''
  appliedKeyword.value = ''
  supplierValue.value = undefined
  items.value = []
  changes.value = []
  page.value = 0
  total.value = 0
  loading.value = false
  loadingMore.value = false
  productError.value = ''
  pageError.value = ''
  incrementProductId.value = null
  incrementCandidate.value = null
  failedImages.value = new Set()
}

/**
 * 币种或权限状态变化后，当前候选与待处理选择不再可信；必须整段清空并关闭，
 * 由调用方在新上下文中重新打开选择器，避免跨币种或失效权限继续确认。
 */
function closeUntrustedSession(): void {
  if (!props.modelValue) {
    return
  }
  resetSession()
  emit('update:modelValue', false)
}

async function loadPage(targetPage: number, replace: boolean): Promise<void> {
  // 全量替换请求代表筛选条件已变化，必须允许它主动中止旧请求；
  // 只有追加分页请求需要被当前加载状态拦截，避免重复拉取同一页。
  if (props.disabled || (!replace && (loading.value || loadingMore.value))) {
    return
  }
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const query = {
    currencyCode: props.currency,
    ...(appliedKeyword.value === '' ? {} : { keyword: appliedKeyword.value }),
    ...(supplierValue.value === undefined ? {} : { supplierValue: supplierValue.value }),
    page: targetPage,
    pageSize: props.pageSize,
  } as const
  const queryKey = createProductSelectorQueryKey(query)
  const version = ++requestVersion
  activeQueryKey = queryKey
  if (replace) {
    loading.value = true
    productError.value = ''
    pageError.value = ''
  }
  else {
    loadingMore.value = true
    pageError.value = ''
  }

  try {
    const result = await props.loadProducts(query, controller.signal)
    if (!canApplyProductSelectorResponse({
      activeQueryKey,
      activeVersion: requestVersion,
      requestQueryKey: queryKey,
      requestVersion: version,
      aborted: controller.signal.aborted,
    })) {
      return
    }
    items.value = mergeProductSelectorItems(items.value, result.items, replace)
    page.value = result.page
    total.value = result.total
  }
  catch {
    if (controller.signal.aborted || version !== requestVersion) {
      return
    }
    if (replace) {
      productError.value = '产品加载失败，请重试'
    }
    else {
      pageError.value = '下一页加载失败，请重试'
    }
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      loadingMore.value = false
      if (activeController === controller) {
        activeController = null
      }
    }
  }
}

function refreshProducts(): void {
  activeController?.abort()
  items.value = []
  page.value = 0
  total.value = 0
  void loadPage(1, true)
}

function applyKeyword(): void {
  clearKeywordTimer()
  const normalized = normalizeProductSelectorKeyword(keywordDraft.value)
  if (normalized === appliedKeyword.value) {
    return
  }
  appliedKeyword.value = normalized
  refreshProducts()
}

function scheduleKeyword(): void {
  clearKeywordTimer()
  keywordTimer = setTimeout(applyKeyword, 300)
}

function handleSupplierChange(value: unknown): void {
  const next = typeof value === 'string' && value !== '' ? value : undefined
  if (next === supplierValue.value) {
    return
  }
  supplierValue.value = next
  refreshProducts()
}

function handleResultScroll(event: Event): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement) || !hasNextPage.value || loadingMore.value) {
    return
  }
  if (target.scrollHeight - target.scrollTop - target.clientHeight <= 96) {
    void loadPage(page.value + 1, false)
  }
}

function selectProduct(item: ProductSelectorItem): void {
  if (props.disabled) {
    return
  }
  const decision = selectProductForSession(
    changes.value,
    item,
    existingByProductId.value,
  )
  changes.value = decision.changes
  if (decision.incrementCandidate !== null) {
    incrementCandidate.value = decision.incrementCandidate
    incrementProductId.value = item.id
  }
}

function handleIncrementPopoverOpen(productId: string, open: boolean): void {
  if (!open && incrementProductId.value === productId) {
    incrementProductId.value = null
    incrementCandidate.value = null
  }
}

function confirmIncrement(): void {
  if (incrementCandidate.value === null) {
    return
  }
  changes.value = confirmProductIncrement(
    changes.value,
    incrementCandidate.value,
  )
  incrementProductId.value = null
  incrementCandidate.value = null
}

function cancelIncrement(): void {
  incrementProductId.value = null
  incrementCandidate.value = null
}

function removeSelectedProduct(productId: string): void {
  changes.value = removeProductFromSession(
    changes.value,
    productId,
    existingByProductId.value,
  )
}

function handleModalValue(value: boolean): void {
  emit('update:modelValue', value)
}

function closeSelector(): void {
  emit('update:modelValue', false)
}

function confirmSession(): void {
  if (changes.value.length === 0 || props.disabled) {
    return
  }
  emit('confirm', changes.value.map(change => (
    change.kind === 'ADD'
      ? { ...change, product: { ...change.product } }
      : { ...change }
  )))
  emit('update:modelValue', false)
}

function markImageFailed(productId: string): void {
  failedImages.value = new Set([...failedImages.value, productId])
}

function itemStatus(item: ProductSelectorItem): string {
  const selected = selectedByProductId.value.get(item.id)
  return selected === undefined ? '选择产品' : `已选择 · 数量 ${selected.quantity}`
}

watch(() => props.modelValue, (open) => {
  if (!open) {
    resetSession()
    return
  }
  resetSession()
  nextTick(() => void loadPage(1, true))
})

watch(() => props.currency, closeUntrustedSession)

watch(() => props.disabled, (disabled) => {
  if (disabled) {
    closeUntrustedSession()
  }
})

onBeforeUnmount(() => {
  clearKeywordTimer()
  activeController?.abort()
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="选择数据库产品"
    :description="`当前订单币种为 ${currency}，只显示具有该币种标准价的产品。`"
    size="xl"
    class="sm:!max-w-[68rem]"
    :submitting="disabled"
    @update:model-value="handleModalValue"
  >
    <div class="gap-5 grid lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
      <section class="border border-border rounded-xl bg-background min-w-0 overflow-hidden" aria-label="产品检索结果">
        <div class="p-4 border-b border-border bg-muted/20 gap-3 grid sm:grid-cols-[minmax(0,1fr)_14rem]">
          <FaInput
            v-model="keywordDraft"
            placeholder="搜索产品名称或编号"
            aria-label="搜索产品名称或编号"
            :disabled="disabled"
            @update:model-value="scheduleKeyword"
            @keydown.enter.prevent="applyKeyword"
          />
          <FaSelect
            :model-value="supplierValue ?? ALL_SUPPLIERS_OPTION_VALUE"
            :options="supplierOptions"
            placeholder="全部供应商"
            aria-label="供应商筛选"
            :disabled="disabled || supplierCatalog.loading.value || supplierCatalog.error.value !== null"
            @update:model-value="handleSupplierChange"
          />
          <div
            v-if="supplierCatalog.error.value"
            class="text-xs text-destructive flex gap-2 items-center sm:col-span-2"
            role="alert"
          >
            <span>供应商选项加载失败，仍可按关键词查询。</span>
            <FaButton type="button" variant="link" size="sm" @click="supplierCatalog.retry()">
              重试供应商
            </FaButton>
          </div>
        </div>

        <div
          class="p-3 overscroll-contain h-[25rem] overflow-y-auto"
          tabindex="0"
          aria-label="产品列表"
          @scroll="handleResultScroll"
        >
          <div v-if="loading" class="gap-3 grid" role="status" aria-label="正在加载产品">
            <div v-for="index in 4" :key="index" class="p-3 border border-border rounded-xl flex gap-3 items-center">
              <div class="rounded-lg bg-muted size-16 animate-pulse" />
              <div class="flex-1 gap-2 grid">
                <div class="rounded bg-muted h-5 w-2/3 animate-pulse" />
                <div class="rounded bg-muted h-4 w-1/3 animate-pulse" />
              </div>
            </div>
          </div>
          <FaAlert
            v-else-if="productError"
            title="产品加载失败"
            :description="productError"
            variant="destructive"
          >
            <template #actions>
              <FaButton type="button" variant="outline" size="sm" @click="loadPage(1, true)">
                重新加载
              </FaButton>
            </template>
          </FaAlert>
          <FaEmpty
            v-else-if="items.length === 0"
            icon="i-lucide:package-search"
            title="没有符合条件的产品"
            description="请调整关键词或供应商后重试。"
            class="py-16"
          />
          <div v-else class="gap-3 grid">
            <FaPopover
              v-for="item in items"
              :key="item.id"
              :open="incrementProductId === item.id"
              :auto-focus="true"
              :collision-padding="16"
              side="bottom"
              @update:open="value => handleIncrementPopoverOpen(item.id, value)"
            >
              <button
                type="button"
                class="p-3 text-left border border-border rounded-xl bg-background flex gap-3 w-full transition-[border-color,background-color,transform] duration-200 items-center focus-visible:outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]"
                :class="selectedByProductId.has(item.id) ? 'border-primary bg-primary/5' : ''"
                :aria-pressed="selectedByProductId.has(item.id)"
                :disabled="disabled"
                @click="selectProduct(item)"
              >
                <div class="border border-border rounded-lg bg-muted/35 flex shrink-0 size-16 items-center justify-center overflow-hidden">
                  <img
                    v-if="item.mainImage && !failedImages.has(item.id)"
                    :src="item.mainImage.contentUrl"
                    :alt="item.name"
                    class="size-full object-cover"
                    loading="lazy"
                    @error="markImageFailed(item.id)"
                  >
                  <FaIcon v-else name="i-lucide:image" class="text-muted-foreground size-6" aria-hidden="true" />
                </div>
                <span class="flex-1 min-w-0">
                  <span class="text-base font-semibold block truncate">{{ item.name }}</span>
                  <span class="text-sm text-muted-foreground font-mono mt-1 block truncate">{{ item.productNo }}</span>
                </span>
                <span class="text-xs text-primary font-medium flex shrink-0 gap-1 items-center">
                  <FaIcon :name="selectedByProductId.has(item.id) ? 'i-lucide:circle-check' : 'i-lucide:plus-circle'" aria-hidden="true" />
                  {{ itemStatus(item) }}
                </span>
              </button>
              <template #panel>
                <div class="gap-3 grid" role="alertdialog" aria-label="确认增加产品数量">
                  <p class="text-sm font-medium m-0">
                    产品已存在，是否增加数量？
                  </p>
                  <p class="text-xs text-muted-foreground m-0">
                    本次确认只会把原明细数量增加 1。
                  </p>
                  <div class="flex gap-2 justify-end">
                    <FaButton type="button" variant="outline" size="sm" @click="cancelIncrement">
                      取消
                    </FaButton>
                    <FaButton type="button" size="sm" @click="confirmIncrement">
                      增加数量
                    </FaButton>
                  </div>
                </div>
              </template>
            </FaPopover>

            <p v-if="loadingMore" class="text-xs text-muted-foreground m-0 py-3 text-center" role="status">
              正在加载更多产品…
            </p>
            <div v-if="pageError" class="text-xs text-destructive py-2 flex gap-2 items-center justify-center" role="alert">
              <span>{{ pageError }}</span>
              <FaButton type="button" variant="link" size="sm" @click="loadPage(page + 1, false)">
                重试
              </FaButton>
            </div>
          </div>
        </div>

        <div class="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
          <span class="text-sm text-muted-foreground">产品总数</span>
          <span class="text-sm qs-type-data-emphasis">共 {{ total }} 个产品</span>
        </div>
      </section>

      <aside class="border border-border rounded-xl bg-muted/15 min-w-0 overflow-hidden" aria-label="已选择产品">
        <div class="px-4 py-3 border-b border-border bg-muted/25">
          <h3 class="text-sm font-semibold m-0">
            已选择的产品
          </h3>
          <p class="text-xs text-muted-foreground m-0 mt-1">
            确认后才会一次性写入订单明细。
          </p>
        </div>
        <!-- Grid 子项默认的 min-width:auto 会被长名称撑宽；这里同时约束滚动轴和
             各级可收缩宽度，让列表只保留纵向滚动。 -->
        <div class="p-3 h-[25rem] overflow-x-hidden overflow-y-auto">
          <FaEmpty
            v-if="selectedItems.length === 0"
            icon="i-lucide:list-plus"
            title="尚未选择产品"
            description="从左侧选择要加入本单的产品。"
            class="py-14"
          />
          <ul v-else class="m-0 p-0 list-none gap-2 grid min-w-0 w-full">
            <li
              v-for="selected in selectedItems"
              :key="selected.productId"
              class="p-3 border border-border rounded-lg bg-background flex gap-3 max-w-full min-w-0 w-full items-center"
            >
              <span class="flex-1 min-w-0 overflow-hidden">
                <FaTooltip :text="selected.name">
                  <span tabindex="0" class="text-sm font-medium w-full block truncate">{{ selected.name }}</span>
                </FaTooltip>
                <span class="text-xs text-muted-foreground font-mono mt-0.5 block truncate">{{ selected.productNo }}</span>
                <span class="text-xs text-primary mt-1 block">
                  {{ selected.origin === 'ADDED' ? '新增产品' : '已有明细' }} · 数量 {{ selected.quantity }}
                </span>
              </span>
              <FaButton
                type="button"
                variant="ghost"
                size="icon"
                :aria-label="`移除 ${selected.name}`"
                class="shrink-0"
                @click="removeSelectedProduct(selected.productId)"
              >
                <FaIcon name="i-lucide:x" aria-hidden="true" />
              </FaButton>
            </li>
          </ul>
        </div>
      </aside>
    </div>

    <template #footer>
      <div class="px-4 py-3 flex flex-col-reverse gap-2 sm:px-6 sm:flex-row sm:justify-end">
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="closeSelector">
          取消
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 sm:min-h-9"
          :disabled="disabled || changes.length === 0"
          @click="confirmSession"
        >
          确认添加
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
