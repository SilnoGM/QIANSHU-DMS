<script setup lang="ts">
import type { ProductBatchRunResult } from './product-batch-images.logic'
import type { ProductListItemViewModel } from './product-list.logic'
import type {
  ProductTaxonomyCategoryOptionDto,
  ProductTaxonomyTreeDto,
} from '@/api/generated/types.gen'
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
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import ProductAttributesModal from './product-attributes-modal.vue'
import ProductBatchImagesModal from './product-batch-images-modal.vue'
import {
  clearProductBatchPage,
  getProductBatchPageSelectionState,
  isProductBatchSelectionDisabled,
  PRODUCT_BATCH_SELECTION_COLUMN_ID,
  PRODUCT_BATCH_SELECTION_LIMIT,
  selectProductBatchPage,
  toggleProductBatchSelection,
  updateProductBatchSelectionSnapshot,
} from './product-batch-images.logic'
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
const canBatchSetImages = computed(() => auth('products:update'))
const selectedProducts = ref<ReadonlyMap<string, ProductListItemViewModel>>(new Map())
const batchImagesVisible = ref(false)
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
const taxonomyTree = shallowRef<ProductTaxonomyTreeDto | null>(null)
const treeLoading = ref(false)
const treeError = ref('')
const treeExpandedSuppliers = ref<ReadonlySet<string>>(new Set())
const treeExpandedCategories = ref<ReadonlySet<string>>(new Set())
const unclassifiedOnly = ref(false)
const productMovingId = ref<string | null>(null)
let treeAbortController: AbortController | null = null
let moveAbortController: AbortController | null = null
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
const selectedProductHeadFilterId = computed(() => (
  typeof filters.value.productHeadId === 'string'
  && filters.value.productHeadId !== ''
    ? filters.value.productHeadId
    : undefined
))
const selectedTreeKind = computed<'all' | 'supplier' | 'category' | 'head' | 'unclassified'>(() => {
  if (unclassifiedOnly.value) {
    return 'unclassified'
  }
  if (selectedCategoryFilterId.value !== undefined) {
    return selectedProductHeadFilterId.value === undefined ? 'category' : 'head'
  }
  return selectedSupplierFilterValue.value === undefined ? 'all' : 'supplier'
})
const canOrderProducts = computed(() => (
  canUpdate.value
  && selectedTreeKind.value === 'head'
  && searchKeyword.value.trim() === ''
  && filters.value.status === undefined
))
const lastPage = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
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

const selectedProductCount = computed(() => selectedProducts.value.size)
const selectedProductList = computed(() => [...selectedProducts.value.values()])
const pageSelectionState = computed(() => getProductBatchPageSelectionState(
  selectedProducts.value,
  rows.value,
))
const selectionColumn: QsGenericTableColumn<ProductListItemViewModel> = {
  accessorFn: item => item.id,
  align: 'center',
  enableHiding: false,
  fixed: 'left',
  id: PRODUCT_BATCH_SELECTION_COLUMN_ID,
  title: '选择',
  width: 56,
}

