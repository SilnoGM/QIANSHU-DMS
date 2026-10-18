<script setup lang="ts">
import type {
  ProductFieldErrors,
  ProductFormModel,
} from '../form/product-form.logic'
import type {
  ProductListItemDto,
  ProductTaxonomyCategoryDto,
  UpdateProductRequestDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import productsApi from '@/api/modules/products'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import { createProductFormModel } from '../form/product-form.logic'
import ProductForm from '../form/product-form.vue'
import ProductMediaPanel from '../media/product-media-panel.vue'
import {
  buildProductUpdateRequest,
  createProductEditFormModel,
  getProductUpdateFailure,
  hasProductEditChanges,
  reconcileProductUpdateResult,
} from './product-edit.logic'

type CatalogState = 'empty' | 'error' | 'loading' | 'ready'
type EditPhase
  = | 'conflict'
    | 'editing'
    | 'error'
    | 'loading'
    | 'reconciling'
    | 'submitting'
    | 'success'
    | 'unknown'

interface ProductFormExpose {
  applyFieldErrors: (
    errors: ProductFieldErrors,
    focusFirst?: boolean,
  ) => Promise<void>
  resetValidation: () => void
}

defineOptions({ name: 'AdminProductEdit' })

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const route = useRoute()
const router = useRouter()
const appAccountStore = useAppAccountStore()
const { auth, authAll } = useAppAuth()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog(SUPPLIER_DICTIONARY_CODE)
const formRef = useTemplateRef<ProductFormExpose>('formRef')

const phase = ref<EditPhase>('loading')
const source = shallowRef<ProductListItemDto | null>(null)
const formModel = ref<ProductFormModel>(createProductFormModel())
const fieldErrors = ref<ProductFieldErrors>({})
const pageError = ref('')
const requestId = ref<string>()
const discardVisible = ref(false)
const taxonomyOptions = shallowRef<readonly ProductTaxonomyCategoryDto[]>([])
const taxonomyState = ref<CatalogState>('loading')
let pendingNavigationResolver: ((allow: boolean) => void) | null = null
let operationVersion = 0
let operationAbortController: AbortController | null = null
let taxonomyAbortController: AbortController | null = null

const productId = computed(() => typeof route.params.productId === 'string'
  ? route.params.productId
  : '')
const canManage = computed(() => authAll(['products:read', 'products:update']))
const canUpdate = computed(() => auth('products:update'))
const canReadProductMedia = computed(() => auth('product-media:read'))
const purchaseCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  currencyCatalog.selectableCurrencies.value)
const twdCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  purchaseCurrencies.value.filter(currency => currency.code === 'TWD'))
const myrCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  purchaseCurrencies.value.filter(currency => currency.code === 'MYR'))
const currencyCatalogState = computed<CatalogState>(() => {
  if (currencyCatalog.loading.value) {
    return 'loading'
  }
  if (currencyCatalog.errorMessage.value !== null) {
    return 'error'
  }
  return purchaseCurrencies.value.length === 0 ? 'empty' : 'ready'
})
const supplierCatalogState = computed<CatalogState>(() => {
  if (supplierCatalog.loading.value) {
    return 'loading'
  }
  if (
    supplierCatalog.invalid.value
    || supplierCatalog.error.value !== null
    || supplierCatalog.missing.value
    || supplierCatalog.catalog.value === null
  ) {
    return 'error'
  }
  return supplierCatalog.selectableItems.value.length === 0 ? 'empty' : 'ready'
})
const moneyPrecisions = computed(() => {
  const purchase = purchaseCurrencies.value.find(
    currency => currency.code === formModel.value.purchaseCostCurrency,
  )
  return {
    myrSalePricePrecision: myrCurrencies.value[0]?.minorUnit ?? 4,
    purchaseCostPrecision: purchase?.minorUnit ?? 4,
    twdSalePricePrecision: twdCurrencies.value[0]?.minorUnit ?? 4,
  }
})
const dirty = computed(() => source.value !== null && hasProductEditChanges(
  formModel.value,
  source.value,
  moneyPrecisions.value,
))
const formLocked = computed(() => phase.value === 'submitting'
  || phase.value === 'reconciling'
  || phase.value === 'unknown')

