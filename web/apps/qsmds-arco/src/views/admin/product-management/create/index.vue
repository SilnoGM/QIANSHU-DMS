<script setup lang="ts">
import type {
  ProductCreateApiFailure,
  ProductCreateFieldErrors,
  ProductCreateFormModel,
  ProductCreateSubmissionState,
  ProductCreateSubmittingState,
  ProductCreateUnknownState,
} from './product-create.logic'
import type { CreateProductRequestDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import productsApi from '@/api/modules/products'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import ProductForm from '../form/product-form.vue'
import {
  abandonUnknownProductCreate,
  beginProductCreateSubmission,
  buildCreateProductRequest,
  canApplyProductCreateResponse,
  createProductCreateFormModel,
  createProductCreateSubmissionState,
  getProductCreateApiFailure,
  hasProductCreateChanges,
  isProductCreateAbortError,
  replayUnknownProductCreate,
  resolveProductCreateFailure,
  resolveProductCreateSuccess,
} from './product-create.logic'

type ProductCreateCatalogState = 'empty' | 'error' | 'loading' | 'ready'
type DiscardConfirmationIntent = 'navigation' | 'unknown-abandon'

interface ProductCreateFormExpose {
  applyFieldErrors: (
    errors: ProductCreateFieldErrors,
    focusFirst?: boolean,
  ) => Promise<void>
  resetValidation: () => void
}

defineOptions({ name: 'AdminProductCreate' })

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const router = useRouter()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog(SUPPLIER_DICTIONARY_CODE)

const formRef = useTemplateRef<ProductCreateFormExpose>('formRef')
const successHeadingRef = useTemplateRef<HTMLElement>('successHeadingRef')
const formModel = ref<ProductCreateFormModel>(createProductCreateFormModel())
const submitState = shallowRef<ProductCreateSubmissionState>(
  createProductCreateSubmissionState(),
)
const fieldErrors = ref<ProductCreateFieldErrors>({})
const formError = ref('')
const formFailure = shallowRef<ProductCreateApiFailure | null>(null)
const discardModalVisible = ref(false)
const discardIntent = ref<DiscardConfirmationIntent | null>(null)
let requestVersion = 0
let submitAbortController: AbortController | null = null
let pendingNavigationResolver: ((allow: boolean) => void) | null = null

const canCreate = computed(() => auth('products:create'))
const canRead = computed(() => auth('products:read'))
const purchaseCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  currencyCatalog.selectableCurrencies.value)
const twdCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  purchaseCurrencies.value.filter(currency => currency.code === 'TWD'))
const myrCurrencies = computed<readonly CurrencyDescriptor[]>(() =>
  purchaseCurrencies.value.filter(currency => currency.code === 'MYR'))
