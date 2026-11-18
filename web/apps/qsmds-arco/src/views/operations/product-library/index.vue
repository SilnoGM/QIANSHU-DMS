<script setup lang="ts">
import type { ProductLibraryStatusFilter } from './product-library.logic'
import type { ProductListItemViewModel } from '@/views/admin/product-management/list/product-list.logic'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import productAliasesApi from '@/api/modules/product-aliases'
import productsApi from '@/api/modules/products'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import {
  adaptProductListItemDto,
  getProductListApiFailure,
  isProductListAbortError,
} from '@/views/admin/product-management/list/product-list.logic'
import ProductLibraryAliasModal from './product-library-alias-modal.vue'
import ProductLibraryCard from './product-library-card.vue'
import ProductLibraryDetailDrawer from './product-library-detail-drawer.vue'
import {
  buildCategoryOptions,
  buildProductHeadOptions,
  buildProductLibraryQuery,
  buildSupplierOptions,
  PRODUCT_LIBRARY_DEFAULT_PAGE_SIZE,
  PRODUCT_LIBRARY_PAGE_SIZES,
} from './product-library.logic'

defineOptions({ name: 'QsOperationsProductLibrary' })

const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const { currencies } = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog('service_provider.supplier')

const canRead = computed(() => auth('products:read'))
const canReadMedia = computed(() => auth('product-media:read'))
const canManageAlias = computed(() => auth('product-aliases:manage'))