function responseIsCurrent(
  version: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return !controller.signal.aborted
    && canManage.value
    && version === operationVersion
    && authEpoch === appAccountStore.authEpoch
}

function clearFeedback(): void {
  fieldErrors.value = {}
  pageError.value = ''
  requestId.value = undefined
  formRef.value?.resetValidation()
}

function handleModelPatch(patch: Partial<ProductFormModel>): void {
  if (phase.value !== 'editing') {
    return
  }
  formModel.value = { ...formModel.value, ...patch }
  if (pageError.value !== '' || Object.keys(fieldErrors.value).length > 0) {
    clearFeedback()
  }
}

/**
 * 媒体 mutation 只推进共享 Product version 与媒体快照，不重建基础表单。
 * 这样用户正在编辑的字段不会被上传、排序或解除关联的响应覆盖。
 */
function handleMediaProductChange(product: ProductListItemDto): void {
  if (source.value?.id !== product.id) {
    return
  }
  source.value = product
}

async function loadTaxonomyOptions(): Promise<void> {
  taxonomyAbortController?.abort()
  const controller = new AbortController()
  taxonomyAbortController = controller
  taxonomyState.value = 'loading'
  try {
    const response = await productsApi.taxonomyOptions(controller.signal)
    if (controller.signal.aborted || !canManage.value) {
      return
    }
    taxonomyOptions.value = response.data.categories
    taxonomyState.value = response.data.categories.length === 0 ? 'empty' : 'ready'
  }
  catch {
    if (controller.signal.aborted) {
      return
    }
    taxonomyOptions.value = []
    taxonomyState.value = 'error'
  }
}

async function loadProduct(): Promise<void> {
  if (!canManage.value || productId.value === '') {
    return
  }

  operationAbortController?.abort()
  const controller = new AbortController()
  operationAbortController = controller
  const version = ++operationVersion
  const authEpoch = appAccountStore.authEpoch
  phase.value = 'loading'
  clearFeedback()

  try {
    const response = await productsApi.getById(productId.value, controller.signal)
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    source.value = response.data
    formModel.value = createProductEditFormModel(response.data)
    phase.value = 'editing'
  }
  catch (error) {
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    const failure = getProductUpdateFailure(error)
    pageError.value = failure.message
    requestId.value = failure.requestId
    phase.value = 'error'
  }
}

function collectCatalogErrors(request: UpdateProductRequestDto): ProductFieldErrors {
  const errors: Record<string, string> = {}
  const validatesAll = formModel.value.status === 'ACTIVE'
  const validatesSupplier = validatesAll || request.supplierValue !== undefined
  if (validatesSupplier && formModel.value.supplierValue !== null) {
    if (supplierCatalogState.value !== 'ready') {
      errors.supplierValue = '请先完成供应商资料加载'
    }
    else if (supplierCatalog.resolve(formModel.value.supplierValue)?.status !== 'ACTIVE') {
      errors.supplierValue = '请选择当前有效的供应商'
    }
  }

  const moneyFields = validatesAll
    ? ['twdSalePrice', 'myrSalePrice', 'purchaseCost'] as const
    : (['twdSalePrice', 'myrSalePrice', 'purchaseCost'] as const)
        .filter(field => request[field] !== undefined)
  if (moneyFields.length > 0 && currencyCatalogState.value !== 'ready') {
    for (const field of moneyFields) {
      errors[`${field}.currency`] = '请先完成货币资料加载'
    }
  }
  if (moneyFields.includes('twdSalePrice') && twdCurrencies.value.length !== 1) {
    errors['twdSalePrice.currency'] = '当前缺少有效的 TWD 货币'
  }
  if (moneyFields.includes('myrSalePrice') && myrCurrencies.value.length !== 1) {
    errors['myrSalePrice.currency'] = '当前缺少有效的 MYR 货币'
  }
  if (
    moneyFields.includes('purchaseCost')
    && !purchaseCurrencies.value.some(
      currency => currency.code === formModel.value.purchaseCostCurrency,
    )
  ) {
    errors['purchaseCost.currency'] = '请选择当前有效的采购币种'
  }
  return errors
}

