<script setup lang="ts">
import type { ProductListItemViewModel } from './product-list.logic'
import type { ProductTaxonomyCategoryOptionDto } from '@/api/generated/types.gen'
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
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import ProductAttributesModal from './product-attributes-modal.vue'
import ProductDetailDrawer from './product-detail-drawer.vue'
import {
  adaptProductListItemDto,
  adaptProductPageDto,
  applyProductStatusFilter,
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
const { auth, authAll } = useAppAuth()
const appAccountStore = useAppAccountStore()
const router = useRouter()
const supplierCatalog = useDictionaryCatalog(SUPPLIER_DICTIONARY_CODE)
const { currencies } = useCurrencyCatalog()
const toast = useQsToast()

const canRead = computed(() => auth('products:read'))
const canCreate = computed(() => auth('products:create'))
const canUpdate = computed(() => authAll([
  'products:update',
  'product-categories:create',
]))
const canReadProductMedia = computed(() => auth('product-media:read'))
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
const detailVisible = ref(false)
const detailProductId = ref<string>()
const detailProduct = ref<ProductListItemViewModel | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailRequestId = ref<string>()
const taxonomyOptions = shallowRef<readonly ProductTaxonomyCategoryOptionDto[]>([])
const statusTarget = shallowRef<ProductListItemViewModel | null>(null)
const statusNext = ref<'ACTIVE' | 'INACTIVE' | null>(null)
const statusModalVisible = ref(false)
const statusSubmitting = ref(false)
const statusError = ref('')
const statusRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let detailRequestVersion = 0
let detailAbortController: AbortController | null = null
let taxonomyAbortController: AbortController | null = null
let statusAbortController: AbortController | null = null
let queryRefreshPending = false

const supplierCatalogLoading = computed(() => supplierCatalog.loading.value)
const supplierCatalogError = computed(() => supplierCatalog.error.value)
const supplierCatalogMissing = computed(() => supplierCatalog.missing.value)
const supplierFilterOptions = computed(() => buildSupplierFilterOptions(
  supplierCatalog.catalog.value,
))
const supplierLabelByValue = computed(() => new Map(
  supplierFilterOptions.value.map(option => [option.value, option.label]),
))
const selectedSupplierFilterValue = computed(() => (
  typeof filters.value.supplierValue === 'string'
  && filters.value.supplierValue !== ''
    ? filters.value.supplierValue
    : undefined
))
const selectedCategoryFilterId = computed(() => (
  typeof filters.value.categoryId === 'string'
  && filters.value.categoryId !== ''
    ? filters.value.categoryId
    : undefined
))
const categoryFilterOptions = computed(() => {
  const supplierValue = selectedSupplierFilterValue.value
  return taxonomyOptions.value
    .filter(category => supplierValue === undefined
      || category.supplierValue === supplierValue)
    .map(category => ({
      label: supplierValue === undefined
        ? `${category.name}（${supplierLabelByValue.value.get(category.supplierValue) ?? category.supplierValue}）`
        : category.name,
      value: category.id,
    }))
})
const productHeadFilterOptions = computed(() => {
  const supplierValue = selectedSupplierFilterValue.value
  const categoryId = selectedCategoryFilterId.value
  const categories = taxonomyOptions.value.filter(category => (
    (supplierValue === undefined || category.supplierValue === supplierValue)
    && (categoryId === undefined || category.id === categoryId)
  ))
  return categories.flatMap(category => category.productHeads.map(productHead => ({
    label: categoryId === undefined
      ? `${productHead.name}（${category.name}）`
      : productHead.name,
    value: productHead.id,
  })))
})
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [
  {
    key: 'status',
    label: '启用状态',
    options: [
      { label: '已启用', value: 'ACTIVE' },
      { label: '已停用', value: 'INACTIVE' },
    ],
    placeholder: '选择启用状态',
  },
  {
    key: 'supplierValue',
    label: '供应商',
    options: supplierFilterOptions.value,
    placeholder: '选择供应商',
  },
  {
    key: 'categoryId',
    label: '分类',
    options: categoryFilterOptions.value,
    placeholder: '选择分类',
  },
  {
    key: 'productHeadId',
    label: '产品头',
    options: productHeadFilterOptions.value,
    placeholder: '选择产品头',
  },
])
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
  { accessorKey: 'categoryName', id: 'categoryName', minWidth: 150, title: '分类' },
  { accessorKey: 'productHeadName', id: 'productHeadName', minWidth: 150, title: '产品头' },
  { accessorKey: 'status', id: 'status', title: '产品状态', width: 120 },
  {
    accessorFn: item => item.supplier?.value ?? null,
    id: 'supplier',
    minWidth: 180,
    title: '供应商',
  },
  {
    accessorFn: item => item.media.mainImage?.id ?? null,
    id: 'mainImage',
    title: '产品主图',
    width: 130,
  },
  {
    accessorFn: item => item.media.images,
    id: 'images',
    minWidth: 180,
    title: '产品图片',
  },
  {
    accessorFn: item => item.media.videos,
    id: 'videos',
    title: '产品视频',
    width: 130,
  },
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