const rows = ref<ProductListItemViewModel[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref<number>(PRODUCT_LIBRARY_DEFAULT_PAGE_SIZE)
const keyword = ref('')
const statusFilter = ref<ProductLibraryStatusFilter>('ACTIVE')
const supplierFilter = ref('ALL')
const categoryFilter = ref('ALL')
const productHeadFilter = ref('ALL')
const loading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
const taxonomyTree = ref<Awaited<ReturnType<typeof productsApi.taxonomyTree>>['data'] | null>(null)
const aliases = ref<ReadonlyMap<string, string>>(new Map())
const detailVisible = ref(false)
const detailProduct = ref<ProductListItemViewModel | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailRequestId = ref<string>()
const aliasVisible = ref(false)
const aliasTarget = ref<ProductListItemViewModel | null>(null)
const aliasSaving = ref(false)
const aliasError = ref('')

let listController: AbortController | null = null
let detailController: AbortController | null = null
let aliasController: AbortController | null = null
let taxonomyController: AbortController | null = null
let listVersion = 0
let keywordTimer: ReturnType<typeof setTimeout> | null = null

const supplierOptions = computed(() => [
  { value: 'ALL', label: '全部供应商' },
  ...buildSupplierOptions(supplierCatalog.catalog.value),
])
const supplierLabelByValue = computed(() => new Map(
  buildSupplierOptions(supplierCatalog.catalog.value).map(option => [option.value, option.label]),
))
const categoryOptions = computed(() => [
  { value: 'ALL', label: '全部分类' },
  ...buildCategoryOptions(
    taxonomyTree.value,
    supplierFilter.value === 'ALL' ? undefined : supplierFilter.value,
    supplierLabelByValue.value,
  ),
])
const productHeadOptions = computed(() => [
  { value: 'ALL', label: '全部产品头' },
  ...buildProductHeadOptions(
    taxonomyTree.value,
    categoryFilter.value === 'ALL' ? undefined : categoryFilter.value,
  ),
])
const statusOptions = [
  { value: 'ACTIVE', label: '启用' },
  { value: 'ALL', label: '全部' },
  { value: 'INACTIVE', label: '停用' },
]
const detailAlias = computed(() => (
  detailProduct.value === null ? null : aliases.value.get(detailProduct.value.id) ?? null
))
const aliasCurrent = computed(() => (
  aliasTarget.value === null ? null : aliases.value.get(aliasTarget.value.id) ?? null
))

function query() {
  return buildProductLibraryQuery({
    keyword: keyword.value,
    status: statusFilter.value,
    supplierValue: supplierFilter.value === 'ALL' ? undefined : supplierFilter.value,
    categoryId: categoryFilter.value === 'ALL' ? undefined : categoryFilter.value,
    productHeadId: productHeadFilter.value === 'ALL' ? undefined : productHeadFilter.value,
  }, page.value, pageSize.value)
}

async function loadAliasesForRows(
  products: readonly ProductListItemViewModel[],
  signal: AbortSignal,
  version: number,
  epoch: number,
): Promise<void> {
  if (!canManageAlias.value || products.length === 0) {
    aliases.value = new Map()
    return
  }
  try {
    const response = await productAliasesApi.listMine(
      products.map(product => product.id),
      signal,
    )
    if (signal.aborted || version !== listVersion || epoch !== account.authEpoch) {
      return
    }
    aliases.value = new Map(response.data.items.map(item => [item.productId, item.alias]))
  }
  catch (failure) {
    if (signal.aborted || isProductListAbortError(failure)) {
      return
    }
    aliases.value = new Map()
    toast.error(getApiClientFailureMessage(failure, '别名加载失败，请刷新后重试'))
  }
}

async function load(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  const version = ++listVersion
  const epoch = account.authEpoch
  loading.value = true
  listError.value = ''
  listRequestId.value = undefined
  try {
    const response = await productsApi.list(query(), controller.signal)
    if (controller.signal.aborted || version !== listVersion || epoch !== account.authEpoch) {
      return
    }
    rows.value = response.data.items.map(adaptProductListItemDto)
    total.value = response.data.total
    await loadAliasesForRows(rows.value, controller.signal, version, epoch)
  }
  catch (failure) {
    if (controller.signal.aborted || isProductListAbortError(failure)) {
      return
    }
    const parsed = getProductListApiFailure(failure)
    rows.value = []
    total.value = 0
    listError.value = parsed.message
    listRequestId.value = parsed.requestId
  }
  finally {
    if (listController === controller && !controller.signal.aborted) {
      loading.value = false
    }
  }
}

async function loadTaxonomy(): Promise<void> {
  taxonomyController?.abort()
  const controller = new AbortController()
  taxonomyController = controller
  try {
    const response = await productsApi.taxonomyTree(controller.signal)
    if (!controller.signal.aborted) {
      taxonomyTree.value = response.data
    }
  }
  catch {
    if (!controller.signal.aborted) {
      taxonomyTree.value = null
    }
  }
}

function changePage(nextPage: number): void {
  page.value = nextPage
  void load()
}

function changePageSize(nextSize: number): void {
  pageSize.value = nextSize
  page.value = 1
  void load()
}

function onKeywordInput(value: string | undefined): void {
  keyword.value = value ?? ''
  if (keywordTimer !== null) {
    clearTimeout(keywordTimer)
  }
  keywordTimer = setTimeout(() => {
    keywordTimer = null
    page.value = 1
    void load()
  }, 300)
}

function changeSupplier(value: unknown): void {
  supplierFilter.value = typeof value === 'string' ? value : 'ALL'
  categoryFilter.value = 'ALL'
  productHeadFilter.value = 'ALL'
  page.value = 1
  void load()
}

function changeCategory(value: unknown): void {
  categoryFilter.value = typeof value === 'string' ? value : 'ALL'
  productHeadFilter.value = 'ALL'
  page.value = 1
  void load()
}

function changeProductHead(value: unknown): void {
  productHeadFilter.value = typeof value === 'string' ? value : 'ALL'
  page.value = 1
  void load()
}

function changeStatus(value: unknown): void {
  statusFilter.value = (typeof value === 'string' ? value : 'ACTIVE') as ProductLibraryStatusFilter
  page.value = 1
  void load()
}

function resetFilters(): void {
  if (keywordTimer !== null) {
    clearTimeout(keywordTimer)
    keywordTimer = null
  }
  keyword.value = ''
  statusFilter.value = 'ACTIVE'
  supplierFilter.value = 'ALL'
  categoryFilter.value = 'ALL'
  productHeadFilter.value = 'ALL'
  page.value = 1
  void load()
}

function openDetail(product: ProductListItemViewModel): void {
  detailVisible.value = true
  detailProduct.value = product
  void loadDetail(product.id)
}

async function loadDetail(productId: string): Promise<void> {
  detailController?.abort()
  const controller = new AbortController()
  detailController = controller
  const epoch = account.authEpoch
  detailLoading.value = true
  detailError.value = ''
  detailRequestId.value = undefined
  try {
    const response = await productsApi.getById(productId, controller.signal)
    if (controller.signal.aborted || epoch !== account.authEpoch) {
      return
    }
    detailProduct.value = adaptProductListItemDto(response.data)
  }
  catch (failure) {
    if (controller.signal.aborted || isProductListAbortError(failure)) {
      return
    }
    const parsed = getProductListApiFailure(failure)
    detailError.value = parsed.message
    detailRequestId.value = parsed.requestId
  }
  finally {
    if (detailController === controller && !controller.signal.aborted) {
      detailLoading.value = false
    }
  }
}

function retryDetail(): void {
  if (detailProduct.value !== null) {
    void loadDetail(detailProduct.value.id)
  }
}

function editDetailAlias(): void {
  if (detailProduct.value !== null) {
    openAlias(detailProduct.value)
  }
}

function onDetailClosed(): void {
  detailController?.abort()
  detailController = null
}

function openAlias(product: ProductListItemViewModel): void {
  if (!canManageAlias.value) {
    return
  }
  aliasTarget.value = product
  aliasError.value = ''
  aliasVisible.value = true
}

function applyAlias(productId: string, alias: string | null): void {
  const next = new Map(aliases.value)
  if (alias) {
    next.set(productId, alias)
  }
  else {
    next.delete(productId)
  }
  aliases.value = next
}

async function saveAlias(alias: string): Promise<void> {
  const target = aliasTarget.value
  if (target === null || aliasSaving.value) {
    return
  }
  aliasController?.abort()
  const controller = new AbortController()
  aliasController = controller
  aliasSaving.value = true
  aliasError.value = ''
  try {
    const response = await productAliasesApi.upsert(target.id, alias, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    applyAlias(target.id, response.data.alias)
    aliasSaving.value = false
    aliasVisible.value = false
    toast.success('别名已保存')
  }
  catch (failure) {
    if (!controller.signal.aborted && !isProductListAbortError(failure)) {
      aliasError.value = getApiClientFailureMessage(failure, '别名保存失败')
    }
  }
  finally {
    if (aliasController === controller) {
      aliasSaving.value = false
    }
  }
}

async function clearAlias(): Promise<void> {
  const target = aliasTarget.value
  if (target === null || aliasSaving.value) {
    return
  }
  aliasController?.abort()
  const controller = new AbortController()
  aliasController = controller
  aliasSaving.value = true
  aliasError.value = ''
  try {
    await productAliasesApi.clear(target.id, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    applyAlias(target.id, null)
    aliasSaving.value = false
    aliasVisible.value = false
    toast.success('别名已清除')
  }
  catch (failure) {
    if (!controller.signal.aborted && !isProductListAbortError(failure)) {
      aliasError.value = getApiClientFailureMessage(failure, '别名清除失败')
    }
  }
  finally {
    if (aliasController === controller) {
      aliasSaving.value = false
    }
  }
}

onMounted(() => {
  void load()
  void loadTaxonomy()
})

onBeforeUnmount(() => {
  if (keywordTimer !== null) {
    clearTimeout(keywordTimer)
  }
  listController?.abort()
  detailController?.abort()
  aliasController?.abort()
  taxonomyController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader title="产品库" description="浏览产品资料，维护你的唛头别名。">
      <span class="qs-type-meta text-muted-foreground">共 {{ total }} 个产品</span>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权查看产品"
        description="当前身份缺少 products:read 权限。"
        class="py-12"
      />
      <template v-else>
        <FaCard class="mb-4" content-class="p-4">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <FaInput
                :model-value="keyword"
                type="search"
                clearable
                placeholder="搜索产品名称或编号"
                aria-label="搜索产品名称或编号"
                class="w-full sm:flex-1"
                @update:model-value="onKeywordInput"
              >
                <template #start>
                  <FaIcon name="i-lucide:search" />
                </template>
              </FaInput>
              <FaSelect
                :model-value="statusFilter"
                :options="statusOptions"
                aria-label="产品状态"
                class="w-full sm:w-40"
                @update:model-value="changeStatus"
              />
              <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="resetFilters">
                重置
              </FaButton>
            </div>
            <div class="gap-3 grid sm:grid-cols-3">
              <FaSelect
                :model-value="supplierFilter"
                :options="supplierOptions"
                placeholder="供应商"
                aria-label="供应商"
                class="w-full"
                @update:model-value="changeSupplier"
              />
              <FaSelect
                :model-value="categoryFilter"
                :options="categoryOptions"
                placeholder="分类"
                aria-label="分类"
                class="w-full"
                @update:model-value="changeCategory"
              />
              <FaSelect
                :model-value="productHeadFilter"
                :options="productHeadOptions"
                :disabled="categoryFilter === 'ALL'"
                placeholder="产品头"
                aria-label="产品头"
                class="w-full"
                @update:model-value="changeProductHead"
              />
            </div>
          </div>
        </FaCard>

        <FaAlert
          v-if="listError"
          :description="listRequestId ? `${listError}（requestId: ${listRequestId}）` : listError"
          variant="destructive"
          class="mb-4"
        />
        <div v-if="listError" class="py-10 flex justify-center">
          <FaButton variant="outline" @click="load">
            重试
          </FaButton>
        </div>
        <div
          v-else-if="loading"
          class="gap-4 grid xl:grid-cols-2"
          aria-busy="true"
        >
          <div
            v-for="index in 6"
            :key="index"
            aria-hidden="true"
            class="p-3 border border-border rounded-xl bg-card gap-3 grid grid-cols-[7rem_minmax(0,1fr)] min-w-0 sm:gap-4 sm:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)]"
          >
            <div class="rounded-lg bg-muted/50 w-full aspect-square motion-safe:animate-pulse" />
            <div class="flex flex-1 flex-col gap-2 min-w-0">
              <div class="rounded bg-muted/50 h-4 w-3/4 motion-safe:animate-pulse" />
              <div class="rounded bg-muted/50 h-3 w-1/2 motion-safe:animate-pulse" />
              <div class="p-2 rounded-lg bg-muted/40">
                <div class="gap-2 grid grid-cols-3">
                  <div v-for="cell in 3" :key="cell" class="flex flex-col gap-1">
                    <div class="rounded bg-muted/50 h-3 w-10 motion-safe:animate-pulse" />
                    <div class="rounded bg-muted/50 h-4 w-16 motion-safe:animate-pulse" />
                  </div>
                </div>
              </div>
              <div class="mt-auto flex gap-2 w-full justify-end">
                <div class="rounded bg-muted/50 h-8 w-20 motion-safe:animate-pulse" />
                <div class="rounded bg-muted/50 h-8 w-20 motion-safe:animate-pulse" />
              </div>
            </div>
          </div>
        </div>
        <FaEmpty
          v-else-if="rows.length === 0"
          icon="i-lucide:package-search"
          title="没有匹配的产品"
          description="试试调整搜索词或筛选条件。"
          class="py-12"
        >
          <FaButton variant="outline" @click="resetFilters">
            重置筛选
          </FaButton>
        </FaEmpty>
        <div
          v-else
          class="gap-4 grid xl:grid-cols-2"
          aria-live="polite"
        >
          <ProductLibraryCard
            v-for="product in rows"
            :key="product.id"
            :product="product"
            :alias="aliases.get(product.id) ?? null"
            :can-manage-alias="canManageAlias"
            :can-read-media="canReadMedia"
            :currencies="currencies"
            @open="openDetail(product)"
            @edit-alias="openAlias(product)"
          />
        </div>

        <nav v-if="total > 0" class="mt-4 flex justify-end" aria-label="产品分页">
          <FaPagination
            :page="page"
            :size="pageSize"
            :total="total"
            :sizes="[...PRODUCT_LIBRARY_PAGE_SIZES]"
            layout="total, sizes, ->, pager"
            @update:page="changePage"
            @update:size="changePageSize"
          />
        </nav>
      </template>
    </FaPageMain>

    <ProductLibraryDetailDrawer
      v-model="detailVisible"
      :product="detailProduct"
      :alias="detailAlias"
      :can-manage-alias="canManageAlias"
      :can-read-media="canReadMedia"
      :currencies="currencies"
      :loading="detailLoading"
      :error="detailError"
      :request-id="detailRequestId"
      @retry="retryDetail"
      @edit-alias="editDetailAlias"
      @closed="onDetailClosed"
    />

    <ProductLibraryAliasModal
      v-model="aliasVisible"
      :product-name="aliasTarget?.name ?? ''"
      :product-no="aliasTarget?.productNo ?? ''"
      :current-alias="aliasCurrent"
      :saving="aliasSaving"
      :error="aliasError"
      @save="saveAlias"
      @clear="clearAlias"
    />
  </div>
</template>
