<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type {
  PurchaseOrderSubmissionState,
  PurchaseOrderSubmittingState,
} from './purchase-order-create.logic'
import type {
  PurchaseOrderSourceSalesOrderLineDto,
  PurchaseOrderSourceSalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type {
  OrderProductLineLabels,
  OrderProductLineModel,
} from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'

import { getLocalTimeZone, parseDate, today } from '@internationalized/date'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsOrderProductLineEditor from '@/components/business/QsOrderProductLineEditor/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'

import {
  adaptPurchaseOrderProductPage,
  beginPurchaseOrderSubmission,
  buildPurchaseOrderCreateRequest,
  calculatePurchaseOrderDraftTotal,
  createPurchaseOrderEditingState,
  getPurchaseOrderMutationFailure,
  parsePurchaseOrderCreateType,
  replayUnknownPurchaseOrderSubmission,
  resolvePurchaseOrderSubmissionFailure,
  resolvePurchaseOrderSubmissionSuccess,
  synchronizePurchaseOrderSourceLines,
} from './purchase-order-create.logic'
import {
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
} from './purchase-order-list.logic'
import PurchaseSourceSalesOrderSelector from './purchase-source-sales-order-selector.vue'

defineOptions({ name: 'OperationsPurchaseOrderCreate' })

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog('service_provider.supplier')
const todayDate = today(getLocalTimeZone())
const todayIso = todayDate.toString()
const canCreate = computed(() => auth('purchase-orders:create'))
const canCreateStock = computed(() => auth('purchase-orders:create-stock'))
const purchaseType = parsePurchaseOrderCreateType(route.query.type, canCreateStock.value)

const lineLabels: OrderProductLineLabels = {
  actualSubtotal: '本单采购小计',
  actualTotal: '本单采购总价',
  actualUnitPrice: '本单采购价',
  catalogProduct: '数据库产品',
  referenceTotal: '采购定价总计',
  referenceUnitPrice: '采购定价',
  temporaryProduct: '临时产品',
  temporaryProductNo: 'CUSTOM',
}

const formModel = reactive({
  balanceDueAmount: null as string | null,
  depositDueAmount: null as string | null,
  lines: [] as OrderProductLineModel[],
  orderDate: todayIso,
  remark: '',
  shippingMarkText: '',
  supplierValue: null as string | null,
})
const selectedSalesOrder = shallowRef<PurchaseOrderSourceSalesOrderListItemDto | null>(null)
const sourceSalesOrderLines = shallowRef<readonly PurchaseOrderSourceSalesOrderLineDto[]>([])
const sourceSalesOrderLineIdByKey = shallowRef<Readonly<Record<string, string | undefined>>>({})
const maximumQuantityByKey = shallowRef<Readonly<Record<string, number | undefined>>>({})
const sourceSelectorVisible = ref(false)
const sourceLoading = ref(false)
const synchronizing = ref(false)
const sourceError = ref('')
const fieldErrors = shallowRef<Readonly<Record<string, string>>>({})
const formError = ref('')
const requestId = ref<string>()
const submitConfirmVisible = ref(false)
const discardVisible = ref(false)
const createPageRef = useTemplateRef<HTMLElement>('createPageRef')
const supplierSelectRef = useTemplateRef<InstanceType<typeof QsDictionarySelect>>('supplierSelectRef')
const submission = shallowRef<PurchaseOrderSubmissionState>(createPurchaseOrderEditingState())
let sourceAbortController: AbortController | null = null
let synchronizeAbortController: AbortController | null = null
let submitAbortController: AbortController | null = null
let submitRequestVersion = 0
let pendingNavigationResolver: ((allow: boolean) => void) | null = null

const fixedCurrencies = computed(() => currencyCatalog.currencies.value.filter(item => (
  item.code === 'CNY'
)))
const currencyUnavailable = computed(() => (
  currencyCatalog.loading.value
  || currencyCatalog.errorMessage.value !== null
  || fixedCurrencies.value[0]?.enabled !== true
))
const orderDateValue = computed(() => parseDate(formModel.orderDate))
const purchaseTotalAmount = computed(() => calculatePurchaseOrderDraftTotal(formModel.lines))
const selectedSupplierDisplayLabel = computed(() => (
  supplierCatalog.resolve(formModel.supplierValue)?.displayLabel
  ?? formModel.supplierValue
  ?? '—'
))
const submitLocked = computed(() => submission.value.phase === 'submitting')
const sourceReady = computed(() => (
  purchaseType === 'SALES_LINKED'
  && selectedSalesOrder.value !== null
  && sourceSalesOrderLines.value.length > 0
  && formModel.supplierValue !== null
))
const shouldConfirmDiscard = computed(() => (
  submission.value.phase !== 'success'
  && (
    formModel.supplierValue !== null
    || formModel.lines.length > 0
    || formModel.depositDueAmount !== null
    || formModel.balanceDueAmount !== null
    || formModel.shippingMarkText !== ''
    || formModel.remark !== ''
    || selectedSalesOrder.value !== null
  )
))
const title = purchaseType === 'STOCK' ? '新增备货采购' : '新增销售关联采购'
const typeDescription = purchaseType === 'STOCK'
  ? '管理员独立创建备货采购，不关联销售订单。'
  : '先选择销售订单，再按供应商同步其剩余可采购产品。'
const formErrorDisplay = computed(() => requestId.value === undefined
  ? formError.value
  : `${formError.value}（请求编号：${requestId.value}）`)

const loadPurchaseProducts: ProductPageLoader = async (query, signal) => {
  const supplierValue = query.supplierValue ?? formModel.supplierValue
  if (supplierValue === null || supplierValue === undefined || supplierValue === '') {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 }
  }
  const response = await purchaseOrdersApi.productOptions({
    ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    page: query.page,
    pageSize: query.pageSize,
    supplierValue,
  }, signal)
  return adaptPurchaseOrderProductPage(response.data)
}