async function reconcileUnknownUpdate(
  request: Readonly<UpdateProductRequestDto>,
  version: number,
  authEpoch: number,
): Promise<void> {
  phase.value = 'reconciling'
  const controller = new AbortController()
  operationAbortController = controller
  try {
    const response = await productsApi.getById(productId.value, controller.signal)
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    if (reconcileProductUpdateResult(request, response.data) === 'success') {
      phase.value = 'success'
      toast.success(`产品 ${response.data.productNo} 已更新`)
      await router.push({ name: 'adminProductList' })
      return
    }
    source.value = response.data
    phase.value = 'unknown'
    pageError.value = '更新结果无法自动确认，请返回列表核对最新资料。'
  }
  catch {
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    phase.value = 'unknown'
    pageError.value = '更新结果与最新产品资料均无法确认，请稍后返回列表核对。'
  }
}

async function submitProduct(): Promise<void> {
  if (!canManage.value || phase.value !== 'editing' || source.value === null) {
    return
  }

  const result = buildProductUpdateRequest(
    formModel.value,
    source.value,
    moneyPrecisions.value,
  )
  if (!result.valid) {
    fieldErrors.value = result.fieldErrors
    pageError.value = '部分资料未通过校验，请检查后重试'
    await formRef.value?.applyFieldErrors(result.fieldErrors, true)
    return
  }
  if ('unchanged' in result) {
    toast.info('没有需要保存的修改')
    return
  }

  const catalogErrors = collectCatalogErrors(result.request)
  if (Object.keys(catalogErrors).length > 0) {
    fieldErrors.value = catalogErrors
    pageError.value = '外部资料未通过校验，请检查后重试'
    await formRef.value?.applyFieldErrors(catalogErrors, true)
    return
  }

  operationAbortController?.abort()
  const controller = new AbortController()
  operationAbortController = controller
  const version = ++operationVersion
  const authEpoch = appAccountStore.authEpoch
  const request = Object.freeze({ ...result.request })
  phase.value = 'submitting'
  clearFeedback()

  try {
    const response = await productsApi.update(
      productId.value,
      request,
      controller.signal,
    )
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    source.value = response.data
    phase.value = 'success'
    toast.success(`产品 ${response.data.productNo} 已更新`)
    await router.push({ name: 'adminProductList' })
  }
  catch (error) {
    if (!responseIsCurrent(version, authEpoch, controller)) {
      return
    }
    const failure = getProductUpdateFailure(error)
    fieldErrors.value = failure.fieldErrors
    pageError.value = failure.message
    requestId.value = failure.requestId
    if (failure.phase === 'reconciling') {
      await reconcileUnknownUpdate(request, version, authEpoch)
      return
    }
    phase.value = failure.phase
    if (failure.phase === 'editing') {
      await formRef.value?.applyFieldErrors(failure.fieldErrors, true)
    }
  }
}

function returnToList(): void {
  void router.push({ name: 'adminProductList' })
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value && phase.value !== 'unknown') {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if ((!dirty.value && phase.value !== 'unknown') || phase.value === 'success') {
    return true
  }
  if (pendingNavigationResolver !== null) {
    return false
  }
  discardVisible.value = true
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
  })
})

function closeDiscard(): void {
  discardVisible.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(false)
}

function confirmDiscard(): void {
  discardVisible.value = false
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(true)
}

watch(
  [() => appAccountStore.authEpoch, canManage, productId],
  (
    [nextEpoch, nextCanManage, nextProductId],
    [previousEpoch, previousCanManage, previousProductId],
  ) => {
    operationVersion += 1
    operationAbortController?.abort()
    source.value = null
    formModel.value = createProductFormModel()
    if (
      nextCanManage
      && (
        !previousCanManage
        || nextEpoch !== previousEpoch
        || nextProductId !== previousProductId
      )
    ) {
      void loadProduct()
    }
  },
)

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  if (canManage.value) {
    void loadProduct()
    void loadTaxonomyOptions()
  }
})

onBeforeUnmount(() => {
  operationVersion += 1
  operationAbortController?.abort()
  taxonomyAbortController?.abort()
  taxonomyAbortController = null
  window.removeEventListener('beforeunload', handleBeforeUnload)
  pendingNavigationResolver?.(false)
  pendingNavigationResolver = null
})
</script>

