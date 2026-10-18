<script setup lang="ts">
import type {
  ExistingCatalogLine,
  ProductIncrementCandidate,
  ProductPageLoader,
  ProductSelectionChange,
  ProductSelectorCategoryFacet,
  ProductSelectorCategoryFilter,
  ProductSelectorCurrency,
  ProductSelectorGroup,
  ProductSelectorItem,
} from './types'

import { useFaImagePreview } from '@fantastic-admin/components'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { mediaThumbnailUrl } from '@/utils/media-variant'
import QsGenericModal from '../QsGenericModal/index.vue'
import {
  canApplyProductSelectorResponse,
  confirmProductIncrement,
  createExistingCatalogLineIndex,
  createProductSelectorQueryKey,
  createSelectedProductItems,
  groupProductSelectorItems,
  groupSelectedProductItems,
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
  description?: string
  fixedSupplierValue?: string
  pageSize?: number
}>(), {
  disabled: false,
  description: undefined,
  fixedSupplierValue: undefined,
  // 首屏只取 12 个产品，降低“全部供应商 + 缩略图”打开成本；滚动仍可继续加载。
  pageSize: 12,
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
const imagePreview = useFaImagePreview()
const categoryFilter = ref<ProductSelectorCategoryFilter>({ kind: 'all' })
const categories = shallowRef<readonly ProductSelectorCategoryFacet[]>([])
const unclassifiedCount = ref(0)
let requestVersion = 0
let activeQueryKey = ''
let activeController: AbortController | null = null
let keywordTimer: ReturnType<typeof setTimeout> | undefined

interface CategoryOption {
  readonly key: string
  readonly label: string
  readonly count: number
  readonly filter: ProductSelectorCategoryFilter
}

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
const supplierLabelByValue = computed(() => new Map(
  (supplierCatalog.catalog.value?.items ?? []).map(item => [
    item.value,
    item.effectiveEnabled ? item.label : `${item.label}（已停用）`,
  ]),
))
const supplierByProductId = computed(() => {
  const index = new Map(items.value.map(item => [item.id, item.supplierValue]))
  for (const change of changes.value) {
    if (change.kind === 'ADD') {
      index.set(change.product.id, change.product.supplierValue)
    }
  }
  return index
})
const selectedGroups = computed(() => groupSelectedProductItems(
  selectedItems.value,
  item => item.supplierValue
    ?? supplierByProductId.value.get(item.productId)
    ?? null,
))
function supplierGroupLabel(value: string | null): string {
  if (value === null) {
    return '未设置供应商'
  }
  return supplierLabelByValue.value.get(value) ?? value
}
const supplierOptions = computed(() => [{ label: '全部供应商', value: ALL_SUPPLIERS_OPTION_VALUE }, ...(
  supplierCatalog.catalog.value?.items ?? []
).map(item => ({
  label: item.effectiveEnabled ? item.label : `${item.label}（已停用）`,
  value: item.value,
}))])
const hasNextPage = computed(() => items.value.length < total.value)
const groups = computed<readonly ProductSelectorGroup[]>(() => (
  groupProductSelectorItems(items.value)
))
const showCategoryInGroup = computed(() => categoryFilter.value.kind !== 'category')
const categoryOptions = computed<readonly CategoryOption[]>(() => {
  const totalCount = categories.value.reduce(
    (sum, category) => sum + category.count,
    unclassifiedCount.value,
  )
  const options: CategoryOption[] = [
    {
      key: 'all',
      label: '全部',
      count: totalCount,
      filter: { kind: 'all' },
    },
    ...categories.value.map(category => ({
      key: `category:${category.name}`,
      label: category.name,
      count: category.count,
      filter: { kind: 'category' as const, name: category.name },
    })),
  ]
  if (unclassifiedCount.value > 0) {
    options.push({
      key: 'unclassified',
      label: '未分类',
      count: unclassifiedCount.value,
      filter: { kind: 'unclassified' },
    })
  }
  return options
})

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
  categoryFilter.value = { kind: 'all' }
  categories.value = []
  unclassifiedCount.value = 0
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
    ...((props.fixedSupplierValue ?? supplierValue.value) === undefined
      ? {}
      : { supplierValue: props.fixedSupplierValue ?? supplierValue.value }),
    ...(categoryFilter.value.kind === 'category'
      ? { categoryName: categoryFilter.value.name }
      : {}),
    ...(categoryFilter.value.kind === 'unclassified'
      ? { unclassified: true }
      : {}),
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
    categories.value = result.categories
    unclassifiedCount.value = result.unclassifiedCount
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
  incrementProductId.value = null
  incrementCandidate.value = null
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
  // 供应商变化后旧分类可能不存在，统一回到「全部」，避免空列表看似加载失败。
  categoryFilter.value = { kind: 'all' }
  refreshProducts()
}

