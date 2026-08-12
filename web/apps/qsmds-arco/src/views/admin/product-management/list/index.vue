<script setup lang="ts">
import type { ProductListItemViewModel } from './product-list.logic'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import productsApi from '@/api/modules/products'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import ProductAttributesModal from './product-attributes-modal.vue'
import {
  adaptProductPageDto,
  applyProductSupplierFilter,
  buildProductImageItems,
  buildProductListQuery,
  buildProductMainImageItems,
  buildSupplierFilterOptions,
  canApplyProductListResponse,
  getProductListApiFailure,
  isProductListAbortError,
} from './product-list.logic'
import ProductVideosModal from './product-videos-modal.vue'

defineOptions({ name: 'AdminProductList' })

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const supplierCatalog = useDictionaryCatalog(SUPPLIER_DICTIONARY_CODE)
const { currencies } = useCurrencyCatalog()

const canRead = computed(() => auth('products:read'))
const canCreate = computed(() => auth('products:create'))
const rows = ref<ProductListItemViewModel[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const loading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
const attributesTarget = ref<ProductListItemViewModel | null>(null)
const attributesVisible = ref(false)
const videosTarget = ref<ProductListItemViewModel | null>(null)
const videosVisible = ref(false)
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshPending = false

const supplierCatalogLoading = computed(() => supplierCatalog.loading.value)
const supplierCatalogError = computed(() => supplierCatalog.error.value)
const supplierCatalogMissing = computed(() => supplierCatalog.missing.value)
const supplierFilterOptions = computed(() => buildSupplierFilterOptions(
  supplierCatalog.catalog.value,
))
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [{
  key: 'supplierValue',
  label: '供应商',
  options: supplierFilterOptions.value,
  placeholder: '选择供应商',
}])
const listErrorDisplay = computed(() => {
  if (listError.value === '') {
    return undefined
  }
  return listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`
})

const columns: QsGenericTableColumn<ProductListItemViewModel>[] = [
  {
    accessorKey: 'productNo',
    id: 'productNo',
    fixed: 'left',
    minWidth: 180,
    title: '产品编号',
  },
  { accessorKey: 'name', id: 'name', minWidth: 180, title: '产品名称' },
  { accessorKey: 'status', id: 'status', title: '产品状态', width: 120 },
  {
    accessorFn: item => item.supplier?.value ?? null,
    id: 'supplier',
    minWidth: 180,
    title: '供应商',
  },
  { accessorKey: 'mainImage', id: 'mainImage', title: '产品主图', width: 130 },
  { accessorKey: 'images', id: 'images', minWidth: 180, title: '产品图片' },
  { accessorKey: 'videos', id: 'videos', title: '产品视频', width: 130 },
  {
    accessorFn: item => item.twdSalePrice.amount,
    align: 'right',
    id: 'twdSalePrice',
    minWidth: 170,
    title: '台币销售价',
  },
  {
    accessorFn: item => item.myrSalePrice.amount,
    align: 'right',
    id: 'myrSalePrice',
    minWidth: 170,
    title: '马币销售价',
  },
  {
    accessorFn: item => item.purchaseCost.amount,
    align: 'right',
    id: 'purchaseCost',
    minWidth: 170,
    title: '采购成本价',
  },
  { accessorKey: 'attributes', id: 'attributes', minWidth: 130, title: '产品属性' },
  { accessorKey: 'createdAt', id: 'createdAt', minWidth: 180, title: '创建时间' },
  {
    accessorFn: item => item.createdBy?.displayName ?? null,
    id: 'createdBy',
    minWidth: 140,
    title: '创建人',
  },
  { accessorKey: 'updatedAt', id: 'updatedAt', minWidth: 180, title: '更新时间' },
  {
    accessorFn: item => item.updatedBy?.displayName ?? null,
    id: 'updatedBy',
    minWidth: 140,
    title: '更新人',
  },
]

function listResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyProductListResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: listRequestVersion,
    requestVersion,
  })
}

async function loadProducts(): Promise<void> {
  if (!canRead.value) {
    return
  }

  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  listError.value = ''
  listRequestId.value = undefined

  try {
    const response = await productsApi.list(buildProductListQuery({
      filters: filters.value,
      page: page.value,
      pageSize: pageSize.value,
      search: searchKeyword.value,
    }), controller.signal)
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    const nextPage = adaptProductPageDto(response.data)
    rows.value = [...nextPage.items]
    page.value = nextPage.page
    pageSize.value = nextPage.pageSize
    total.value = nextPage.total
  }
  catch (error) {
    if (
      isProductListAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }

    const failure = getProductListApiFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
    }
  }
}

function scheduleQueryRefresh(): void {
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadProducts()
  })
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  const supplierValue = typeof nextFilters.supplierValue === 'string'
    ? nextFilters.supplierValue
    : undefined
  const nextState = applyProductSupplierFilter(nextFilters, supplierValue)
  filters.value = nextState.filters
  page.value = nextState.page
  scheduleQueryRefresh()
}

/** 搜索由 QsGenericTable 在显式提交/清空时触发，不对输入过程逐键请求。 */
function handleSearch(keyword: string): void {
  searchKeyword.value = keyword
  page.value = 1
  scheduleQueryRefresh()
}

function handlePaginationChange(input: { page: number, pageSize: number }): void {
  page.value = input.page
  pageSize.value = input.pageSize
  void loadProducts()
}

function supplierDisplay(item: ProductListItemViewModel): string {
  const supplier = item.supplier
  if (supplier === null) {
    return '—'
  }
  if (supplier.state === 'UNKNOWN') {
    return `${supplier.value}（未知）`
  }
  if (supplier.state === 'DISABLED') {
    return `${supplier.label ?? supplier.value}（已停用）`
  }
  return supplier.label ?? supplier.value
}

function statusLabel(status: ProductListItemViewModel['status']): string {
  return {
    ACTIVE: '启用',
    DRAFT: '草稿',
    INACTIVE: '停用',
  }[status]
}

function statusClass(status: ProductListItemViewModel['status']): string {
  return {
    ACTIVE: 'border-primary/30 bg-primary/10 text-primary',
    DRAFT: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    INACTIVE: 'border-border bg-muted text-muted-foreground',
  }[status]
}

function supplierStateLabel(item: ProductListItemViewModel): string | null {
  if (item.supplier?.state === 'DISABLED') {
    return '已停用'
  }
  if (item.supplier?.state === 'UNKNOWN') {
    return '未知'
  }
  return null
}

function supplierStateClass(item: ProductListItemViewModel): string {
  return item.supplier?.state === 'UNKNOWN'
    ? 'border-destructive/30 bg-destructive/5 text-destructive'
    : 'border-border bg-muted text-muted-foreground'
}

function showAttributes(product: ProductListItemViewModel): void {
  if (product.attributes.length === 0) {
    return
  }
  attributesTarget.value = product
  attributesVisible.value = true
}

function showVideos(product: ProductListItemViewModel): void {
  if (product.videos.length === 0) {
    return
  }
  videosTarget.value = product
  videosVisible.value = true
}

function showCreatePlaceholder(): void {
  toast.info('新增产品功能将在后续版本开放')
}

function showViewPlaceholder(): void {
  toast.info('产品详情功能将在后续版本开放')
}

function showEditPlaceholder(): void {
  toast.info('产品编辑功能将在后续版本开放')
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listRequestVersion += 1
    listAbortController?.abort()
    loading.value = false
    rows.value = []
    total.value = 0
    listError.value = ''
    listRequestId.value = undefined
    if (identityChanged) {
      filters.value = {}
      searchKeyword.value = ''
      page.value = 1
    }
    if (nextCanRead) {
      void loadProducts()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadProducts()
  }
})

onBeforeUnmount(() => {
  listRequestVersion += 1
  listAbortController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      title="产品列表"
      description="集中查看产品基础资料、供应商、媒体、价格与审计信息。"
    >
      <FaButton v-if="canCreate" class="min-h-11 sm:min-h-9" @click="showCreatePlaceholder">
        <FaIcon name="i-lucide:plus" />
        新增产品
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权查看产品"
        description="当前身份缺少 products:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <FaAlert
        v-if="supplierCatalogError || supplierCatalogMissing"
        icon="i-lucide:triangle-alert"
        title="供应商筛选暂不可用"
        description="产品列表仍可正常查看；可稍后重试供应商资料。"
        class="mb-4"
      >
        <template #actions>
          <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="supplierCatalog.retry">
            重试供应商资料
          </FaButton>
        </template>
      </FaAlert>
      <FaAlert
        v-else-if="supplierCatalogLoading"
        icon="i-lucide:loader-circle"
        title="正在加载供应商筛选"
        description="产品列表会独立加载，无需等待供应商资料。"
        class="mb-4"
      />

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="searchKeyword"
        v-model:filters="filters"
        data-testid="product-list-table"
        :row-key="item => item.id"
        :action-column="{ fixed: 'right', width: 180 }"
        :addable="false"
        :columns="columns"
        :data="rows"
        empty-title="暂无产品"
        empty-description="当前没有可展示的产品资料。"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索产品名称或产品编号"
        :searchable="true"
        :show-column-settings="true"
        :total="total"
        table-class="min-w-[2360px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadProducts"
        @search="handleSearch"
      >
        <template #cell-productNo="{ row }">
          <span class="qs-type-data font-mono">{{ row.original.productNo }}</span>
        </template>
        <template #cell-status="{ row }">
          <FaTag
            variant="outline"
            class="qs-type-status-tag"
            :class="statusClass(row.original.status)"
          >
            {{ statusLabel(row.original.status) }}
          </FaTag>
        </template>
        <template #cell-supplier="{ row }">
          <div class="flex flex-wrap gap-2 items-center">
            <span class="break-all">{{ row.original.supplier?.label ?? row.original.supplier?.value ?? '—' }}</span>
            <FaTag
              v-if="supplierStateLabel(row.original)"
              variant="outline"
              class="qs-type-status-tag"
              :class="supplierStateClass(row.original)"
            >
              {{ supplierStateLabel(row.original) }}
            </FaTag>
          </div>
        </template>
        <template #cell-mainImage="{ row }">
          <ImageGroup
            :items="buildProductMainImageItems(row.original)"
            :max-count="1"
            radius="lg"
            size="sm"
          />
        </template>
        <template #cell-images="{ row }">
          <ImageGroup
            :items="buildProductImageItems(row.original)"
            :max-count="3"
            radius="lg"
            size="sm"
          />
        </template>
        <template #cell-videos="{ row }">
          <FaButton
            v-if="row.original.videos.length"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`查看产品 ${row.original.productNo} 的 ${row.original.videos.length} 个视频`"
            @click="showVideos(row.original)"
          >
            <FaIcon name="i-lucide:video" />
            {{ row.original.videos.length }} 个视频
          </FaButton>
          <span v-else>—</span>
        </template>
        <template #cell-twdSalePrice="{ row }">
          <AmountDisplay
            :value="row.original.twdSalePrice.amount"
            :currency="row.original.twdSalePrice.currency"
            :currencies="currencies"
          />
        </template>
        <template #cell-myrSalePrice="{ row }">
          <AmountDisplay
            :value="row.original.myrSalePrice.amount"
            :currency="row.original.myrSalePrice.currency"
            :currencies="currencies"
          />
        </template>
        <template #cell-purchaseCost="{ row }">
          <AmountDisplay
            :value="row.original.purchaseCost.amount"
            :currency="row.original.purchaseCost.currency"
            :currencies="currencies"
          />
        </template>
        <template #cell-attributes="{ row }">
          <FaButton
            v-if="row.original.attributes.length"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`查看产品 ${row.original.productNo} 的 ${row.original.attributes.length} 项属性`"
            @click="showAttributes(row.original)"
          >
            <FaIcon name="i-lucide:list-tree" />
            {{ row.original.attributes.length }} 项属性
          </FaButton>
          <span v-else>—</span>
        </template>
        <template #cell-createdAt="{ row }">
          <DateTimeDisplay :value="row.original.createdAt" />
        </template>
        <template #cell-createdBy="{ row }">
          {{ row.original.createdBy?.displayName ?? '—' }}
        </template>
        <template #cell-updatedAt="{ row }">
          <DateTimeDisplay :value="row.original.updatedAt" />
        </template>
        <template #cell-updatedBy="{ row }">
          {{ row.original.updatedBy?.displayName ?? '—' }}
        </template>

        <template #actions="{ row, rowNumber }">
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`查看第 ${rowNumber} 行产品 ${row.productNo}`"
            @click="showViewPlaceholder"
          >
            <FaIcon name="i-lucide:eye" />
            查看
          </FaButton>
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`编辑第 ${rowNumber} 行产品 ${row.productNo}`"
            @click="showEditPlaceholder"
          >
            <FaIcon name="i-lucide:pencil" />
            编辑
          </FaButton>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <div class="qs-type-data-emphasis font-mono break-all">
                {{ row.productNo }}
              </div>
              <div class="qs-type-body mt-1">
                {{ row.name }}
              </div>
            </div>
            <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
          </div>
          <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2">
            <div>
              <dt class="qs-type-compact-label">
                产品编号
              </dt><dd class="font-mono m-0 break-all">
                {{ row.productNo }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                产品状态
              </dt><dd class="m-0">
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusClass(row.status)">
                  {{ statusLabel(row.status) }}
                </FaTag>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="qs-type-compact-label">
                供应商
              </dt><dd class="m-0">
                {{ supplierDisplay(row) }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                产品主图
              </dt><dd class="m-0">
                <ImageGroup
                  :items="buildProductMainImageItems(row)"
                  :max-count="1"
                  radius="lg"
                  :size="44"
                />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                产品图片
              </dt><dd class="m-0">
                <ImageGroup
                  :items="buildProductImageItems(row)"
                  :max-count="3"
                  radius="lg"
                  :size="44"
                />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                产品视频
              </dt><dd class="m-0">
                <FaButton
                  v-if="row.videos.length"
                  variant="ghost"
                  class="min-h-11"
                  :aria-label="`查看产品 ${row.productNo} 的 ${row.videos.length} 个视频`"
                  @click="showVideos(row)"
                >
                  <FaIcon name="i-lucide:video" />
                  {{ row.videos.length }} 个视频
                </FaButton>
                <span v-else>—</span>
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                产品属性
              </dt><dd class="m-0">
                <FaButton
                  v-if="row.attributes.length"
                  variant="ghost"
                  class="min-h-11"
                  :aria-label="`查看产品 ${row.productNo} 的 ${row.attributes.length} 项属性`"
                  @click="showAttributes(row)"
                >
                  <FaIcon name="i-lucide:list-tree" />
                  {{ row.attributes.length }} 项属性
                </FaButton>
                <span v-else>—</span>
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                台币销售价
              </dt><dd class="m-0">
                <AmountDisplay
                  :value="row.twdSalePrice.amount"
                  :currency="row.twdSalePrice.currency"
                  :currencies="currencies"
                />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                马币销售价
              </dt><dd class="m-0">
                <AmountDisplay
                  :value="row.myrSalePrice.amount"
                  :currency="row.myrSalePrice.currency"
                  :currencies="currencies"
                />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                采购成本价
              </dt><dd class="m-0">
                <AmountDisplay
                  :value="row.purchaseCost.amount"
                  :currency="row.purchaseCost.currency"
                  :currencies="currencies"
                />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                创建人
              </dt><dd class="m-0">
                {{ row.createdBy?.displayName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                创建时间
              </dt><dd class="m-0">
                <DateTimeDisplay :value="row.createdAt" />
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                更新人
              </dt><dd class="m-0">
                {{ row.updatedBy?.displayName ?? '—' }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                更新时间
              </dt><dd class="m-0">
                <DateTimeDisplay :value="row.updatedAt" />
              </dd>
            </div>
          </dl>
          <div class="mt-4 pt-3 border-t border-border flex gap-2 justify-end">
            <FaButton variant="outline" class="min-h-11" @click="showViewPlaceholder">
              <FaIcon name="i-lucide:eye" />查看
            </FaButton>
            <FaButton variant="outline" class="min-h-11" @click="showEditPlaceholder">
              <FaIcon name="i-lucide:pencil" />编辑
            </FaButton>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <ProductAttributesModal
      v-model="attributesVisible"
      :product="attributesTarget"
    />
    <ProductVideosModal
      v-model="videosVisible"
      :product="videosTarget"
    />
  </div>
</template>