<template>
  <div class="product-edit-page min-w-0" data-testid="product-edit-page">
    <FaPageHeader
      title="编辑产品"
      :description="source === null
        ? '读取产品最新资料后进行安全编辑。'
        : `产品编号 ${source.productNo} · 数据版本 v${source.version}`"
    >
      <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="formLocked" @click="returnToList">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />返回产品列表
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canManage">
      <FaEmpty icon="i-lucide:shield-alert" title="无权编辑产品" description="当前身份需要 products:read 与 products:update 权限。" class="py-12" />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <div v-if="phase === 'loading'" class="py-16 flex gap-2 items-center justify-center" role="status">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" />正在读取产品资料…
      </div>

      <FaAlert v-else-if="phase === 'error'" variant="destructive" role="alert" title="产品资料加载失败" icon="i-lucide:circle-alert">
        <template #description>
          <div class="gap-3 grid">
            <span>{{ pageError }}</span><code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
            <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="loadProduct">
              重新加载
            </FaButton>
          </div>
        </template>
      </FaAlert>

      <template v-else-if="source !== null">
        <FaAlert v-if="phase === 'conflict'" class="mb-5" variant="destructive" role="alert" title="产品已被其他操作更新" icon="i-lucide:git-compare-arrows">
          <template #description>
            <div class="gap-3 grid">
              <span>{{ pageError }}。请加载最新版本后重新编辑。</span><code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
              <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="loadProduct">
                加载最新版本
              </FaButton>
            </div>
          </template>
        </FaAlert>
        <FaAlert v-else-if="phase === 'reconciling'" class="mb-5" role="status" title="正在确认更新结果" description="不会自动重放 PATCH，系统正在读取最新产品资料进行对账。" icon="i-lucide:refresh-cw" />
        <FaAlert v-else-if="phase === 'unknown'" class="mb-5" variant="destructive" role="alert" title="更新结果无法确认" icon="i-lucide:circle-help">
          <template #description>
            <div class="gap-3 grid">
              <span>{{ pageError }}</span><code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code><FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="returnToList">
                返回列表人工核对
              </FaButton>
            </div>
          </template>
        </FaAlert>
        <FaAlert v-else-if="pageError" class="mb-5" variant="destructive" role="alert" title="产品保存失败" icon="i-lucide:circle-alert">
          <template #description>
            <div class="gap-2 grid">
              <span>{{ pageError }}</span><code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
            </div>
          </template>
        </FaAlert>

        <ProductForm
          ref="formRef"
          mode="edit"
          :product-no="source.productNo"
          :model-value="formModel"
          :currency-catalog-state="currencyCatalogState"
          :supplier-catalog-state="supplierCatalogState"
          :taxonomy-catalog-state="taxonomyState"
          :taxonomy-options="taxonomyOptions"
          :twd-currencies="twdCurrencies"
          :myr-currencies="myrCurrencies"
          :purchase-currencies="purchaseCurrencies"
          :field-errors="fieldErrors"
          :submitting="phase === 'submitting' || phase === 'reconciling'"
          :disabled="formLocked || phase === 'conflict'"
          @patch="handleModelPatch"
          @submit="submitProduct"
          @cancel="returnToList"
          @retry-currency-catalog="currencyCatalog.reload"
          @retry-supplier-catalog="supplierCatalog.retry"
          @retry-taxonomy-catalog="loadTaxonomyOptions"
        />

        <ProductMediaPanel
          class="mt-6"
          :product="source"
          :editable="canUpdate"
          :content-readable="canReadProductMedia"
          :auth-epoch="appAccountStore.authEpoch"
          @product-change="handleMediaProductChange"
        />
      </template>
    </FaPageMain>

    <QsGenericModal
      :model-value="discardVisible"
      title="放弃未保存的产品修改？"
      description="当前修改或未知结果尚未完成核对，离开后需要重新读取最新资料。"
      size="sm"
      @update:model-value="$event ? (discardVisible = true) : closeDiscard()"
    >
      <FaAlert variant="destructive" icon="i-lucide:triangle-alert" title="请确认操作" description="只有点击“确认放弃”才会离开当前编辑页。" />
      <template #footer>
        <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="closeDiscard">
          继续编辑
        </FaButton>
        <FaButton variant="destructive" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="confirmDiscard">
          确认放弃
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
@media (width <= 639px) {
  .product-edit-page :deep(button) {
    min-height: 2.75rem;
  }
}
</style>