const productColumns: QsGenericTableColumn<ProductListItemViewModel>[] = [
  {
    accessorKey: 'productNo',
    id: 'productNo',
    width: 150,
    minWidth: 140,
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

const columns = computed<QsGenericTableColumn<ProductListItemViewModel>[]>(() => (
  canBatchSetImages.value
    ? [selectionColumn, ...productColumns]
    : productColumns
))

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

async function loadTaxonomyTree(): Promise<void> {
  treeAbortController?.abort()
  const controller = new AbortController()
  treeAbortController = controller
  treeLoading.value = true
  treeError.value = ''
  try {
    const response = await productsApi.taxonomyTree(controller.signal)
    if (controller.signal.aborted || !canRead.value) {
      return
    }
    taxonomyTree.value = response.data
  }
  catch {
    if (!controller.signal.aborted) {
      taxonomyTree.value = null
      treeError.value = '分类目录加载失败，请重试'
    }
  }
  finally {
    if (treeAbortController === controller) {
      treeAbortController = null
      treeLoading.value = false
    }
  }
}

function supplierLabel(supplierValue: string): string {
  return supplierLabelByValue.value.get(supplierValue) ?? supplierValue
}

function toggleTreeSupplier(supplierValue: string): void {
  const next = new Set(treeExpandedSuppliers.value)
  if (next.has(supplierValue)) {
    next.delete(supplierValue)
  }
  else { next.add(supplierValue) }
  treeExpandedSuppliers.value = next
}

function toggleTreeCategory(categoryId: string): void {
  const next = new Set(treeExpandedCategories.value)
  if (next.has(categoryId)) {
    next.delete(categoryId)
  }
  else { next.add(categoryId) }
  treeExpandedCategories.value = next
}

function expandTreeSupplier(supplierValue: string): void {
  if (!treeExpandedSuppliers.value.has(supplierValue)) {
    treeExpandedSuppliers.value = new Set([
      ...treeExpandedSuppliers.value,
      supplierValue,
    ])
  }
}

function expandTreeCategory(categoryId: string): void {
  if (!treeExpandedCategories.value.has(categoryId)) {
    treeExpandedCategories.value = new Set([
      ...treeExpandedCategories.value,
      categoryId,
    ])
  }
}

function applyTreeSelection(
  nextFilters: QsGenericTableFilterValues,
  unclassified: boolean,
): void {
  clearProductSelection()
  unclassifiedOnly.value = unclassified
  filters.value = nextFilters
  page.value = 1
  scheduleQueryRefresh()
}

function selectTreeAll(): void {
  applyTreeSelection({}, false)
}

function selectTreeSupplier(supplierValue: string): void {
  expandTreeSupplier(supplierValue)
  applyTreeSelection({ supplierValue }, false)
}

function selectTreeCategory(supplierValue: string, categoryId: string): void {
  expandTreeSupplier(supplierValue)
  expandTreeCategory(categoryId)
  applyTreeSelection({ supplierValue, categoryId }, false)
}

function selectTreeHead(
  supplierValue: string,
  categoryId: string,
  productHeadId: string,
): void {
  expandTreeSupplier(supplierValue)
  expandTreeCategory(categoryId)
  applyTreeSelection({ supplierValue, categoryId, productHeadId }, false)
}

function selectTreeUnclassified(supplierValue?: string): void {
  if (supplierValue !== undefined) {
    expandTreeSupplier(supplierValue)
  }
  applyTreeSelection(
    supplierValue === undefined ? {} : { supplierValue },
    true,
  )
}

function isTreeSupplierActive(supplierValue: string): boolean {
  return selectedTreeKind.value === 'supplier'
    && selectedSupplierFilterValue.value === supplierValue
}

function isTreeCategoryActive(categoryId: string): boolean {
  return selectedTreeKind.value === 'category'
    && selectedCategoryFilterId.value === categoryId
}

function isTreeHeadActive(productHeadId: string): boolean {
  return selectedTreeKind.value === 'head'
    && selectedProductHeadFilterId.value === productHeadId
}

function isTreeUnclassifiedActive(supplierValue?: string): boolean {
  if (selectedTreeKind.value !== 'unclassified') {
    return false
  }
  return supplierValue === undefined
    ? selectedSupplierFilterValue.value === undefined
    : selectedSupplierFilterValue.value === supplierValue
}

function rowIndex(productId: string): number {
  return rows.value.findIndex(item => item.id === productId)
}

function isFirstProductRow(productId: string): boolean {
  return page.value === 1 && rowIndex(productId) === 0
}

function isLastProductRow(productId: string): boolean {
  return page.value >= lastPage.value
    && rowIndex(productId) === rows.value.length - 1
}

async function moveProduct(
  productId: string,
  direction: 'up' | 'down',
): Promise<void> {
  if (!canOrderProducts.value || productMovingId.value !== null) {
    return
  }
  moveAbortController?.abort()
  const controller = new AbortController()
  moveAbortController = controller
  productMovingId.value = productId
  try {
    await productsApi.move(productId, { direction }, controller.signal)
    if (controller.signal.aborted) {
      return
    }
    await loadProducts()
  }
  catch (error) {
    if (isProductListAbortError(error) || controller.signal.aborted) {
      return
    }
    toast.error(getProductListApiFailure(error).message)
  }
  finally {
    if (moveAbortController === controller) {
      moveAbortController = null
      productMovingId.value = null
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
      unclassified: unclassifiedOnly.value,
    }), controller.signal)
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    const nextPage = adaptProductPageDto(response.data)
    rows.value = [...nextPage.items]
    // 列表刷新只同步已选快照；分页切换时当前页之外的选择保持不变。
    selectedProducts.value = updateProductBatchSelectionSnapshot(
      selectedProducts.value,
      nextPage.items,
    )
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

function toggleProductSelection(
  product: ProductListItemViewModel,
  checked: boolean,
): void {
  const result = toggleProductBatchSelection(
    selectedProducts.value,
    product,
    checked,
  )
  if (result.changed) {
    selectedProducts.value = result.selected
  }
}

function isProductSelectionDisabled(product: ProductListItemViewModel): boolean {
  return isProductBatchSelectionDisabled(selectedProducts.value, product)
}

function selectCurrentPage(): void {
  const result = selectProductBatchPage(selectedProducts.value, rows.value)
  if (result.selected !== selectedProducts.value) {
    selectedProducts.value = result.selected
  }
  if (result.limited) {
    toast.warning(`单次最多选择 ${PRODUCT_BATCH_SELECTION_LIMIT} 个产品`)
  }
}

function clearCurrentPageSelection(): void {
  const next = clearProductBatchPage(selectedProducts.value, rows.value)
  if (next !== selectedProducts.value) {
    selectedProducts.value = next
  }
}

function clearProductSelection(): void {
  if (selectedProducts.value.size > 0) {
    selectedProducts.value = new Map()
  }
}

function toggleCurrentPageSelection(
  value: boolean | 'indeterminate' | null | undefined,
): void {
  if (value === true) {
    selectCurrentPage()
    return
  }
  clearCurrentPageSelection()
}

function openBatchImages(): void {
  if (!canBatchSetImages.value || selectedProductCount.value === 0) {
    return
  }
  batchImagesVisible.value = true
}

function handleBatchImagesFinished(result: ProductBatchRunResult): void {
  if (result.successfulProductIds.length === 0) {
    return
  }
  const next = new Map(selectedProducts.value)
  for (const productId of result.successfulProductIds) {
    next.delete(productId)
  }
  selectedProducts.value = next
}

function handleBatchImagesClosed(changed: boolean): void {
  batchImagesVisible.value = false
  if (changed) {
    void loadProducts()
  }
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  clearProductSelection()
  unclassifiedOnly.value = false
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
  clearProductSelection()
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
    const response = await productsApi.updateStatus(target.id, {
      expectedVersion: target.version,
      status: nextStatus,
    }, controller.signal)
    if (controller.signal.aborted || !canUpdate.value) {
      return
    }
    const updated = adaptProductListItemDto(response.data)
    rows.value = rows.value.map(row => row.id === updated.id ? updated : row)
    selectedProducts.value = updateProductBatchSelectionSnapshot(
      selectedProducts.value,
      [updated],
    )
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
    clearProductSelection()
    batchImagesVisible.value = false
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
      unclassifiedOnly.value = false
    }
    if (nextCanRead) {
      void loadProducts()
      void loadTaxonomyTree()
    }
  },
)