async function loadTaxonomyOptions(): Promise<void> {
  taxonomyAbortController?.abort()
  const controller = new AbortController()
  taxonomyAbortController = controller
  try {
    const response = await productsApi.taxonomyOptions(controller.signal)
    if (controller.signal.aborted || !canRead.value) {
      return
    }
    taxonomyOptions.value = response.data.categories
  }
  catch {
    if (!controller.signal.aborted) {
      taxonomyOptions.value = []
    }
  }
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
  const status = nextFilters.status === 'ACTIVE' || nextFilters.status === 'INACTIVE'
    ? nextFilters.status
    : undefined
  const supplierValue = typeof nextFilters.supplierValue === 'string'
    ? nextFilters.supplierValue
    : undefined
  const previousSupplier = typeof filters.value.supplierValue === 'string'
    ? filters.value.supplierValue
    : undefined
  const previousCategory = filters.value.categoryId
  const next = { ...nextFilters }
  if (supplierValue !== previousSupplier) {
    // 分类/产品头按供应商作用域读取；供应商变化后旧作用域筛选不再有效。
    delete next.categoryId
    delete next.productHeadId
  }
  if (next.categoryId !== previousCategory) {
    delete next.productHeadId
  }
  const supplierState = applyProductSupplierFilter(next, supplierValue)
  const nextState = applyProductStatusFilter(supplierState.filters, status)
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
    INACTIVE: '停用',
  }[status]
}

function statusClass(status: ProductListItemViewModel['status']): string {
  return {
    ACTIVE: 'border-primary/30 bg-primary/10 text-primary',
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
  if (!canReadProductMedia.value || product.media.videos.length === 0) {
    return
  }
  videosTarget.value = product
  videosVisible.value = true
}

function navigateToCreate(): void {
  void router.push({ name: 'adminProductCreate' })
}

function detailResponseIsCurrent(
  productId: string,
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyProductListResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value && detailProductId.value === productId,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: detailRequestVersion,
    requestVersion,
  })
}

async function loadProductDetail(): Promise<void> {
  const productId = detailProductId.value
  if (!canRead.value || productId === undefined) {
    return
  }

  detailAbortController?.abort()
  const controller = new AbortController()
  detailAbortController = controller
  const requestVersion = ++detailRequestVersion
  const authEpoch = appAccountStore.authEpoch
  detailLoading.value = true
  detailError.value = ''
  detailRequestId.value = undefined

  try {
    const response = await productsApi.getById(productId, controller.signal)
    if (!detailResponseIsCurrent(
      productId,
      requestVersion,
      authEpoch,
      controller,
    )) {
      return
    }
    detailProduct.value = adaptProductListItemDto(response.data)
  }
  catch (error) {
    if (
      isProductListAbortError(error)
      || !detailResponseIsCurrent(
        productId,
        requestVersion,
        authEpoch,
        controller,
      )
    ) {
      return
    }
    const failure = getProductListApiFailure(error)
    detailProduct.value = null
    detailError.value = failure.message
    detailRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === detailRequestVersion) {
      detailLoading.value = false
    }
  }
}

function showProductDetail(product: ProductListItemViewModel): void {
  detailProductId.value = product.id
  // 先用列表快照提供稳定布局，再立即 GET 替换为服务端最新详情。
  detailProduct.value = product
  detailVisible.value = true
  void loadProductDetail()
}

function closeProductDetail(): void {
  detailRequestVersion += 1
  detailAbortController?.abort()
  detailLoading.value = false
}

function navigateToEdit(productId: string): void {
  if (!canUpdate.value) {
    return
  }
  detailVisible.value = false
  void router.push({ name: 'adminProductEdit', params: { productId } })
}

const statusModalTitle = computed(() => (
  statusNext.value === 'ACTIVE' ? '启用产品' : '停用产品'
))
const statusModalDescription = computed(() => (
  statusNext.value === 'ACTIVE'
    ? '启用后该产品会重新出现在销售与采购选品中；启用前必须已有供应商、分类和产品头。'
    : '停用后该产品不再出现在销售与采购选品中，已有订单明细不受影响。'
))