const currencyCatalogState = computed<ProductCreateCatalogState>(() => {
  if (currencyCatalog.loading.value) {
    return 'loading'
  }
  if (currencyCatalog.errorMessage.value !== null) {
    return 'error'
  }
  return purchaseCurrencies.value.length === 0 ? 'empty' : 'ready'
})
const supplierCatalogState = computed<ProductCreateCatalogState>(() => {
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
const shouldConfirmDiscard = computed(() => (
  submitState.value.phase === 'unknown'
  || (
    submitState.value.phase !== 'success'
    && hasProductCreateChanges(formModel.value)
  )
))
const discardModalTitle = computed(() => discardIntent.value === 'unknown-abandon'
  ? '放弃本次未知结果？'
  : '放弃未保存的产品？')
const discardModalDescription = computed(() => discardIntent.value === 'unknown-abandon'
  ? '放弃后将清除当前幂等请求，无法再使用同一请求确认结果。'
  : '当前修改尚未保存，放弃后无法恢复。')

function clearFeedback(): void {
  fieldErrors.value = {}
  formError.value = ''
  formFailure.value = null
  formRef.value?.resetValidation()
}

function resetDraft(): void {
  requestVersion += 1
  submitAbortController?.abort()
  submitAbortController = null
  formModel.value = createProductCreateFormModel()
  submitState.value = createProductCreateSubmissionState()
  clearFeedback()
}

function handleModelPatch(patch: Partial<ProductCreateFormModel>): void {
  if (submitState.value.phase !== 'editing') {
    return
  }
  // 页面持有唯一权威模型；异步到达的字段补丁必须在此基于最新值累积。
  formModel.value = {
    ...formModel.value,
    ...patch,
  }
  if (formError.value !== '' || Object.keys(fieldErrors.value).length > 0) {
    clearFeedback()
  }
}

function collectCatalogErrors(): ProductCreateFieldErrors {
  const errors: Record<string, string> = {}
  if (currencyCatalogState.value !== 'ready') {
    const message = '请先完成货币资料加载'
    errors['twdSalePrice.currency'] = message
    errors['myrSalePrice.currency'] = message
    errors['purchaseCost.currency'] = message
  }
  else {
    if (twdCurrencies.value.length !== 1) {
      errors['twdSalePrice.currency'] = '当前缺少有效的 TWD 货币'
    }
    if (myrCurrencies.value.length !== 1) {
      errors['myrSalePrice.currency'] = '当前缺少有效的 MYR 货币'
    }
    if (!purchaseCurrencies.value.some(
      currency => currency.code === formModel.value.purchaseCostCurrency,
    )) {
      errors['purchaseCost.currency'] = '请选择当前有效的采购币种'
    }
  }

  const supplierRequired = formModel.value.status === 'ACTIVE'
    || formModel.value.supplierValue !== null
  if (supplierRequired) {
    if (supplierCatalogState.value !== 'ready') {
      errors.supplierValue = '请先完成供应商资料加载'
    }
    else {
      const resolution = supplierCatalog.resolve(formModel.value.supplierValue)
      if (resolution?.status !== 'ACTIVE') {
        errors.supplierValue = formModel.value.status === 'ACTIVE'
          ? '启用产品必须选择当前有效的供应商'
          : '已选供应商当前不可用'
      }
    }
  }
  return errors
}

function responseIsCurrent(
  submission: ProductCreateSubmittingState,
  controller: AbortController,
): boolean {
  return canApplyProductCreateResponse({
    aborted: controller.signal.aborted,
    authorized: canCreate.value,
    authEpoch: submission.authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: requestVersion,
    requestVersion: submission.requestVersion,
  })
}

async function handleSuccess(
  submission: ProductCreateSubmittingState,
  product: Awaited<ReturnType<typeof productsApi.create>>['data'],
): Promise<void> {
  submitState.value = resolveProductCreateSuccess(submission, product)
  formModel.value = createProductCreateFormModel()
  clearFeedback()
  toast.success(`产品 ${product.productNo} 创建成功`)
  if (canRead.value) {
    await router.push({ name: 'adminProductList' })
    return
  }
  await nextTick()
  successHeadingRef.value?.focus({ preventScroll: true })
}

async function executeSubmission(
  submission: ProductCreateSubmittingState,
): Promise<void> {
  submitAbortController?.abort()
  const controller = new AbortController()
  submitAbortController = controller

  try {
    const response = await productsApi.create(
      submission.snapshot as CreateProductRequestDto,
      submission.idempotencyKey,
      controller.signal,
    )
    if (!responseIsCurrent(submission, controller)) {
      return
    }
    await handleSuccess(submission, response.data)
  }
  catch (error) {
    if (
      isProductCreateAbortError(error)
      || !responseIsCurrent(submission, controller)
    ) {
      return
    }
    const failure = getProductCreateApiFailure(error)
    formFailure.value = failure
    const nextState = resolveProductCreateFailure(submission, failure)
    submitState.value = nextState
    if (nextState.phase === 'editing') {
      fieldErrors.value = failure.fieldErrors
      formError.value = failure.message
      await formRef.value?.applyFieldErrors(failure.fieldErrors, true)
    }
  }
  finally {
    if (submitAbortController === controller) {
      submitAbortController = null
    }
  }
}

async function submitProduct(): Promise<void> {
  if (!canCreate.value || submitState.value.phase !== 'editing') {
    return
  }

  const purchaseCurrency = purchaseCurrencies.value.find(
    currency => currency.code === formModel.value.purchaseCostCurrency,
  )
  const result = buildCreateProductRequest(formModel.value, {
    myrSalePricePrecision: myrCurrencies.value[0]?.minorUnit ?? 4,
    purchaseCostPrecision: purchaseCurrency?.minorUnit ?? 4,
    twdSalePricePrecision: twdCurrencies.value[0]?.minorUnit ?? 4,
  })
  const catalogErrors = collectCatalogErrors()
  const nextErrors = {
    ...(result.valid ? {} : result.fieldErrors),
    ...catalogErrors,
  }
  if (!result.valid || Object.keys(catalogErrors).length > 0) {
    fieldErrors.value = nextErrors
    formError.value = '部分资料未通过校验，请检查后重试'
    formFailure.value = null
    await formRef.value?.applyFieldErrors(nextErrors, true)
    return
  }

  clearFeedback()
  const submission = beginProductCreateSubmission(
    submitState.value,
    result.request,
    {
      authEpoch: appAccountStore.authEpoch,
      requestVersion: ++requestVersion,
    },
  )
  submitState.value = submission
  await executeSubmission(submission)
}

function replayUnknownResult(): void {
  if (submitState.value.phase !== 'unknown' || !canCreate.value) {
    return
  }
  const submission = replayUnknownProductCreate(submitState.value, {
    authEpoch: appAccountStore.authEpoch,
    requestVersion: ++requestVersion,
  })
  formError.value = ''
  formFailure.value = null
  submitState.value = submission
  void executeSubmission(submission)
}

function requestUnknownAbandon(): void {
  if (submitState.value.phase !== 'unknown') {
    return
  }
  discardIntent.value = 'unknown-abandon'
  discardModalVisible.value = true
}

function requestCancel(): void {
  if (canRead.value) {
    void router.push({ name: 'adminProductList' })
  }
  else {
    router.back()
  }
}

function requestListNavigation(): void {
  void router.push({ name: 'adminProductList' })
}

function closeDiscardConfirmation(): void {
  discardModalVisible.value = false
  discardIntent.value = null
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  resolve?.(false)
}

function confirmDiscard(): void {
  const intent = discardIntent.value
  const resolve = pendingNavigationResolver
  pendingNavigationResolver = null
  discardModalVisible.value = false
  discardIntent.value = null

  if (intent === 'unknown-abandon' && submitState.value.phase === 'unknown') {
    const unknownState = submitState.value as ProductCreateUnknownState
    submitState.value = abandonUnknownProductCreate(unknownState)
    formModel.value = createProductCreateFormModel()
    clearFeedback()
    toast.info('已放弃本次未知结果')
    return
  }

  resetDraft()
  resolve?.(true)
}

function handleDiscardModalUpdate(visible: boolean): void {
  if (visible) {
    discardModalVisible.value = true
    return
  }
  closeDiscardConfirmation()
}

function continueCreating(): void {
  resetDraft()
  void nextTick(() => formRef.value?.resetValidation())
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!shouldConfirmDiscard.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if (!shouldConfirmDiscard.value) {
    return true
  }
  if (pendingNavigationResolver !== null) {
    return false
  }
  discardIntent.value = 'navigation'
  discardModalVisible.value = true
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
  })
})