async function loadSourceSalesOrders(
  query: { keyword?: string, page: number, pageSize: number },
  signal: AbortSignal,
) {
  const response = await purchaseOrdersApi.sourceSalesOrders(query, signal)
  return response.data
}

function clearFeedback(): void {
  fieldErrors.value = {}
  formError.value = ''
  requestId.value = undefined
}

function updateOrderDate(value: DateValue | DateValue[] | undefined): void {
  if (value === undefined || Array.isArray(value) || submitLocked.value) {
    return
  }
  formModel.orderDate = value.toString()
  clearFeedback()
}

function handleSupplierUpdate(value: string | null): void {
  if (submitLocked.value || value === formModel.supplierValue) {
    return
  }
  formModel.supplierValue = value
  clearFeedback()
  if (purchaseType === 'SALES_LINKED' && formModel.lines.length > 0) {
    // 正式产品的采购成本和供应商绑定；切换供应商后必须重新求交集，不能沿用旧快照。
    formModel.lines = []
    sourceSalesOrderLineIdByKey.value = {}
    maximumQuantityByKey.value = {}
    toast.info('供应商已变更，请重新同步销售产品明细')
  }
}

function handleLinesUpdate(lines: readonly OrderProductLineModel[]): void {
  formModel.lines = lines.map(line => ({ ...line }))
  clearFeedback()
}

function handleDepositUpdate(value: string | null): void {
  formModel.depositDueAmount = value
  clearFeedback()
}

function handleBalanceUpdate(value: string | null): void {
  formModel.balanceDueAmount = value
  clearFeedback()
}

function handleShippingMarkUpdate(value: unknown): void {
  formModel.shippingMarkText = String(value ?? '')
  clearFeedback()
}

function handleRemarkUpdate(value: unknown): void {
  formModel.remark = String(value ?? '')
  clearFeedback()
}