watch(canBatchSetImages, (allowed) => {
  if (!allowed) {
    clearProductSelection()
    batchImagesVisible.value = false
  }
})

onMounted(() => {
  if (canRead.value) {
    void loadProducts()
    void loadTaxonomyOptions()
    void loadTaxonomyTree()
  }
})

onBeforeUnmount(() => {
  listRequestVersion += 1
  listAbortController?.abort()
  detailRequestVersion += 1
  detailAbortController?.abort()
  taxonomyAbortController?.abort()
  taxonomyAbortController = null
  treeAbortController?.abort()
  treeAbortController = null
  moveAbortController?.abort()
  moveAbortController = null
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
      <FaButton
        v-if="canBatchSetImages"
        variant="outline"
        class="min-h-11 sm:min-h-9"
        :disabled="selectedProductCount === 0"
        :aria-label="`批量设置图片，已选 ${selectedProductCount} 个产品`"
        @click="openBatchImages"
      >
        <FaIcon name="i-lucide:images" />
        批量设置图片<span v-if="selectedProductCount > 0">（{{ selectedProductCount }}）</span>
      </FaButton>
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

      <div class="gap-4 grid min-w-0 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          class="border border-border rounded-xl bg-muted/15 flex-col min-h-0 min-w-0 hidden overflow-hidden xl:flex xl:max-h-[calc(100vh-8rem)] xl:top-4 xl:sticky"
          aria-label="产品分类目录"
        >
          <div class="px-3 py-2 border-b border-border bg-muted/25 flex shrink-0 gap-2 items-center justify-between">
            <h2 class="text-sm font-semibold m-0">
              分类目录
            </h2>
            <span class="text-[11px] text-muted-foreground tabular-nums">
              {{ taxonomyTree?.totalProducts ?? 0 }}
            </span>
          </div>
          <div class="p-2 flex-1 min-h-0 overflow-y-auto">
            <div v-if="treeLoading" class="text-xs text-muted-foreground px-2 py-6 text-center" role="status">
              正在加载分类…
            </div>
            <div v-else-if="treeError" class="px-2 py-4 text-center gap-2 grid">
              <p class="text-xs text-destructive m-0">
                {{ treeError }}
              </p>
              <FaButton type="button" variant="outline" size="sm" @click="loadTaxonomyTree">
                重试
              </FaButton>
            </div>
            <template v-else>
              <button
                type="button"
                class="text-sm px-2 rounded-md flex gap-2 min-h-8 w-full transition-colors items-center"
                :class="selectedTreeKind === 'all'
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-foreground hover:bg-background/70'"
                :aria-pressed="selectedTreeKind === 'all'"
                @click="selectTreeAll"
              >
                <span class="text-left flex-1 truncate">全部产品</span>
                <span class="text-[11px] tabular-nums">{{ taxonomyTree?.totalProducts ?? 0 }}</span>
              </button>

              <div
                v-for="supplier in taxonomyTree?.suppliers ?? []"
                :key="supplier.supplierValue"
                class="mt-1 min-w-0"
              >
                <div class="flex min-w-0 items-center">
                  <button
                    type="button"
                    class="text-muted-foreground rounded-md shrink-0 grid size-6 place-items-center hover:text-foreground"
                    :aria-label="`${treeExpandedSuppliers.has(supplier.supplierValue) ? '收起' : '展开'}供应商 ${supplierLabel(supplier.supplierValue)}`"
                    :aria-expanded="treeExpandedSuppliers.has(supplier.supplierValue)"
                    @click="toggleTreeSupplier(supplier.supplierValue)"
                  >
                    <FaIcon
                      :name="treeExpandedSuppliers.has(supplier.supplierValue) ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'"
                      class="size-3.5"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    class="text-sm px-1.5 rounded-md flex flex-1 gap-2 min-h-8 min-w-0 transition-colors items-center"
                    :class="isTreeSupplierActive(supplier.supplierValue)
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-foreground hover:bg-background/70'"
                    :aria-pressed="isTreeSupplierActive(supplier.supplierValue)"
                    @click="selectTreeSupplier(supplier.supplierValue)"
                  >
                    <span class="text-left flex-1 truncate">{{ supplierLabel(supplier.supplierValue) }}</span>
                    <span class="text-[11px] tabular-nums">{{ supplier.productCount }}</span>
                  </button>
                </div>

                <div
                  v-if="treeExpandedSuppliers.has(supplier.supplierValue)"
                  class="pl-5 gap-0.5 grid min-w-0"
                >
                  <div
                    v-for="category in supplier.categories"
                    :key="category.id"
                    class="min-w-0"
                  >
                    <div class="flex min-w-0 items-center">
                      <button
                        v-if="category.productHeads.length > 0"
                        type="button"
                        class="text-muted-foreground rounded-md shrink-0 grid size-5 place-items-center hover:text-foreground"
                        :aria-label="`${treeExpandedCategories.has(category.id) ? '收起' : '展开'} ${category.name} 的产品头`"
                        :aria-expanded="treeExpandedCategories.has(category.id)"
                        @click="toggleTreeCategory(category.id)"
                      >
                        <FaIcon
                          :name="treeExpandedCategories.has(category.id) ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'"
                          class="size-3"
                          aria-hidden="true"
                        />
                      </button>
                      <span v-else class="shrink-0 size-5" aria-hidden="true" />
                      <button
                        type="button"
                        class="text-xs px-1.5 rounded-md flex flex-1 gap-2 min-h-8 min-w-0 transition-colors items-center"
                        :class="isTreeCategoryActive(category.id)
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
                        :aria-pressed="isTreeCategoryActive(category.id)"
                        @click="selectTreeCategory(supplier.supplierValue, category.id)"
                      >
                        <span class="text-left flex-1 truncate">{{ category.name }}</span>
                        <span class="text-[11px] tabular-nums">{{ category.productCount }}</span>
                      </button>
                    </div>

                    <div
                      v-if="category.productHeads.length > 0 && treeExpandedCategories.has(category.id)"
                      class="pl-5 gap-0.5 grid min-w-0"
                    >
                      <button
                        v-for="head in category.productHeads"
                        :key="head.id"
                        type="button"
                        class="text-xs px-1.5 rounded-md flex gap-2 min-h-8 min-w-0 transition-colors items-center"
                        :class="isTreeHeadActive(head.id)
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
                        :aria-pressed="isTreeHeadActive(head.id)"
                        @click="selectTreeHead(supplier.supplierValue, category.id, head.id)"
                      >
                        <span class="text-left flex-1 truncate">{{ head.name }}</span>
                        <span class="text-[11px] tabular-nums">{{ head.productCount }}</span>
                      </button>
                    </div>
                  </div>

                  <button
                    v-if="supplier.unclassifiedCount > 0"
                    type="button"
                    class="text-xs px-1.5 rounded-md flex gap-2 min-h-8 min-w-0 transition-colors items-center"
                    :class="isTreeUnclassifiedActive(supplier.supplierValue)
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
                    :aria-pressed="isTreeUnclassifiedActive(supplier.supplierValue)"
                    @click="selectTreeUnclassified(supplier.supplierValue)"
                  >
                    <span class="text-left flex-1 truncate">未分类</span>
                    <span class="text-[11px] tabular-nums">{{ supplier.unclassifiedCount }}</span>
                  </button>
                </div>
              </div>

              <button
                v-if="(taxonomyTree?.unclassifiedCount ?? 0) > 0"
                type="button"
                class="text-sm mt-1 px-2 rounded-md flex gap-2 min-h-8 w-full transition-colors items-center"
                :class="isTreeUnclassifiedActive()
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-foreground hover:bg-background/70'"
                :aria-pressed="isTreeUnclassifiedActive()"
                @click="selectTreeUnclassified()"
              >
                <span class="text-left flex-1 truncate">未分类</span>
                <span class="text-[11px] tabular-nums">{{ taxonomyTree?.unclassifiedCount ?? 0 }}</span>
              </button>
            </template>
          </div>
        </aside>

        <section class="min-w-0">
          <div
            v-if="canBatchSetImages && selectedProductCount > 0"
            class="mb-3 px-3 py-2 border border-border rounded-xl bg-muted/20 flex flex-wrap gap-2 items-center justify-between"
          >
            <p class="qs-type-meta m-0" aria-live="polite">
              已选 {{ selectedProductCount }} 个产品（选择上限 {{ PRODUCT_BATCH_SELECTION_LIMIT }} 个）
            </p>
            <div class="flex flex-wrap gap-2 items-center">
              <FaButton
                type="button"
                variant="outline"
                size="sm"
                class="min-h-11 sm:min-h-9"
                @click="selectCurrentPage"
              >
                全选本页
              </FaButton>
              <FaButton
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-9"
                @click="clearCurrentPageSelection"
              >
                取消本页选择
              </FaButton>
              <FaButton
                type="button"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-9"
                @click="clearProductSelection"
              >
                清空选择
              </FaButton>
            </div>
          </div>

          <QsGenericTable
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:search="searchKeyword"
            v-model:filters="filters"
            data-testid="product-list-table"
            :row-key="item => item.id"
            :action-column="{ fixed: 'right', width: 320 }"
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
            table-class="min-w-[2656px]"
            @filter-change="handleFilterChange"
            @pagination-change="handlePaginationChange"
            @retry="loadProducts"
            @search="handleSearch"
          >
            <template #header-selection>
              <FaCheckbox
                :model-value="pageSelectionState"
                :disabled="rows.length === 0"
                class="justify-center"
                @update:model-value="toggleCurrentPageSelection"
              >
                <span class="sr-only">全选当前页产品</span>
              </FaCheckbox>
            </template>
            <template #cell-selection="{ row }">
              <FaCheckbox
                :model-value="selectedProducts.has(row.original.id)"
                :disabled="isProductSelectionDisabled(row.original)"
                class="justify-center"
                @update:model-value="value => toggleProductSelection(row.original, value === true)"
              >
                <span class="sr-only">选择产品 {{ row.original.productNo }}</span>
              </FaCheckbox>
            </template>
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
              <QsPersonDisplay v-if="row.original.createdBy" :display-name="row.original.createdBy.displayName" size="sm" />
              <span v-else class="text-muted-foreground">—</span>
            </template>
            <template #cell-updatedAt="{ row }">
              <DateTimeDisplay :value="row.original.updatedAt" />
            </template>
            <template #cell-updatedBy="{ row }">
              <QsPersonDisplay v-if="row.original.updatedBy" :display-name="row.original.updatedBy.displayName" size="sm" />
              <span v-else class="text-muted-foreground">—</span>
            </template>

            <template #actions="{ row, rowNumber }">
              <FaButton
                v-if="canOrderProducts"
                variant="ghost"
                size="icon"
                class="size-11 sm:size-8"
                :disabled="productMovingId !== null || isFirstProductRow(row.id)"
                :aria-label="`上移产品 ${row.productNo}`"
                @click="moveProduct(row.id, 'up')"
              >
                <FaIcon name="i-lucide:arrow-up" class="size-4" />
              </FaButton>
              <FaButton
                v-if="canOrderProducts"
                variant="ghost"
                size="icon"
                class="size-11 sm:size-8"
                :disabled="productMovingId !== null || isLastProductRow(row.id)"
                :aria-label="`下移产品 ${row.productNo}`"
                @click="moveProduct(row.id, 'down')"
              >
                <FaIcon name="i-lucide:arrow-down" class="size-4" />
              </FaButton>
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
                <div class="flex flex-1 gap-2 min-w-0 items-start">
                  <FaCheckbox
                    v-if="canBatchSetImages"
                    :model-value="selectedProducts.has(row.id)"
                    :disabled="isProductSelectionDisabled(row)"
                    class="mt-0.5"
                    @update:model-value="value => toggleProductSelection(row, value === true)"
                  >
                    <span class="sr-only">选择产品 {{ row.productNo }}</span>
                  </FaCheckbox>
                  <div class="min-w-0">
                    <div class="qs-type-data-emphasis font-mono break-all">
                      {{ row.productNo }}
                    </div>
                    <div class="qs-type-body mt-1">
                      {{ row.name }}
                    </div>
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
                    <QsPersonDisplay v-if="row.createdBy" :display-name="row.createdBy.displayName" size="sm" />
                    <span v-else>—</span>
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
                    <QsPersonDisplay v-if="row.updatedBy" :display-name="row.updatedBy.displayName" size="sm" />
                    <span v-else>—</span>
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
                <FaButton
                  v-if="canOrderProducts"
                  variant="outline"
                  size="icon"
                  class="min-h-11"
                  :disabled="productMovingId !== null || isFirstProductRow(row.id)"
                  :aria-label="`上移产品 ${row.productNo}`"
                  @click="moveProduct(row.id, 'up')"
                >
                  <FaIcon name="i-lucide:arrow-up" />
                </FaButton>
                <FaButton
                  v-if="canOrderProducts"
                  variant="outline"
                  size="icon"
                  class="min-h-11"
                  :disabled="productMovingId !== null || isLastProductRow(row.id)"
                  :aria-label="`下移产品 ${row.productNo}`"
                  @click="moveProduct(row.id, 'down')"
                >
                  <FaIcon name="i-lucide:arrow-down" />
                </FaButton>
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
        </section>
      </div>
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
    <ProductBatchImagesModal
      v-model="batchImagesVisible"
      :content-readable="canReadProductMedia"
      :products="selectedProductList"
      @closed="handleBatchImagesClosed"
      @finished="handleBatchImagesFinished"
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