function sameCategoryFilter(
  left: ProductSelectorCategoryFilter,
  right: ProductSelectorCategoryFilter,
): boolean {
  if (left.kind !== right.kind) {
    return false
  }
  return left.kind !== 'category'
    || (right.kind === 'category' && left.name === right.name)
}

function isCategoryOptionActive(option: CategoryOption): boolean {
  return sameCategoryFilter(option.filter, categoryFilter.value)
}

function selectCategory(filter: ProductSelectorCategoryFilter): void {
  if (sameCategoryFilter(filter, categoryFilter.value)) {
    return
  }
  categoryFilter.value = filter
  refreshProducts()
}

function openProductImage(item: ProductSelectorItem): void {
  if (!item.mainImage || failedImages.value.has(item.id)) {
    return
  }
  incrementProductId.value = null
  incrementCandidate.value = null
  imagePreview.open(item.mainImage.contentUrl, 0)
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

// 固定供应商来自订单上下文；变化时旧候选产品不再可信，必须结束当前选择会话。
watch(() => props.fixedSupplierValue, closeUntrustedSession)

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
    :description="description ?? `产品选择不限制币种；当前订单币种为 ${currency}，无该币种标准价时需手填本单售价。`"
    size="3xl"
    fill-height
    :submitting="disabled"
    @update:model-value="handleModalValue"
  >
    <div class="flex flex-1 flex-col gap-3 min-h-0">
      <div
        class="p-4 border border-border rounded-xl bg-muted/20 shrink-0 gap-3 grid"
        :class="fixedSupplierValue === undefined ? 'sm:grid-cols-[minmax(0,1fr)_14rem]' : 'sm:grid-cols-1'"
      >
        <FaInput
          v-model="keywordDraft"
          class="w-full"
          placeholder="搜索产品名称或编号"
          aria-label="搜索产品名称或编号"
          :disabled="disabled"
          @update:model-value="scheduleKeyword"
          @keydown.enter.prevent="applyKeyword"
        />
        <FaSelect
          v-if="fixedSupplierValue === undefined"
          :model-value="supplierValue ?? ALL_SUPPLIERS_OPTION_VALUE"
          :options="supplierOptions"
          placeholder="全部供应商"
          aria-label="供应商筛选"
          :disabled="disabled || supplierCatalog.loading.value || supplierCatalog.error.value !== null"
          @update:model-value="handleSupplierChange"
        />
        <div
          v-if="fixedSupplierValue === undefined && supplierCatalog.error.value"
          class="text-xs text-destructive flex gap-2 items-center sm:col-span-2"
          role="alert"
        >
          <span>供应商选项加载失败，仍可按关键词查询。</span>
          <FaButton type="button" variant="link" size="sm" @click="supplierCatalog.retry()">
            重试供应商
          </FaButton>
        </div>
      </div>

      <div class="qs-product-selector-scroll flex-1 gap-3 grid min-h-0 overflow-y-auto xl:grid-cols-[12rem_minmax(0,1fr)_18rem] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <aside class="border border-border rounded-xl bg-muted/15 flex flex-col min-h-0 min-w-0 overflow-hidden" aria-label="产品分类">
          <div class="px-3 py-2 border-b border-border bg-muted/25 shrink-0 hidden xl:block">
            <h3 class="text-sm font-semibold m-0">
              产品分类
            </h3>
          </div>
          <div class="qs-product-selector-scroll p-2 flex gap-1 overflow-x-auto xl:flex-1 xl:flex-col xl:gap-0.5 xl:min-h-0 xl:overflow-x-hidden xl:overflow-y-auto">
            <button
              v-for="option in categoryOptions"
              :key="option.key"
              type="button"
              class="text-sm px-2.5 py-1.5 border rounded-lg flex shrink-0 gap-2 min-h-9 transition-colors items-center xl:w-full"
              :class="isCategoryOptionActive(option)
                ? 'border-primary/25 bg-primary/10 text-primary font-semibold'
                : 'border-transparent hover:bg-background/70'"
              :aria-pressed="isCategoryOptionActive(option)"
              @click="selectCategory(option.filter)"
            >
              <span class="rounded-full bg-current opacity-60 shrink-0 size-1.5" aria-hidden="true" />
              <span class="text-left flex-1 min-w-0 truncate">{{ option.label }}</span>
              <span class="text-[11px] text-muted-foreground tabular-nums">{{ option.count }}</span>
            </button>
          </div>
        </aside>

        <section class="border border-border rounded-xl bg-background flex flex-col min-h-0 min-w-0 overflow-hidden" aria-label="产品检索结果">
          <div
            class="qs-product-selector-scroll p-3 overscroll-contain flex-1 max-h-[58vh] min-h-0 overflow-y-auto xl:max-h-none"
            tabindex="0"
            aria-label="产品列表"
            @scroll="handleResultScroll"
          >
            <div v-if="loading" class="gap-3 grid sm:grid-cols-2" role="status" aria-label="正在加载产品">
              <div v-for="index in 4" :key="index" class="p-3 border border-border rounded-xl gap-3 grid">
                <div class="rounded-lg bg-muted aspect-[16/10] animate-pulse" />
                <div class="rounded bg-muted h-5 w-2/3 animate-pulse" />
                <div class="rounded bg-muted h-4 w-1/3 animate-pulse" />
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
              description="请调整关键词、供应商或分类后重试。"
              class="py-16"
            />
            <div v-else class="gap-5 grid">
              <section
                v-for="group in groups"
                :key="group.key"
                class="min-w-0"
                :aria-label="`${group.categoryName ?? '未分类'} ${group.productHeadName ?? '未填写产品头'}`"
              >
                <div class="px-1 py-2 bg-background flex gap-2 items-center top-0 sticky z-10 -mx-1">
                  <span
                    v-if="showCategoryInGroup"
                    class="text-[11px] text-muted-foreground px-2 py-0.5 border border-border rounded-full bg-muted whitespace-nowrap"
                  >
                    {{ group.categoryName ?? '未分类' }}
                  </span>
                  <h3 class="text-sm font-semibold m-0 whitespace-nowrap">
                    {{ group.productHeadName ?? '未填写产品头' }}
                  </h3>
                  <span class="bg-border flex-1 h-px" aria-hidden="true" />
                  <span class="text-[11px] text-muted-foreground tabular-nums">{{ group.items.length }} 个</span>
                </div>

                <div class="mt-2 gap-3 grid sm:grid-cols-2">
                  <article
                    v-for="item in group.items"
                    :key="item.id"
                    class="border rounded-xl bg-background transition-[border-color,background-color,box-shadow] duration-200 overflow-hidden"
                    :class="selectedByProductId.has(item.id)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'"
                  >
                    <button
                      v-if="item.mainImage && !failedImages.has(item.id)"
                      type="button"
                      class="bg-muted w-full aspect-[16/10] block relative overflow-hidden"
                      :aria-label="`放大查看 ${item.name} 产品图片`"
                      :data-zoom-product="item.id"
                      @click.stop="openProductImage(item)"
                    >
                      <img
                        :src="mediaThumbnailUrl(item.mainImage.contentUrl) ?? item.mainImage.contentUrl"
                        :alt="item.name"
                        class="size-full transition-transform duration-200 object-cover hover:scale-[1.025]"
                        decoding="async"
                        fetchpriority="low"
                        loading="lazy"
                        @error="markImageFailed(item.id)"
                      >
                      <span
                        v-if="selectedByProductId.has(item.id)"
                        class="text-[10px] text-primary-foreground font-semibold px-2 py-0.5 rounded-full bg-primary flex gap-1 shadow items-center left-2 top-2 absolute"
                      >
                        <FaIcon name="i-lucide:circle-check" class="size-3" aria-hidden="true" />
                        已选
                      </span>
                      <span class="text-muted-foreground p-1.5 border border-border/60 rounded-md bg-background/85 pointer-events-none shadow-sm right-2 top-2 absolute backdrop-blur">
                        <FaIcon name="i-lucide:zoom-in" class="size-4" aria-hidden="true" />
                      </span>
                    </button>
                    <div v-else class="bg-muted flex aspect-[16/10] items-center justify-center relative">
                      <FaIcon name="i-lucide:image" class="text-muted-foreground size-7" aria-hidden="true" />
                      <span
                        v-if="selectedByProductId.has(item.id)"
                        class="text-[10px] text-primary-foreground font-semibold px-2 py-0.5 rounded-full bg-primary flex gap-1 shadow items-center left-2 top-2 absolute"
                      >
                        <FaIcon name="i-lucide:circle-check" class="size-3" aria-hidden="true" />
                        已选
                      </span>
                    </div>
                    <FaPopover
                      :open="incrementProductId === item.id"
                      :auto-focus="true"
                      :collision-padding="16"
                      side="bottom"
                      @update:open="value => handleIncrementPopoverOpen(item.id, value)"
                    >
                      <button
                        type="button"
                        class="p-3 text-left w-full block disabled:opacity-60 disabled:cursor-not-allowed"
                        :aria-pressed="selectedByProductId.has(item.id)"
                        :disabled="disabled"
                        @click="selectProduct(item)"
                      >
                        <span class="text-sm font-semibold block truncate">{{ item.name }}</span>
                        <span class="text-xs text-muted-foreground font-mono mt-1 block truncate">{{ item.productNo }}</span>
                        <span class="text-xs text-primary font-medium mt-2 pt-2 border-t border-border flex gap-1 items-center">
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
                  </article>
                </div>
              </section>

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

          <div class="px-3 py-1.5 border-t border-border bg-muted/20 flex shrink-0 items-center justify-between">
            <span class="text-sm text-muted-foreground">产品总数</span>
            <span class="text-sm qs-type-data-emphasis">共 {{ total }} 个产品</span>
          </div>
        </section>

        <aside class="border border-border rounded-xl bg-muted/15 flex flex-col min-h-0 min-w-0 overflow-hidden" aria-label="已选择产品">
          <div class="px-4 py-3 border-b border-border bg-muted/25 shrink-0">
            <h3 class="text-sm font-semibold m-0">
              已选择的产品
            </h3>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              按供应商分组；确认后才会一次性写入订单明细。
            </p>
          </div>
          <!-- Grid 子项默认的 min-width:auto 会被长名称撑宽；这里同时约束滚动轴和
               各级可收缩宽度，让列表只保留纵向滚动。 -->
          <div class="qs-product-selector-scroll p-3 flex-1 max-h-[40vh] min-h-0 overflow-x-hidden overflow-y-auto xl:max-h-none">
            <FaEmpty
              v-if="selectedItems.length === 0"
              icon="i-lucide:list-plus"
              title="尚未选择产品"
              description="从左侧选择要加入本单的产品。"
              class="py-14"
            />
            <div v-else class="gap-3 grid min-w-0">
              <section
                v-for="group in selectedGroups"
                :key="group.key"
                class="min-w-0"
                :aria-label="supplierGroupLabel(group.supplierValue)"
              >
                <div class="px-1 pb-1 flex gap-2 items-baseline justify-between">
                  <h4 class="text-xs text-muted-foreground font-semibold m-0 truncate">
                    {{ supplierGroupLabel(group.supplierValue) }}
                  </h4>
                  <span class="text-[11px] text-muted-foreground shrink-0 tabular-nums">{{ group.items.length }} 项</span>
                </div>
                <ul class="m-0 p-0 list-none gap-2 grid min-w-0 w-full">
                  <li
                    v-for="selected in group.items"
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
              </section>
            </div>
          </div>
        </aside>
      </div>
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
.qs-product-selector-scroll {
  scrollbar-width: none;
}

.qs-product-selector-scroll::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