async function selectSourceSalesOrder(
  item: PurchaseOrderSourceSalesOrderListItemDto,
): Promise<void> {
  sourceAbortController?.abort()
  const controller = new AbortController()
  sourceAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  selectedSalesOrder.value = item
  sourceSalesOrderLines.value = []
  formModel.lines = []
  sourceSalesOrderLineIdByKey.value = {}
  maximumQuantityByKey.value = {}
  sourceLoading.value = true
  sourceError.value = ''
  clearFeedback()
  try {
    const response = await purchaseOrdersApi.sourceSalesOrderLines(item.id, controller.signal)
    if (
      controller.signal.aborted
      || authEpoch !== appAccountStore.authEpoch
      || selectedSalesOrder.value?.id !== item.id
    ) {
      return
    }
    sourceSalesOrderLines.value = response.data.items
    if (response.data.items.length === 0) {
      sourceError.value = '该销售订单当前没有剩余可采购产品'
    }
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    sourceError.value = getPurchaseOrderApiFailure(error).message
  }
  finally {
    if (sourceAbortController === controller) {
      sourceAbortController = null
      sourceLoading.value = false
    }
  }
}

async function loadAllSupplierProducts(signal: AbortSignal) {
  const supplierValue = formModel.supplierValue
  if (supplierValue === null) {
    return []
  }
  const products = []
  let page = 1
  let total = 0
  do {
    const response = await purchaseOrdersApi.productOptions({
      page,
      pageSize: 100,
      supplierValue,
    }, signal)
    products.push(...response.data.items)
    total = response.data.total
    page += 1
  } while (products.length < total)
  return products
}

async function synchronizeSourceProducts(): Promise<void> {
  if (!sourceReady.value || synchronizing.value) {
    return
  }
  synchronizeAbortController?.abort()
  const controller = new AbortController()
  synchronizeAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  synchronizing.value = true
  sourceError.value = ''
  try {
    const productOptions = await loadAllSupplierProducts(controller.signal)
    if (controller.signal.aborted || authEpoch !== appAccountStore.authEpoch) {
      return
    }
    const result = synchronizePurchaseOrderSourceLines({
      productOptions,
      sourceLines: sourceSalesOrderLines.value,
    })
    formModel.lines = result.lines.map(line => ({ ...line }))
    sourceSalesOrderLineIdByKey.value = result.sourceSalesOrderLineIdByKey
    maximumQuantityByKey.value = result.maximumQuantityByKey
    clearFeedback()
    if (result.lines.length === 0) {
      sourceError.value = '当前供应商没有可同步的销售产品明细'
      return
    }
    const skipped = result.incompatibleCatalogCount + result.exhaustedCount
    toast.success(skipped === 0
      ? `已同步 ${result.lines.length} 条销售产品明细`
      : `已同步 ${result.lines.length} 条，跳过 ${skipped} 条不可采购明细`)
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    sourceError.value = getPurchaseOrderApiFailure(error).message
  }
  finally {
    if (synchronizeAbortController === controller) {
      synchronizeAbortController = null
      synchronizing.value = false
    }
  }
}

function buildCurrentRequest() {
  if (purchaseType === null) {
    return null
  }
  return buildPurchaseOrderCreateRequest({
    balanceDueAmount: formModel.balanceDueAmount,
    depositDueAmount: formModel.depositDueAmount,
    lines: formModel.lines,
    maximumQuantityByKey: maximumQuantityByKey.value,
    orderDate: formModel.orderDate,
    purchaseType,
    remark: formModel.remark,
    salesOrderId: selectedSalesOrder.value?.id ?? null,
    shippingMarkText: formModel.shippingMarkText,
    sourceSalesOrderLineIdByKey: sourceSalesOrderLineIdByKey.value,
    supplierValue: formModel.supplierValue ?? '',
    today: todayIso,
  })
}