watch(
  [() => appAccountStore.authEpoch, canCreate],
  ([nextAuthEpoch, nextCanCreate], [previousAuthEpoch, previousCanCreate]) => {
    if (
      nextAuthEpoch === previousAuthEpoch
      && nextCanCreate === previousCanCreate
    ) {
      return
    }
    const resolve = pendingNavigationResolver
    pendingNavigationResolver = null
    discardModalVisible.value = false
    discardIntent.value = null
    resetDraft()
    resolve?.(false)
  },
)

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  requestVersion += 1
  submitAbortController?.abort()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  pendingNavigationResolver?.(false)
  pendingNavigationResolver = null
})
</script>

<template>
  <div class="product-create-page min-w-0" data-testid="product-create-page">
    <FaPageHeader
      title="新增产品"
      description="创建产品基础资料、价格与属性，产品编号由系统自动派发。"
    >
      <FaButton
        v-if="canRead"
        type="button"
        variant="outline"
        class="min-h-11 sm:min-h-9"
        :disabled="submitState.phase === 'submitting'"
        @click="requestListNavigation"
      >
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
        返回产品列表
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canCreate">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权新增产品"
        description="当前身份缺少 products:create 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <FaAlert
        v-if="formError"
        class="mb-5"
        icon="i-lucide:circle-alert"
        title="产品创建失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <div class="gap-2 grid">
            <span>{{ formError }}</span>
            <span v-if="formFailure?.hasUnmappedFieldErrors">
              有未能定位到表单控件的字段错误，请根据摘要检查。
            </span>
            <code v-if="formFailure?.requestId" class="text-xs font-mono break-all">
              requestId: {{ formFailure.requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <FaAlert
        v-if="submitState.phase === 'unknown'"
        class="mb-5"
        icon="i-lucide:circle-help"
        title="创建结果暂时无法确认"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <div class="gap-3 grid">
            <p class="m-0">
              {{ submitState.failure.message }}。表单已冻结，请使用相同请求人工确认，或明确放弃本次确认。
            </p>
            <code v-if="submitState.failure.requestId" class="text-xs font-mono break-all">
              requestId: {{ submitState.failure.requestId }}
            </code>
            <div class="flex flex-col gap-2 sm:flex-row">
              <FaButton
                type="button"
                class="min-h-11 sm:min-h-9"
                @click="replayUnknownResult"
              >
                使用相同请求重新确认
              </FaButton>
              <FaButton
                type="button"
                variant="outline"
                class="min-h-11 sm:min-h-9"
                @click="requestUnknownAbandon"
              >
                放弃本次确认
              </FaButton>
            </div>
          </div>
        </template>
      </FaAlert>

      <section
        v-if="submitState.phase === 'success' && !canRead"
        class="mx-auto p-6 text-center border border-border rounded-xl bg-card max-w-2xl sm:p-8"
        aria-labelledby="product-create-success-title"
      >
        <FaIcon name="i-lucide:circle-check-big" class="text-primary mx-auto size-10" aria-hidden="true" />
        <h2
          id="product-create-success-title"
          ref="successHeadingRef"
          class="text-xl font-semibold m-0 mt-4 outline-none"
          tabindex="-1"
        >
          产品创建成功
        </h2>
        <p class="text-sm text-muted-foreground m-0 mt-2">
          产品编号：
          <code class="text-foreground font-mono break-all">
            {{ submitState.product.productNo }}
          </code>
        </p>
        <FaButton type="button" class="mt-6 min-h-11 sm:min-h-9" @click="continueCreating">
          继续新增
        </FaButton>
      </section>

      <ProductForm
        v-else
        ref="formRef"
        :model-value="formModel"
        :currency-catalog-state="currencyCatalogState"
        :supplier-catalog-state="supplierCatalogState"
        :twd-currencies="twdCurrencies"
        :myr-currencies="myrCurrencies"
        :purchase-currencies="purchaseCurrencies"
        :field-errors="fieldErrors"
        :submitting="submitState.phase === 'submitting'"
        :disabled="submitState.phase === 'unknown'"
        :show-actions="submitState.phase !== 'unknown'"
        @patch="handleModelPatch"
        @submit="submitProduct"
        @cancel="requestCancel"
        @retry-currency-catalog="currencyCatalog.reload"
        @retry-supplier-catalog="supplierCatalog.retry"
      />
    </FaPageMain>

    <QsGenericModal
      :model-value="discardModalVisible"
      :title="discardModalTitle"
      :description="discardModalDescription"
      size="sm"
      @update:model-value="handleDiscardModalUpdate"
    >
      <FaAlert
        icon="i-lucide:triangle-alert"
        title="请确认操作"
        description="只有点击“确认放弃”才会清除当前内存中的草稿与幂等上下文。"
        variant="destructive"
      />
      <template #footer>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          @click="closeDiscardConfirmation"
        >
          继续编辑
        </FaButton>
        <FaButton
          type="button"
          variant="destructive"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          @click="confirmDiscard"
        >
          确认放弃
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
@media (width <= 639px) {
  /* 页面组合层统一抬高嵌套选择器的内部按钮，不改变共享组件桌面语义。 */
  .product-create-page :deep(button) {
    min-height: 2.75rem;
  }
}
</style>