function requestStatusChange(product: ProductListItemViewModel): void {
  if (!canUpdate.value) {
    return
  }
  statusAbortController?.abort()
  statusTarget.value = product
  statusNext.value = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  statusError.value = ''
  statusRequestId.value = undefined
  statusModalVisible.value = true
}

function closeStatusModal(): void {
  if (statusSubmitting.value) {
    return
  }
  statusAbortController?.abort()
  statusAbortController = null
  statusModalVisible.value = false
  statusTarget.value = null
  statusNext.value = null
  statusError.value = ''
  statusRequestId.value = undefined
}

async function submitStatusChange(): Promise<void> {
  const target = statusTarget.value
  const nextStatus = statusNext.value
  if (!canUpdate.value || target === null || nextStatus === null || statusSubmitting.value) {
    return
  }
  statusAbortController?.abort()
  const controller = new AbortController()
  statusAbortController = controller
  statusSubmitting.value = true
  statusError.value = ''
  statusRequestId.value = undefined
  let succeeded = false
  let reloadAfterConflict = false
  try {
    const response = await productsApi.update(target.id, {
      expectedVersion: target.version,
      status: nextStatus,
    }, controller.signal)
    if (controller.signal.aborted || !canUpdate.value) {
      return
    }
    const updated = adaptProductListItemDto(response.data)
    rows.value = rows.value.map(row => row.id === updated.id ? updated : row)
    if (detailProduct.value?.id === updated.id) {
      detailProduct.value = updated
    }
    succeeded = true
  }
  catch (error) {
    if (isProductListAbortError(error) || controller.signal.aborted) {
      return
    }
    const failure = getProductListApiFailure(error)
    statusError.value = failure.message
    statusRequestId.value = failure.requestId
    reloadAfterConflict = failure.code === 'PRODUCT_STATE_CHANGED'
  }
  finally {
    if (statusAbortController === controller) {
      statusAbortController = null
      statusSubmitting.value = false
    }
  }
  if (succeeded) {
    await nextTick()
    toast.success(`产品 ${target.productNo} 已${nextStatus === 'ACTIVE' ? '启用' : '停用'}`)
    closeStatusModal()
    return
  }
  if (reloadAfterConflict) {
    await nextTick()
    closeStatusModal()
    toast.error('产品已变化，列表已刷新，请重新操作')
    void loadProducts()
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listRequestVersion += 1
    listAbortController?.abort()
    detailRequestVersion += 1
    detailAbortController?.abort()
    loading.value = false
    rows.value = []
    total.value = 0
    listError.value = ''
    listRequestId.value = undefined
    detailVisible.value = false
    detailProductId.value = undefined
    detailProduct.value = null
    detailLoading.value = false
    detailError.value = ''
    detailRequestId.value = undefined
    statusAbortController?.abort()
    statusAbortController = null
    statusSubmitting.value = false
    statusModalVisible.value = false
    statusTarget.value = null
    statusNext.value = null
    statusError.value = ''
    statusRequestId.value = undefined
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
    void loadTaxonomyOptions()
  }
})