/** 校验失败后聚焦第一个公开错误字段，避免键盘用户只能从页头重新寻找。 */
function focusFirstInvalidField(errors: Readonly<Record<string, string>>): void {
  const firstField = Object.keys(errors)[0]
  if (firstField === undefined) {
    return
  }
  void nextTick(() => {
    if (firstField === 'supplierValue') {
      supplierSelectRef.value?.focus()
      return
    }
    const root = createPageRef.value
    if (root === null) {
      return
    }
    const directLabels: Readonly<Record<string, string>> = {
      balanceDueAmount: '尾款',
      depositDueAmount: '定金',
      lines: '添加数据库产品',
      orderDate: '采购日期',
      salesOrderId: '选择销售订单',
    }
    let label = directLabels[firstField]
    const lineField = /^lines\.(\d+)\.(.+)$/u.exec(firstField)
    if (lineField !== null) {
      const lineNumber = Number(lineField[1]) + 1
      const lineLabelByField: Readonly<Record<string, string>> = {
        actualUnitPriceAmount: '本单采购价',
        name: '产品名称',
        quantity: '产品数量',
        standardUnitPriceAmount: '采购定价',
      }
      const suffix = lineLabelByField[lineField[2] ?? ''] ?? '本单采购价'
      label = `第 ${lineNumber} 行${suffix}`
    }
    const control = label === undefined
      ? null
      : root.querySelector<HTMLElement>(`[aria-label="${label}"]`)
        ?? [...root.querySelectorAll<HTMLElement>('button')].find(button => (
          button.textContent?.trim() === label
        ))
    control?.focus({ preventScroll: false })
  })
}

function requestSubmit(): void {
  if (!canCreate.value || submitLocked.value || currencyUnavailable.value) {
    return
  }
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '请修正采购订单中的必填项和金额后再提交'
    focusFirstInvalidField(fieldErrors.value)
    return
  }
  clearFeedback()
  submitConfirmVisible.value = true
}

async function executeSubmission(state: PurchaseOrderSubmittingState): Promise<void> {
  submitAbortController?.abort()
  const controller = new AbortController()
  submitAbortController = controller
  try {
    const response = await purchaseOrdersApi.create(
      state.snapshot,
      state.idempotencyKey,
      controller.signal,
    )
    if (
      controller.signal.aborted
      || state.requestVersion !== submitRequestVersion
      || state.authEpoch !== appAccountStore.authEpoch
    ) {
      return
    }
    submission.value = resolvePurchaseOrderSubmissionSuccess(state, response.data)
    submitConfirmVisible.value = false
    toast.success(`采购订单 ${response.data.orderNo} 创建成功`)
    void router.push({ name: 'qsOperationsPurchaseOrders' })
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    const failure = getPurchaseOrderMutationFailure(error)
    submission.value = resolvePurchaseOrderSubmissionFailure(state, failure)
    fieldErrors.value = failure.fieldErrors
    formError.value = failure.message
    requestId.value = failure.requestId
    if (!failure.unknownResult) {
      submitConfirmVisible.value = false
      focusFirstInvalidField(failure.fieldErrors)
    }
  }
  finally {
    if (submitAbortController === controller) {
      submitAbortController = null
    }
  }
}

function confirmSubmit(): void {
  if (submission.value.phase !== 'editing' || purchaseType === null) {
    return
  }
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '订单资料已变化，请返回检查后重新提交'
    submitConfirmVisible.value = false
    focusFirstInvalidField(fieldErrors.value)
    return
  }
  const state = beginPurchaseOrderSubmission(
    submission.value,
    result.request,
    { authEpoch: appAccountStore.authEpoch, requestVersion: ++submitRequestVersion },
  )
  submission.value = state
  void executeSubmission(state)
}

function retryUnknownSubmission(): void {
  if (submission.value.phase !== 'unknown') {
    return
  }
  try {
    const state = replayUnknownPurchaseOrderSubmission(submission.value, {
      authEpoch: appAccountStore.authEpoch,
      requestVersion: ++submitRequestVersion,
    })
    submission.value = state
    formError.value = ''
    requestId.value = undefined
    void executeSubmission(state)
  }
  catch {
    formError.value = '当前身份已变化，不能重放旧请求；请返回列表核对结果'
  }
}

function requestBack(): void {
  void router.push({ name: 'qsOperationsPurchaseOrders' })
}

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

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!shouldConfirmDiscard.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(() => {
  if (submission.value.phase === 'submitting') {
    toast.info('采购订单正在保存，请等待结果确认后再离开')
    return false
  }
  if (!shouldConfirmDiscard.value) {
    return true
  }
  if (pendingNavigationResolver !== null || discardVisible.value) {
    return false
  }
  return new Promise<boolean>((resolve) => {
    pendingNavigationResolver = resolve
    discardVisible.value = true
  })
})

watch(() => appAccountStore.authEpoch, () => {
  sourceAbortController?.abort()
  synchronizeAbortController?.abort()
  submitAbortController?.abort()
  void router.replace({ name: 'qsOperationsPurchaseOrders' })
})

onMounted(() => {
  if (!canCreate.value || purchaseType === null) {
    toast.error('当前入口无效或缺少创建该类型采购订单的权限')
    void router.replace({ name: 'qsOperationsPurchaseOrders' })
    return
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  sourceAbortController?.abort()
  synchronizeAbortController?.abort()
  submitAbortController?.abort()
  window.removeEventListener('beforeunload', handleBeforeUnload)
  pendingNavigationResolver?.(false)
  pendingNavigationResolver = null
})
</script>

<template>
  <div ref="createPageRef" class="purchase-order-create-page min-w-0" data-testid="purchase-order-create-page">
    <FaPageHeader :title="title" :description="typeDescription">
      <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="requestBack">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />返回全部采购
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="purchaseType === null || !canCreate">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无法创建该类型采购订单"
        description="请从全部采购页使用有权限的新增入口进入。"
        class="py-14"
      />
    </FaPageMain>

    <FaForm
      v-else
      :model="formModel"
      :disabled="submitLocked"
      :aria-busy="submission.phase === 'submitting' ? 'true' : 'false'"
      class="purchase-order-create-layout px-[var(--g-main-container-padding)] pb-[var(--g-main-container-padding)] gap-6 grid xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]"
    >
      <main class="gap-6 grid min-w-0">
        <FaAlert
          v-if="formError"
          title="采购订单尚不能提交"
          :description="formErrorDisplay"
          variant="destructive"
        />

        <FaCard
          title="采购基础信息"
          description="订单号由 PURCHASE_ORDER 规则在二次确认后幂等派发。"
          content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
        >
          <div class="p-4 border border-border rounded-lg bg-muted/25 md:col-span-2">
            <p class="text-sm font-medium m-0">
              采购订单号
            </p>
            <code class="text-sm text-muted-foreground font-mono mt-2 block">PURCHASE_ORDER · AUTO</code>
          </div>
          <FaFormItem name="orderDate" label="采购日期" required :auto-bind="false">
            <FaDate
              aria-label="采购日期"
              :model-value="orderDateValue"
              :max-value="todayDate"
              :disabled="submitLocked"
              picker
              prevent-deselect
              trigger-class="w-full min-h-11 sm:min-h-9"
              @update:model-value="updateOrderDate"
            />
            <p v-if="fieldErrors.orderDate" class="text-xs text-destructive m-0 mt-1" role="alert">
              {{ fieldErrors.orderDate }}
            </p>
          </FaFormItem>
          <FaFormItem name="supplierValue" label="供应商" required :auto-bind="false">
            <QsDictionarySelect
              ref="supplierSelectRef"
              :model-value="formModel.supplierValue"
              dictionary-code="service_provider.supplier"
              placeholder="选择采购供应商"
              :disabled="submitLocked"
              required
              @update:model-value="handleSupplierUpdate"
            />
            <p v-if="fieldErrors.supplierValue" class="text-xs text-destructive m-0 mt-1" role="alert">
              {{ fieldErrors.supplierValue }}
            </p>
          </FaFormItem>
        </FaCard>

        <FaCard
          v-if="purchaseType === 'SALES_LINKED'"
          title="销售订单关联"
          description="一个采购订单只关联一个销售订单；同一销售订单可拆分为多个采购订单。"
        >
          <div class="p-4 border border-border rounded-xl bg-muted/20 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0">
              <p class="font-medium m-0 break-all">
                {{ selectedSalesOrder?.orderNo ?? '尚未选择销售订单' }}
              </p>
              <p class="text-sm text-muted-foreground m-0 mt-1 truncate">
                {{ selectedSalesOrder ? `${selectedSalesOrder.customerName} · ${selectedSalesOrder.orderDate}` : '选择后获取客户名和剩余可采购产品' }}
              </p>
            </div>
            <div class="flex flex-col gap-2 sm:flex-row">
              <FaButton
                type="button"
                variant="outline"
                :disabled="submitLocked || sourceLoading"
                @click="sourceSelectorVisible = true"
              >
                <FaIcon name="i-lucide:search" aria-hidden="true" />选择销售订单
              </FaButton>
              <FaButton
                type="button"
                :loading="synchronizing"
                :disabled="submitLocked || !sourceReady"
                @click="synchronizeSourceProducts"
              >
                <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />同步销售产品明细
              </FaButton>
            </div>
          </div>
          <FaAlert
            v-if="sourceError"
            title="销售来源暂不可用"
            :description="sourceError"
            variant="destructive"
            class="mt-4"
          />
          <p v-if="fieldErrors.salesOrderId" class="text-sm text-destructive m-0 mt-3" role="alert">
            {{ fieldErrors.salesOrderId }}
          </p>
        </FaCard>

        <FaCard
          title="采购产品明细"
          :description="purchaseType === 'STOCK' ? '可手工添加数据库产品或临时产品。' : '产品只能从销售订单同步；可删除不在本次采购范围内的行。'"
          content-class="min-w-0"
        >
          <QsOrderProductLineEditor
            :model-value="formModel.lines"
            currency="CNY"
            :currencies="fixedCurrencies"
            :load-products="loadPurchaseProducts"
            :labels="lineLabels"
            :disabled="submitLocked || currencyUnavailable || formModel.supplierValue === null"
            :field-errors="fieldErrors"
            :fixed-product-supplier-value="formModel.supplierValue ?? undefined"
            :catalog-product-addable="purchaseType === 'STOCK'"
            :custom-product-addable="purchaseType === 'STOCK'"
            :catalog-line-initial-actual-unit-price-amount="null"
            custom-reference-unit-price-editable
            :temporary-line-initial-actual-unit-price-amount="null"
            product-selection-description="采购定价读取产品档案采购成本；本单采购价必须确认填写。"
            @update:model-value="handleLinesUpdate"
          />
        </FaCard>

        <FaCard title="唛头与备注" description="采购唛头首期按文本保存，后续可在同一字段接入自动生成。">
          <div class="gap-4 grid grid-cols-1">
            <FaFormItem name="shippingMarkText" label="采购唛头" :auto-bind="false">
              <FaTextarea
                :model-value="formModel.shippingMarkText"
                maxlength="2000"
                input-class="min-h-32"
                placeholder="输入采购唛头文本"
                :disabled="submitLocked"
                @update:model-value="handleShippingMarkUpdate"
              />
              <p v-if="fieldErrors.shippingMarkText" class="text-xs text-destructive m-0 mt-1" role="alert">
                {{ fieldErrors.shippingMarkText }}
              </p>
            </FaFormItem>
            <FaFormItem name="remark" label="采购备注" :auto-bind="false">
              <FaTextarea
                :model-value="formModel.remark"
                maxlength="1000"
                input-class="min-h-24"
                :disabled="submitLocked"
                @update:model-value="handleRemarkUpdate"
              />
            </FaFormItem>
          </div>
        </FaCard>
      </main>

      <aside class="min-w-0">
        <FaCard
          title="付款约定"
          description="采购总价由明细计算，并且必须等于定金与尾款之和。"
          class="xl:top-[calc(var(--g-header-actual-height,0px)+var(--g-topbar-actual-height,0px)+1rem)] xl:sticky"
        >
          <dl class="m-0 gap-4 grid">
            <div class="p-4 border border-border rounded-xl bg-primary/5 flex items-center justify-between">
              <dt class="text-sm text-muted-foreground">
                采购总价
              </dt>
              <dd class="font-bold m-0 overflow-x-auto">
                <AmountDisplay :value="purchaseTotalAmount" currency="CNY" :currencies="fixedCurrencies" />
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium mb-2">
                定金
              </dt>
              <dd class="m-0">
                <MoneyInput
                  :model-value="formModel.depositDueAmount"
                  aria-label="定金"
                  currency="CNY"
                  :currencies="fixedCurrencies"
                  :currency-selectable="false"
                  min="0"
                  :disabled="submitLocked"
                  @update:model-value="handleDepositUpdate"
                />
                <p v-if="fieldErrors.depositDueAmount" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ fieldErrors.depositDueAmount }}
                </p>
              </dd>
            </div>
            <div>
              <dt class="text-sm font-medium mb-2">
                尾款
              </dt>
              <dd class="m-0">
                <MoneyInput
                  :model-value="formModel.balanceDueAmount"
                  aria-label="尾款"
                  currency="CNY"
                  :currencies="fixedCurrencies"
                  :currency-selectable="false"
                  min="0"
                  :disabled="submitLocked"
                  @update:model-value="handleBalanceUpdate"
                />
                <p v-if="fieldErrors.balanceDueAmount" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ fieldErrors.balanceDueAmount }}
                </p>
              </dd>
            </div>
          </dl>
          <FaAlert
            v-if="submission.phase === 'unknown'"
            title="提交结果未知"
            description="网络中断时订单可能已经创建。只能使用相同请求重新确认，避免重复编号。"
            class="mt-5"
          >
            <template #actions>
              <FaButton type="button" variant="outline" size="sm" @click="retryUnknownSubmission">
                使用相同请求重新确认
              </FaButton>
            </template>
          </FaAlert>
          <FaButton
            type="button"
            class="mt-6 min-h-11 w-full"
            :loading="submitLocked"
            :disabled="submitLocked || currencyUnavailable"
            @click="requestSubmit"
          >
            核对并确认采购订单
          </FaButton>
        </FaCard>
      </aside>
    </FaForm>

    <PurchaseSourceSalesOrderSelector
      v-if="purchaseType === 'SALES_LINKED'"
      v-model="sourceSelectorVisible"
      :disabled="submitLocked"
      :load-sales-orders="loadSourceSalesOrders"
      @confirm="selectSourceSalesOrder"
    />

    <QsGenericModal
      :model-value="submitConfirmVisible"
      title="确认提交采购订单？"
      description="确认后正式保存，并由 PURCHASE_ORDER 规则幂等派发采购订单号。"
      size="sm"
      :closable="false"
      :dismiss-on-overlay="false"
      :submitting="submitLocked"
      @update:model-value="submitConfirmVisible = $event"
    >
      <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-[5rem_minmax(0,1fr)]">
        <dt class="text-sm text-muted-foreground">
          采购类型
        </dt>
        <dd class="text-sm font-medium m-0">
          {{ purchaseType === 'STOCK' ? '备货采购' : '销售关联采购' }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          供应商
        </dt>
        <dd class="text-sm font-mono m-0 break-all">
          {{ selectedSupplierDisplayLabel }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          产品数
        </dt>
        <dd class="text-sm font-medium m-0">
          {{ formModel.lines.length }} 项
        </dd>
        <dt class="text-sm text-muted-foreground">
          采购总价
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay :value="purchaseTotalAmount" currency="CNY" :currencies="fixedCurrencies" />
        </dd>
      </dl>
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="submitLocked" @click="submitConfirmVisible = false">
          返回检查
        </FaButton>
        <FaButton type="button" :loading="submitLocked" @click="confirmSubmit">
          确认提交订单
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      :model-value="discardVisible"
      title="放弃当前采购订单？"
      description="未提交的采购信息将不会保留。"
      size="sm"
      @update:model-value="$event ? (discardVisible = true) : closeDiscard()"
    >
      <p class="text-sm text-muted-foreground m-0">
        确认离开后，本页已填写资料不可恢复。
      </p>
      <template #footer>
        <FaButton type="button" variant="outline" @click="closeDiscard">
          继续编辑
        </FaButton>
        <FaButton type="button" variant="destructive" @click="confirmDiscard">
          确认放弃
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
.purchase-order-create-layout {
  align-items: start;
}
</style>