onBeforeUnmount(() => {
  listRequestVersion += 1
  listAbortController?.abort()
  detailRequestVersion += 1
  detailAbortController?.abort()
  taxonomyAbortController?.abort()
  taxonomyAbortController = null
  statusAbortController?.abort()
  statusAbortController = null
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      title="产品列表"
      description="集中查看产品基础资料、供应商、媒体、价格与审计信息。"
    >
      <FaButton v-if="canCreate" class="min-h-11 sm:min-h-9" @click="navigateToCreate">
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
        :action-column="{ fixed: 'right', width: 280 }"
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
            v-if="canReadProductMedia"
            :items="buildProductMainImageItems(row.original, canReadProductMedia)"
            :max-count="1"
            radius="lg"
            size="sm"
          />
          <span v-else class="qs-type-meta inline-flex gap-1 items-center">
            <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
          </span>
        </template>
        <template #cell-images="{ row }">
          <ImageGroup
            v-if="canReadProductMedia"
            :items="buildProductImageItems(row.original, canReadProductMedia)"
            :max-count="3"
            radius="lg"
            size="sm"
          />
          <span v-else class="qs-type-meta inline-flex gap-1 items-center">
            <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
          </span>
        </template>
        <template #cell-videos="{ row }">
          <FaButton
            v-if="canReadProductMedia && row.original.media.videos.length"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`查看产品 ${row.original.productNo} 的 ${row.original.media.videos.length} 个视频`"
            @click="showVideos(row.original)"
          >
            <FaIcon name="i-lucide:video" />
            {{ row.original.media.videos.length }} 个视频
          </FaButton>
          <span v-else-if="!canReadProductMedia" class="qs-type-meta inline-flex gap-1 items-center">
            <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
          </span>
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
            @click="showProductDetail(row)"
          >
            <FaIcon name="i-lucide:eye" />
            查看
          </FaButton>
          <FaButton
            v-if="canUpdate"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`编辑第 ${rowNumber} 行产品 ${row.productNo}`"
            @click="navigateToEdit(row.id)"
          >
            <FaIcon name="i-lucide:pencil" />
            编辑
          </FaButton>
          <FaButton
            v-if="canUpdate"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-9"
            :aria-label="`${row.status === 'ACTIVE' ? '停用' : '启用'}第 ${rowNumber} 行产品 ${row.productNo}`"
            @click="requestStatusChange(row)"
          >
            <FaIcon :name="row.status === 'ACTIVE' ? 'i-lucide:circle-pause' : 'i-lucide:circle-check'" />
            {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
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
                  v-if="canReadProductMedia"
                  :items="buildProductMainImageItems(row, canReadProductMedia)"
                  :max-count="1"
                  radius="lg"
                  :size="44"
                />
                <span v-else class="qs-type-meta inline-flex gap-1 items-center">
                  <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
                </span>
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                产品图片
              </dt><dd class="m-0">
                <ImageGroup
                  v-if="canReadProductMedia"
                  :items="buildProductImageItems(row, canReadProductMedia)"
                  :max-count="3"
                  radius="lg"
                  :size="44"
                />
                <span v-else class="qs-type-meta inline-flex gap-1 items-center">
                  <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
                </span>
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                产品视频
              </dt><dd class="m-0">
                <FaButton
                  v-if="canReadProductMedia && row.media.videos.length"
                  variant="ghost"
                  class="min-h-11"
                  :aria-label="`查看产品 ${row.productNo} 的 ${row.media.videos.length} 个视频`"
                  @click="showVideos(row)"
                >
                  <FaIcon name="i-lucide:video" />
                  {{ row.media.videos.length }} 个视频
                </FaButton>
                <span v-else-if="!canReadProductMedia" class="qs-type-meta inline-flex gap-1 items-center">
                  <FaIcon name="i-lucide:shield-alert" aria-hidden="true" />无权读取
                </span>
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
            <FaButton variant="outline" class="min-h-11" @click="showProductDetail(row)">
              <FaIcon name="i-lucide:eye" />查看
            </FaButton>
            <FaButton v-if="canUpdate" variant="outline" class="min-h-11" @click="navigateToEdit(row.id)">
              <FaIcon name="i-lucide:pencil" />编辑
            </FaButton>
            <FaButton
              v-if="canUpdate"
              variant="outline"
              class="min-h-11"
              @click="requestStatusChange(row)"
            >
              <FaIcon :name="row.status === 'ACTIVE' ? 'i-lucide:circle-pause' : 'i-lucide:circle-check'" />
              {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
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
      :auth-epoch="appAccountStore.authEpoch"
      :product="videosTarget"
      :content-readable="canReadProductMedia"
    />
    <ProductDetailDrawer
      v-model="detailVisible"
      :product="detailProduct"
      :currencies="currencies"
      :can-edit="canUpdate"
      :content-readable="canReadProductMedia"
      :loading="detailLoading"
      :error="detailError"
      :request-id="detailRequestId"
      @retry="loadProductDetail"
      @edit="navigateToEdit"
      @closed="closeProductDetail"
    />

    <QsGenericModal
      v-if="statusModalVisible"
      :model-value="statusModalVisible"
      :title="statusModalTitle"
      :description="statusModalDescription"
      :submitting="statusSubmitting"
      size="sm"
      @update:model-value="value => { if (!value) closeStatusModal() }"
    >
      <FaAlert
        v-if="statusError"
        title="状态更新失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <p class="m-0">
            {{ statusError }}
          </p>
          <code v-if="statusRequestId" class="text-xs font-mono mt-2 block break-all">
            requestId: {{ statusRequestId }}
          </code>
        </template>
      </FaAlert>
      <p v-else class="text-sm m-0">
        请确认是否继续。状态变更会立即影响后续销售与采购的选品范围。
      </p>
      <template #footer>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :disabled="statusSubmitting"
          @click="closeStatusModal"
        >
          取消
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :loading="statusSubmitting"
          @click="submitStatusChange"
        >
          确认{{ statusNext === 'ACTIVE' ? '启用' : '停用' }}
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
