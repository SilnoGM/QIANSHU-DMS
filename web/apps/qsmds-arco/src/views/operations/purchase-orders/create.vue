<script setup lang="ts">
import type { StepsItem } from '@fantastic-admin/components'
import type { DateValue } from '@internationalized/date'
import type {
  PurchaseOrderCreateStep,
  PurchaseOrderFormStep,
  PurchaseOrderSubmissionState,
  PurchaseOrderSubmittingState,
} from './purchase-order-create.logic'
import type { PurchaseOrderShippingMarkState } from './purchase-order-shipping-mark.logic'
import type { PurchaseSourceSalesOrderSelection } from './purchase-source-sales-order-selector.types'
import type {
  PurchaseOrderShippingMarkResolutionDto,
  PurchaseOrderSourceSalesOrderLineDto,
  PurchaseOrderSourceSalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { PaymentRecipientAccountInputDto } from '@/api/modules/payment-recipients'
import type { PurchaseOrderSourceSalesOrdersQuery } from '@/api/modules/purchase-orders'
import type {
  OrderProductLineLabels,
  OrderProductLineModel,
  OrderProductLineReadOnlyModel,
} from '@/components/business/QsOrderProductLineEditor/types'
import type { PartConfiguration } from '@/components/business/QsPartConfigurator/types'

import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'
import { Popover as APopover } from '@arco-design/web-vue'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import { onKeyStroke, useMediaQuery } from '@vueuse/core'

import { useId } from 'vue'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsOrderProductLineEditor from '@/components/business/QsOrderProductLineEditor/index.vue'
import QsPartConfigurator from '@/components/business/QsPartConfigurator/index.vue'
import QsPaymentRecipientEditor from '@/components/business/QsPaymentRecipientEditor/index.vue'
import QsPurchaseOrderDesc from '@/components/business/QsPurchaseOrderDesc/index.vue'
import { clearPurchaseRecipientDraft, loadPurchaseRecipientDraft } from '@/components/business/QsPurchaseStartModal/recipient-draft'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { formatNumberingRuleStructure, numberingResetPolicyLabel } from '../../system/basic-data/numbering/numbering-list.logic'
import {
  adaptPurchaseOrderProductPage,
  beginPurchaseOrderSubmission,
  buildPurchaseOrderCreateRequest,
  calculatePurchaseOrderDraftTotal,
  createPurchaseOrderEditingState,
  getPurchaseOrderMutationFailure,
  hasPurchasablePurchaseOrderSourceLines,
  parsePurchaseOrderCreateContext,
  PURCHASE_ORDER_CREATE_REVIEW_STEP,
  replayUnknownPurchaseOrderSubmission,
  resolvePurchaseOrderCreateStepForErrors,
  resolvePurchaseOrderCreateStepForField,
  resolvePurchaseOrderSubmissionFailure,
  resolvePurchaseOrderSubmissionSuccess,
  synchronizePurchaseOrderSourceLines,
  validatePurchaseOrderCreateStep,
} from './purchase-order-create.logic'

import {
  mapPurchaseOrderCreateToDesc,
  resolvePurchaseOrderIssuerLabel,
} from './purchase-order-desc.logic'
import {
  getPurchaseOrderApiFailure,
  isPurchaseOrderAbortError,
} from './purchase-order-list.logic'
import PurchaseOrderPartsReview from './purchase-order-parts-review.vue'
import { freezePurchaseOrderPartReview, mapPurchaseOrderPartProducts, reconcilePurchaseOrderParts } from './purchase-order-parts.logic'
import PurchaseOrderPaymentRecipients from './purchase-order-payment-recipients.vue'
import PurchaseOrderPaymentTerms from './purchase-order-payment-terms.vue'
import PurchaseOrderShippingMarkSummary from './purchase-order-shipping-mark-summary.vue'
import {
  createPurchaseOrderShippingMarkResolver,
  formatPurchaseOrderShippingMarkSummary,
  isPurchaseOrderShippingMarkAvailable,
  PURCHASE_SHIPPING_MARK_DISPATCH_HINT,
} from './purchase-order-shipping-mark.logic'
import PurchaseSourceSalesOrderSelector from './purchase-source-sales-order-selector.vue'

defineOptions({ name: 'OperationsPurchaseOrderCreate' })

type PurchaseOrderCreateSurface = 'form' | 'review'

// “下一步”失败属于用户可立即修正的本地反馈，统一使用短时 Toast，
// 不写入页面级 formError，避免轻量步骤校验挤压整个双栏表单布局。
const STEP_VALIDATION_MESSAGE = '请先完成并修正当前步骤的必填资料'

const purchaseOrderSteps: StepsItem[] = [
  { id: 'base', title: '采购基础信息' },
  { id: 'products-payment', title: '采购产品与付款' },
  { id: 'parts', title: '预定义货物件' },
  { id: 'review', title: '订单详情核对' },
]

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog('service_provider.supplier')
const todayDate = today(getLocalTimeZone())
const todayIso = todayDate.toString()
const canCreate = computed(() => auth('purchase-orders:create'))
const canCreateStock = computed(() => auth('purchase-orders:create-stock'))
const createContext = parsePurchaseOrderCreateContext({
  canCreateStock: canCreateStock.value,
  customSupplierName: route.query.customSupplierName,
  productMode: route.query.productMode,
  purchaseType: route.query.type,
  salesOrderId: route.query.salesOrderId,
  salesOrderNo: route.query.salesOrderNo,
  supplierValue: route.query.supplierValue,
})
const purchaseType = createContext?.purchaseType ?? null
const productMode = createContext?.productMode ?? null
const sourceShortcut = createContext?.sourceShortcut ?? null

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
  supplierValue: createContext?.supplierValue ?? null,
  customSupplierName: createContext?.customSupplierName ?? null,
})
const paymentAccounts = ref<PaymentRecipientAccountInputDto[]>(productMode === 'CUSTOM'
  ? loadPurchaseRecipientDraft(route.query.paymentDraftKey, `${appAccountStore.userId}:${appAccountStore.authContext?.session.createdAt ?? ''}`) ?? []
  : [])
const initialPaymentAccounts = JSON.stringify(paymentAccounts.value)
const recipientUploading = ref(false)
const customSupplierDraft = ref(createContext?.customSupplierName ?? '')
const partConfigurations = shallowRef<readonly PartConfiguration[]>([])
const frozenPartReview = shallowRef<ReturnType<typeof freezePurchaseOrderPartReview> | null>(null)
const pendingSupplierChange = shallowRef<{
  readonly customSupplierName: string | null
  readonly supplierValue: string | null
} | null>(null)
const selectedSalesOrder = shallowRef<PurchaseOrderSourceSalesOrderListItemDto | null>(null)
const sourceSalesOrderLines = shallowRef<readonly PurchaseOrderSourceSalesOrderLineDto[]>([])
const purchasedSourceLines = shallowRef<readonly OrderProductLineReadOnlyModel[]>([])
const sourceSalesOrderLineIdByKey = shallowRef<Readonly<Record<string, string | undefined>>>({})
const maximumQuantityByKey = shallowRef<Readonly<Record<string, number | undefined>>>({})
const sourceSelectorVisible = ref(false)
const sourceLoading = ref(false)
const synchronizing = ref(false)
const sourceError = ref('')
const fieldErrors = shallowRef<Readonly<Record<string, string>>>({})
const formError = ref('')
const requestId = ref<string>()
const createSurface = ref<PurchaseOrderCreateSurface>('form')
const activeStep = ref<PurchaseOrderCreateStep>(0)
const furthestReachedStep = ref<PurchaseOrderCreateStep>(0)
const detailsDrawerVisible = ref(false)
const submitConfirmVisible = ref(false)
const discardVisible = ref(false)
const supplierChangeConfirmVisible = ref(false)
const createPageRef = useTemplateRef<HTMLElement>('createPageRef')
const stepNavigationRef = useTemplateRef<HTMLElement>('stepNavigationRef')
const reviewHeadingRef = useTemplateRef<HTMLElement>('reviewHeadingRef')
const supplierSelectRef = useTemplateRef<InstanceType<typeof QsDictionarySelect>>('supplierSelectRef')
const isDesktopSummary = useMediaQuery('(min-width: 1280px)')
const submission = shallowRef<PurchaseOrderSubmissionState>(createPurchaseOrderEditingState())
const partProducts = computed(() => submission.value.phase === 'editing'
  ? mapPurchaseOrderPartProducts(formModel.lines)
  : frozenPartReview.value?.products ?? [])
const displayedParts = computed(() => submission.value.phase === 'editing'
  ? partConfigurations.value
  : frozenPartReview.value?.parts ?? [])
const shippingMarkState = shallowRef<PurchaseOrderShippingMarkState>({ error: '', loading: false, resolution: null })
const shippingMarkDetailsOpen = ref(false)
const shippingMarkDetailsId = useId()
const frozenShippingMarkResolution = shallowRef<PurchaseOrderShippingMarkResolutionDto | null>(null)
const shippingMarkResolver = createPurchaseOrderShippingMarkResolver({
  canRefresh: () => submission.value.phase === 'editing' && canCreate.value,
  getAuthEpoch: () => appAccountStore.authEpoch,
  load: async (query, signal) => (await purchaseOrdersApi.shippingMarkResolution(query, signal)).data,
  onChange: (state) => { shippingMarkState.value = state },
})
let sourceAbortController: AbortController | null = null
let shortcutAbortController: AbortController | null = null
let synchronizeAbortController: AbortController | null = null
let submitAbortController: AbortController | null = null
let shortcutLookupStarted = false
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
  productMode === 'CUSTOM'
    ? formModel.customSupplierName ?? '—'
    : (supplierCatalog.resolve(formModel.supplierValue)?.displayLabel
      ?? formModel.supplierValue
      ?? '—')
))
const shippingMarkResolution = computed(() => (
  submission.value.phase === 'editing'
    ? shippingMarkState.value.resolution
    : frozenShippingMarkResolution.value
))
const shippingMarkSummary = computed(() => formatPurchaseOrderShippingMarkSummary(shippingMarkResolution.value, t))
const shippingMarkAvailable = computed(() => (
  !shippingMarkState.value.loading && isPurchaseOrderShippingMarkAvailable(shippingMarkResolution.value)
))
const purchaseOrderDescModel = computed(() => mapPurchaseOrderCreateToDesc({
  balanceDueAmount: formModel.balanceDueAmount,
  depositDueAmount: formModel.depositDueAmount,
  issuerName: resolvePurchaseOrderIssuerLabel(
    appAccountStore.displayName,
    appAccountStore.account,
  ),
  lines: formModel.lines,
  orderDate: formModel.orderDate,
  purchaseTotalAmount: purchaseTotalAmount.value,
  purchaseType: purchaseType ?? 'SALES_LINKED',
  remark: formModel.remark,
  salesOrder: selectedSalesOrder.value,
  shippingMarkText: shippingMarkSummary.value,
  supplierLabel: selectedSupplierDisplayLabel.value,
}))
const submitLocked = computed(() => submission.value.phase === 'submitting')
const editingLocked = computed(() => submission.value.phase !== 'editing')
// 两类采购都复用分步填写与核对流程；销售来源能力仍单独受类型约束，
// 避免为了统一页面体验而把销售订单选择或同步入口泄漏给备货采购。
const steppedCreate = computed(() => purchaseType !== null)
const salesLinkedCreate = computed(() => purchaseType === 'SALES_LINKED')
const sourceHasPurchasableLines = computed(() => hasPurchasablePurchaseOrderSourceLines(sourceSalesOrderLines.value))
const supplierReady = computed(() => productMode === 'CATALOG'
  ? formModel.supplierValue !== null
  : formModel.customSupplierName?.trim() !== '')
const sourceReady = computed(() => (
  salesLinkedCreate.value
  && selectedSalesOrder.value !== null
  && sourceHasPurchasableLines.value
  && supplierReady.value
))
const shouldConfirmDiscard = computed(() => (
  submission.value.phase !== 'success'
  && (
    formModel.supplierValue !== (createContext?.supplierValue ?? null)
    || formModel.customSupplierName !== (createContext?.customSupplierName ?? null)
    || customSupplierDraft.value !== (createContext?.customSupplierName ?? '')
    || JSON.stringify(paymentAccounts.value) !== initialPaymentAccounts
    || recipientUploading.value
    || formModel.lines.length > 0
    || formModel.depositDueAmount !== null
    || formModel.balanceDueAmount !== null
    || formModel.remark !== ''
    || selectedSalesOrder.value !== null
  )
))
const title = purchaseType === 'STOCK' ? '新增备货采购' : '新增采购订单'
const typeDescription = purchaseType === 'STOCK'
  ? '管理员分步骤创建独立备货采购，不关联销售订单，并在订单详情全屏核对后正式提交。'
  : '分步骤完成采购资料，并在订单详情全屏核对后正式提交。'
const formErrorDisplay = computed(() => requestId.value === undefined
  ? formError.value
  : `${formError.value}（请求编号：${requestId.value}）`)
const activeStepTitle = computed(() => purchaseOrderSteps[activeStep.value]?.title ?? '')
const submitStatusMessage = computed(() => {
  if (submission.value.phase === 'submitting') {
    return t('purchaseOrderParts.saving')
  }
  if (submission.value.phase === 'unknown') {
    return '保存结果暂时未知，请使用原请求重新确认，避免产生重复采购订单。'
  }
  if (currencyUnavailable.value) {
    return 'CNY 当前不可用，暂时无法提交采购订单。'
  }
  return t('purchaseOrderParts.ready')
})
const submitReady = computed(() => (
  createSurface.value === 'review'
  && submission.value.phase === 'editing'
  && !currencyUnavailable.value
  && !recipientUploading.value
  && shippingMarkAvailable.value
  && furthestReachedStep.value === PURCHASE_ORDER_CREATE_REVIEW_STEP
))

const loadPurchaseProducts: ProductPageLoader = async (query, signal) => {
  if (productMode !== 'CATALOG') {
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0 }
  }
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
  query: PurchaseOrderSourceSalesOrdersQuery,
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

function refreshShippingMarkResolution(): void {
  if (editingLocked.value || productMode === null) {
    return
  }
  if (productMode === 'CATALOG' && !formModel.supplierValue) {
    shippingMarkResolver.reset()
    return
  }
  void shippingMarkResolver.refresh(productMode === 'CUSTOM'
    ? { productMode: 'CUSTOM' }
    : { productMode: 'CATALOG', supplierValue: formModel.supplierValue! })
}

function updateOrderDate(value: DateValue | DateValue[] | undefined): void {
  if (value === undefined || Array.isArray(value) || editingLocked.value) {
    return
  }
  formModel.orderDate = value.toString()
  clearFeedback()
}

function handleSupplierUpdate(value: string | null): void {
  if (editingLocked.value || value === formModel.supplierValue) {
    return
  }
  requestSupplierChange({ customSupplierName: null, supplierValue: value })
}

function handleCustomSupplierUpdate(value: unknown): void {
  const nextValue = String(value ?? '')
  if (editingLocked.value) {
    return
  }
  customSupplierDraft.value = nextValue
  clearFeedback()
  if (!hasSupplierDependentData()) {
    formModel.customSupplierName = nextValue
  }
}

function hasSupplierDependentData(): boolean {
  return selectedSalesOrder.value !== null
    || sourceSalesOrderLines.value.length > 0
    || formModel.lines.length > 0
    || purchasedSourceLines.value.length > 0
    || formModel.depositDueAmount !== null
    || formModel.balanceDueAmount !== null
}

function requestCustomSupplierChange(): void {
  const nextValue = customSupplierDraft.value
  if (editingLocked.value || nextValue === formModel.customSupplierName) {
    return
  }
  requestSupplierChange({ customSupplierName: nextValue, supplierValue: null })
}

function requestSupplierChange(nextSupplier: {
  readonly customSupplierName: string | null
  readonly supplierValue: string | null
}): void {
  if (!hasSupplierDependentData()) {
    applySupplierChange(nextSupplier, false)
    return
  }
  pendingSupplierChange.value = nextSupplier
  supplierChangeConfirmVisible.value = true
}

function applySupplierChange(
  nextSupplier: { readonly customSupplierName: string | null, readonly supplierValue: string | null },
  notify: boolean,
): void {
  formModel.supplierValue = nextSupplier.supplierValue
  formModel.customSupplierName = nextSupplier.customSupplierName
  customSupplierDraft.value = nextSupplier.customSupplierName ?? ''
  clearFeedback()
  // 销售来源资格、产品价格与付款约定都依赖供应商；确认变更后必须一次性失效，
  // 防止新供应商与旧订单、旧产品或旧金额组合成不可提交的半更新草稿。
  sourceAbortController?.abort()
  sourceSelectorVisible.value = false
  selectedSalesOrder.value = null
  sourceSalesOrderLines.value = []
  formModel.lines = []
  purchasedSourceLines.value = []
  sourceSalesOrderLineIdByKey.value = {}
  maximumQuantityByKey.value = {}
  formModel.depositDueAmount = null
  formModel.balanceDueAmount = null
  sourceError.value = ''
  if (notify) {
    toast.info(purchaseType === 'SALES_LINKED'
      ? '供应商已变更，请重新选择销售订单并同步产品明细'
      : '供应商已变更，请重新添加采购产品并填写付款约定')
  }
}

function cancelSupplierChange(): void {
  pendingSupplierChange.value = null
  supplierChangeConfirmVisible.value = false
  customSupplierDraft.value = formModel.customSupplierName ?? ''
}

function confirmSupplierChange(): void {
  const nextSupplier = pendingSupplierChange.value
  if (nextSupplier === null) {
    return
  }
  pendingSupplierChange.value = null
  supplierChangeConfirmVisible.value = false
  applySupplierChange(nextSupplier, true)
}

function handleLinesUpdate(lines: readonly OrderProductLineModel[]): void {
  formModel.lines = lines.map(line => ({ ...line }))
  clearFeedback()
}

function handlePartsUpdate(parts: readonly PartConfiguration[]): void {
  if (editingLocked.value) {
    return
  }
  partConfigurations.value = parts
  clearFeedback()
}

function handlePartWarning(message: string): void {
  toast.warning(message)
}

function handleDepositUpdate(value: string | null): void {
  formModel.depositDueAmount = value
  clearFeedback()
}

function handleBalanceUpdate(value: string | null): void {
  formModel.balanceDueAmount = value
  clearFeedback()
}

function handleRemarkUpdate(value: unknown): void {
  formModel.remark = String(value ?? '')
  clearFeedback()
}

async function selectSourceSalesOrder(
  item: PurchaseOrderSourceSalesOrderListItemDto,
): Promise<void> {
  const previousSalesOrderId = selectedSalesOrder.value?.id ?? null
  const sourceChanged = previousSalesOrderId !== null
    && previousSalesOrderId !== item.id
  sourceAbortController?.abort()
  const controller = new AbortController()
  sourceAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  selectedSalesOrder.value = item
  sourceSalesOrderLines.value = []
  if (sourceChanged) {
    // 产品、付款约定和销售明细映射都依赖原销售订单，换单后必须一起失效；
    // 重选同一订单则保留用户已填写内容，只刷新该订单的剩余可采购明细。
    formModel.lines = []
    purchasedSourceLines.value = []
    formModel.depositDueAmount = null
    formModel.balanceDueAmount = null
    sourceSalesOrderLineIdByKey.value = {}
    maximumQuantityByKey.value = {}
    toast.info('销售订单已更换，请重新同步产品明细并填写付款约定')
  }
  sourceLoading.value = true
  sourceError.value = ''
  clearFeedback()
  try {
    const response = await purchaseOrdersApi.sourceSalesOrderLines(item.id, {
      productMode: productMode!,
      ...(productMode === 'CATALOG'
        ? { supplierValue: formModel.supplierValue! }
        : {}),
    }, controller.signal)
    if (
      controller.signal.aborted
      || authEpoch !== appAccountStore.authEpoch
      || selectedSalesOrder.value?.id !== item.id
    ) {
      return
    }
    sourceSalesOrderLines.value = response.data.items
    if (!hasPurchasablePurchaseOrderSourceLines(response.data.items)) {
      sourceError.value = '该销售订单已无剩余可采购产品'
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

async function handleSourceSalesOrderConfirm(
  selection: PurchaseSourceSalesOrderSelection,
): Promise<void> {
  await selectSourceSalesOrder(selection.item)
}

/**
 * URL 只提供定位线索。自动绑定仍从采购权限域重新读取候选订单，并同时核对
 * ID 与订单号；请求返回前若用户已经手工选单，则以用户选择为准。
 */
async function bindSourceSalesOrderFromShortcut(): Promise<void> {
  if (
    shortcutLookupStarted
    || sourceShortcut === null
    || selectedSalesOrder.value !== null
  ) {
    return
  }
  shortcutLookupStarted = true
  const controller = new AbortController()
  shortcutAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  try {
    const shortcutViews = ['UNPURCHASED', 'PARTIALLY_PURCHASED'] as const
    let candidate: PurchaseOrderSourceSalesOrderListItemDto | undefined
    for (const view of shortcutViews) {
      const response = await purchaseOrdersApi.sourceSalesOrders({
        keyword: sourceShortcut.salesOrderNo,
        page: 1,
        pageSize: 100,
        productMode: productMode!,
        ...(productMode === 'CATALOG'
          ? { supplierValue: formModel.supplierValue! }
          : {}),
        view,
      }, controller.signal)
      if (controller.signal.aborted || authEpoch !== appAccountStore.authEpoch) {
        return
      }
      candidate = response.data.items.find(item => (
        item.id === sourceShortcut.salesOrderId
        && item.orderNo === sourceShortcut.salesOrderNo
      ))
      if (candidate !== undefined) {
        break
      }
    }
    if (selectedSalesOrder.value !== null) {
      return
    }
    if (candidate === undefined) {
      toast.warning('销售订单自动关联失败，请手工选择销售订单')
      return
    }
    await selectSourceSalesOrder(candidate)
  }
  catch (error) {
    if (controller.signal.aborted || isPurchaseOrderAbortError(error)) {
      return
    }
    toast.warning('销售订单自动关联失败，请手工选择销售订单')
  }
  finally {
    if (shortcutAbortController === controller) {
      shortcutAbortController = null
    }
  }
}

async function loadAllSupplierProducts(signal: AbortSignal) {
  if (productMode !== 'CATALOG') {
    return []
  }
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
    purchasedSourceLines.value = result.readOnlyLines.map(line => ({ ...line }))
    sourceSalesOrderLineIdByKey.value = result.sourceSalesOrderLineIdByKey
    maximumQuantityByKey.value = result.maximumQuantityByKey
    clearFeedback()
    if (result.lines.length === 0) {
      sourceError.value = '当前供应商没有可同步的销售产品明细'
      return
    }
    const historyMessage = result.readOnlyLines.length === 0
      ? ''
      : `，并展示 ${result.readOnlyLines.length} 条已采购明细`
    const incompatibleMessage = result.incompatibleCatalogCount === 0
      ? ''
      : `，另有 ${result.incompatibleCatalogCount} 条正式产品不属于当前供应商`
    toast.success(`已同步 ${result.lines.length} 条待采购明细${historyMessage}${incompatibleMessage}`)
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

function buildCurrentSource() {
  if (purchaseType === null) {
    return null
  }
  return {
    balanceDueAmount: formModel.balanceDueAmount,
    depositDueAmount: formModel.depositDueAmount,
    lines: formModel.lines,
    parts: partConfigurations.value,
    maximumQuantityByKey: maximumQuantityByKey.value,
    orderDate: formModel.orderDate,
    productMode: productMode!,
    purchaseType,
    remark: formModel.remark,
    salesOrderId: selectedSalesOrder.value?.id ?? null,
    expectedShippingMarkResolution: shippingMarkAvailable.value
      ? shippingMarkResolution.value?.resolutionToken ?? null
      : null,
    sourceSalesOrderLineIdByKey: sourceSalesOrderLineIdByKey.value,
    supplierValue: formModel.supplierValue,
    customSupplierName: formModel.customSupplierName,
    paymentAccounts: paymentAccounts.value,
    today: todayIso,
  } as const
}

function buildCurrentRequest() {
  if (recipientUploading.value) {
    return { valid: false as const, fieldErrors: { paymentAccounts: t('purchasePayment.uploading') }, purchaseTotalAmount: purchaseTotalAmount.value }
  }
  const source = buildCurrentSource()
  return source === null ? null : buildPurchaseOrderCreateRequest(source)
}

function goToFormStep(step: number): void {
  activeStep.value = Math.min(Math.max(step, 0), 2) as PurchaseOrderFormStep
  // 移除手动刷新入口后，返回此步骤可恢复失败的只读匹配，不触碰提交幂等状态。
  if (activeStep.value === 2 && shippingMarkState.value.error && !shippingMarkState.value.loading) {
    refreshShippingMarkResolution()
  }
  // 每个步骤高度不同，回到进度区可以避免沿用上一页底部的滚动位置。
  void nextTick(() => {
    stepNavigationRef.value?.scrollIntoView({ block: 'start' })
    stepNavigationRef.value?.focus({ preventScroll: true })
  })
}

function previousStep(): void {
  if (!steppedCreate.value || createSurface.value !== 'form') {
    return
  }
  goToFormStep(activeStep.value - 1)
}

async function focusPurchaseOrderReview(): Promise<void> {
  await nextTick()
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
  reviewHeadingRef.value?.scrollIntoView({ behavior: 'auto', block: 'start' })
  reviewHeadingRef.value?.focus({ preventScroll: true })
}

/**
 * 第三步的“下一步”只切换到只读核对面。这里执行完整领域校验，但不会创建
 * 幂等键、冻结请求快照或访问创建 API；采购订单号在最终确认后派发，唛头留待审核。
 */
function enterPurchaseOrderReview(): void {
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    toast.warning('部分采购资料未通过校验，请修正后再进入订单详情核对')
    const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
    if (errorStep !== null) {
      goToFormStep(errorStep)
      focusFirstInvalidField(fieldErrors.value)
    }
    return
  }
  clearFeedback()
  furthestReachedStep.value = PURCHASE_ORDER_CREATE_REVIEW_STEP
  activeStep.value = PURCHASE_ORDER_CREATE_REVIEW_STEP
  detailsDrawerVisible.value = false
  createSurface.value = 'review'
  toast.info('请检查采购订单信息是否正确')
  void focusPurchaseOrderReview()
}

function nextStep(): void {
  if (
    editingLocked.value
    || !steppedCreate.value
    || createSurface.value !== 'form'
    || activeStep.value === PURCHASE_ORDER_CREATE_REVIEW_STEP
  ) {
    return
  }
  if (
    supplierChangeConfirmVisible.value
    || customSupplierDraft.value !== (formModel.customSupplierName ?? '')
  ) {
    requestCustomSupplierChange()
    return
  }
  if (activeStep.value === 0 && currencyUnavailable.value) {
    toast.warning('CNY 当前不可用，请等待货币资料加载完成后再继续')
    return
  }
  if (
    activeStep.value === 0
    && salesLinkedCreate.value
    && selectedSalesOrder.value !== null
    && !sourceHasPurchasableLines.value
  ) {
    // 快捷入口和手工选单共享同一防线：来源加载中、加载失败或已经采购完毕时，
    // 都不能把用户带到一个注定无法同步产品的第二步。
    toast.warning(sourceLoading.value
      ? '销售订单产品明细仍在加载，请稍后重试'
      : sourceError.value || '销售订单产品明细尚未加载完成，请重新选择销售订单')
    return
  }
  const source = buildCurrentSource()
  if (source === null) {
    return
  }
  const step = activeStep.value as PurchaseOrderFormStep
  const result = validatePurchaseOrderCreateStep(source, step)
  if (!result.valid) {
    fieldErrors.value = { ...fieldErrors.value, ...result.fieldErrors }
    toast.warning(step === 2 && result.fieldErrors.parts ? result.fieldErrors.parts : STEP_VALIDATION_MESSAGE)
    focusFirstInvalidField(result.fieldErrors)
    return
  }

  // 本步骤重新校验通过后只清理本步骤旧错误，其他步骤的服务端错误仍需保留。
  fieldErrors.value = Object.freeze(Object.fromEntries(
    Object.entries(fieldErrors.value).filter(([path]) => (
      resolvePurchaseOrderCreateStepForField(path) !== step
    )),
  ))
  formError.value = ''
  requestId.value = undefined
  if (step === 2) {
    enterPurchaseOrderReview()
    return
  }
  furthestReachedStep.value = Math.max(furthestReachedStep.value, step + 1) as PurchaseOrderCreateStep
  goToFormStep(step + 1)
}

function returnToPurchaseOrderForm(): void {
  if (!steppedCreate.value || editingLocked.value || createSurface.value !== 'review') {
    return
  }
  createSurface.value = 'form'
  goToFormStep(2)
}

function openDetailsDrawer(): void {
  if (steppedCreate.value && !isDesktopSummary.value && createSurface.value === 'form') {
    detailsDrawerVisible.value = true
  }
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
      customSupplierName: '供应商名称',
      depositDueAmount: '定金',
      expectedShippingMarkResolution: '采购唛头规则',
      parts: '货件配置',
      lines: '添加数据库产品',
      orderDate: '采购日期',
      salesOrderId: '选择销售订单',
    }
    let label = directLabels[firstField]
    if (firstField.startsWith('parts.')) {
      label = '货件配置'
    }
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
  if (
    !canCreate.value
    || editingLocked.value
    || currencyUnavailable.value
    || (steppedCreate.value && createSurface.value !== 'review')
  ) {
    return
  }
  const result = buildCurrentRequest()
  if (result === null || !result.valid) {
    fieldErrors.value = result?.fieldErrors ?? {}
    formError.value = '请修正采购订单中的必填项和金额后再提交'
    if (steppedCreate.value) {
      createSurface.value = 'form'
      const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
      goToFormStep(errorStep ?? 2)
    }
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
    clearPurchaseRecipientDraft(route.query.paymentDraftKey)
    submitConfirmVisible.value = false
    toast.success(`采购订单 ${response.data.orderNo} 创建成功，已进入采购审核中`)
    void router.push({ name: 'qsOperationsPurchaseOrders' })
  }
  catch (error) {
    if (
      controller.signal.aborted
      || isPurchaseOrderAbortError(error)
      || state.requestVersion !== submitRequestVersion
      || state.authEpoch !== appAccountStore.authEpoch
    ) {
      return
    }
    const failure = getPurchaseOrderMutationFailure(error)
    submission.value = resolvePurchaseOrderSubmissionFailure(state, failure)
    fieldErrors.value = failure.fieldErrors
    formError.value = failure.message
    requestId.value = failure.requestId
    if (!failure.unknownResult) {
      frozenShippingMarkResolution.value = null
      frozenPartReview.value = null
      submitConfirmVisible.value = false
      if (steppedCreate.value) {
        createSurface.value = 'form'
        const errorStep = resolvePurchaseOrderCreateStepForErrors(failure.fieldErrors)
        goToFormStep(errorStep ?? 2)
      }
      focusFirstInvalidField(failure.fieldErrors)
      if (failure.refreshShippingMarkResolution) {
        // 已知未保存才允许更新摘要；刷新后仍停在第三步，让用户重新核对并确认。
        refreshShippingMarkResolution()
      }
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
    if (steppedCreate.value) {
      createSurface.value = 'form'
      const errorStep = resolvePurchaseOrderCreateStepForErrors(fieldErrors.value)
      goToFormStep(errorStep ?? 2)
    }
    focusFirstInvalidField(fieldErrors.value)
    return
  }
  const state = beginPurchaseOrderSubmission(
    submission.value,
    result.request,
    { authEpoch: appAccountStore.authEpoch, requestVersion: ++submitRequestVersion },
  )
  frozenShippingMarkResolution.value = shippingMarkResolution.value === null
    ? null
    : Object.freeze({ ...shippingMarkResolution.value })
  frozenPartReview.value = freezePurchaseOrderPartReview(formModel.lines, partConfigurations.value)
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
  if (submitLocked.value) {
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
  clearPurchaseRecipientDraft(route.query.paymentDraftKey)
  paymentAccounts.value = []
  shippingMarkResolver.reset()
  shortcutAbortController?.abort()
  sourceAbortController?.abort()
  synchronizeAbortController?.abort()
  submitAbortController?.abort()
  supplierChangeConfirmVisible.value = false
  pendingSupplierChange.value = null
  void router.replace({ name: 'qsOperationsPurchaseOrders' })
})

watch(() => formModel.supplierValue, refreshShippingMarkResolution, { flush: 'sync' })

// 明细同步、切换来源和返回修改都经过同一校验。缺失/超量的产品只撤回其分配，
// 不猜测真实分箱意图；未知结果期间冻结配置，保证原请求恢复不会变成新请求。
watch(() => formModel.lines.map(line => [line.key, line.quantity]), () => {
  if (editingLocked.value) {
    return
  }
  const next = reconcilePurchaseOrderParts(formModel.lines, partConfigurations.value)
  if (next.changed) {
    partConfigurations.value = next.parts
    toast.warning('采购产品或数量已变化，受影响产品的货件配置已清除，请重新配置')
  }
})

// 配置变更或离开此步骤时关闭传送到 body 的浮层，避免展示上一场景的配置。
watch([shippingMarkResolution, activeStep, createSurface], () => {
  shippingMarkDetailsOpen.value = false
})
onKeyStroke('Escape', (event) => {
  if (shippingMarkDetailsOpen.value) {
    event.stopPropagation()
    shippingMarkDetailsOpen.value = false
  }
})

watch(isDesktopSummary, (desktop) => {
  if (desktop) {
    detailsDrawerVisible.value = false
  }
})

onMounted(() => {
  if (!canCreate.value || createContext === null) {
    toast.warning('当前入口无效或缺少创建该类型采购订单的权限')
    void router.replace({ name: 'qsOperationsPurchaseOrders' })
    return
  }
  window.addEventListener('beforeunload', handleBeforeUnload)
  refreshShippingMarkResolution()
  void bindSourceSalesOrderFromShortcut()
})

onBeforeUnmount(() => {
  shippingMarkResolver.reset()
  shortcutAbortController?.abort()
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

    <div
      v-else
      data-testid="purchase-order-create-layout"
      class="purchase-order-create-layout m-4 min-w-0"
      :class="{
        'purchase-order-create-layout--form': steppedCreate && createSurface === 'form',
        'purchase-order-create-layout--review': steppedCreate && createSurface === 'review',
      }"
    >
      <div v-if="formError" class="purchase-order-alert-stack">
        <FaAlert
          title="采购订单尚不能提交"
          :description="formErrorDisplay"
          variant="destructive"
          role="alert"
        />
      </div>

      <!-- 产品表固定保留 128rem 最小列宽；从 FaPageMain 到产品卡片的每层 Grid item
           都必须允许收缩，才能让超宽内容进入表格自己的横向滚动，而不是扩大左侧轨道。 -->
      <FaPageMain
        class="purchase-order-form-track m-0 min-w-0 overflow-visible"
        main-class="min-w-0 overflow-visible"
        :inert="createSurface === 'review'"
        :aria-hidden="createSurface === 'review' ? 'true' : undefined"
      >
        <!-- 页面字段均显式绑定 formModel，并由采购领域逻辑分步骤校验；FaForm 仅提供
             表单语义和布局，不能回写外部模型，否则会删除未注册为 FaFormItem 的产品和付款字段。 -->
        <FaForm
          :disabled="submitLocked"
          :aria-busy="submission.phase === 'submitting' ? 'true' : 'false'"
          class="grid-cols-[minmax(0,1fr)] min-w-0"
        >
          <nav
            v-if="steppedCreate"
            ref="stepNavigationRef"
            class="purchase-order-step-navigation mb-6 pb-5 border-b border-border"
            :aria-label="`${title}填写步骤`"
            tabindex="-1"
          >
            <p class="text-sm text-muted-foreground m-0 mb-4" aria-live="polite">
              第 {{ activeStep + 1 }} 步，共 {{ purchaseOrderSteps.length }} 步：{{ activeStepTitle }}
            </p>
            <FaSteps v-model="activeStep" :steps="purchaseOrderSteps" status="process" class="w-full" />
          </nav>

          <div class="min-w-0">
            <main class="gap-6 grid grid-cols-[minmax(0,1fr)] min-w-0">
              <section
                v-show="activeStep === 0"
                class="gap-6 grid"
                :aria-label="salesLinkedCreate ? '采购基础信息与销售订单关联' : '采购基础信息'"
                data-testid="purchase-order-step-base"
              >
                <FaCard
                  title="采购基础信息"
                  description="订单号由 PURCHASE_ORDER 规则在最终二次确认后幂等派发。"
                  content-class="gap-4 grid grid-cols-1 md:grid-cols-2"
                >
                  <div class="p-4 border border-border rounded-lg bg-muted/25">
                    <p class="text-sm font-medium m-0">
                      采购订单号
                    </p>
                    <code class="text-sm text-muted-foreground font-mono mt-2 block">PURCHASE_ORDER · AUTO</code>
                  </div>
                  <div class="p-4 border border-border rounded-lg bg-muted/25">
                    <p class="text-sm font-medium m-0">
                      采购产品类型
                    </p>
                    <p class="text-sm text-muted-foreground m-0 mt-2">
                      {{ productMode === 'CATALOG' ? '产品库产品采购' : '自定义产品采购' }}
                    </p>
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
                  <FaFormItem
                    v-if="productMode === 'CATALOG'"
                    name="supplierValue"
                    label="供应商"
                    required
                    :auto-bind="false"
                  >
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
                  <FaFormItem
                    v-else
                    name="customSupplierName"
                    label="供应商名称"
                    required
                    :auto-bind="false"
                  >
                    <FaInput
                      aria-label="供应商名称"
                      :model-value="customSupplierDraft"
                      maxlength="128"
                      placeholder="填写自定义供应商名称"
                      :disabled="submitLocked"
                      @update:model-value="handleCustomSupplierUpdate"
                      @blur="requestCustomSupplierChange"
                    />
                    <p v-if="fieldErrors.customSupplierName" class="text-xs text-destructive m-0 mt-1" role="alert">
                      {{ fieldErrors.customSupplierName }}
                    </p>
                  </FaFormItem>
                </FaCard>

                <FaCard v-if="productMode === 'CUSTOM'" :title="t('purchasePayment.customRecipients')" :description="t('purchasePayment.customRecipientsHint')">
                  <QsPaymentRecipientEditor v-model="paymentAccounts" :minimum="1" :disabled="editingLocked" @busy-change="recipientUploading = $event" />
                  <p v-if="fieldErrors.paymentAccounts" class="text-xs text-destructive mt-2" role="alert">
                    {{ fieldErrors.paymentAccounts }}
                  </p>
                </FaCard>

                <FaCard
                  v-if="salesLinkedCreate"
                  title="销售订单关联"
                  description="一个采购订单只关联一个销售订单；同一销售订单可拆分为多个采购订单。"
                >
                  <div
                    class="p-4 border rounded-xl bg-muted/20 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
                    :class="selectedSalesOrder !== null ? 'border-primary' : 'border-border'"
                  >
                    <div class="min-w-0">
                      <p class="font-medium m-0 break-all">
                        {{ selectedSalesOrder?.orderNo ?? '尚未选择销售订单' }}
                      </p>
                      <p class="text-sm text-muted-foreground m-0 mt-1 truncate">
                        {{ selectedSalesOrder ? `${selectedSalesOrder.customerName} · ${selectedSalesOrder.orderDate}` : '选择后获取客户名和剩余可采购产品' }}
                      </p>
                    </div>
                    <FaButton
                      type="button"
                      variant="default"
                      class="shrink-0 min-h-11 sm:min-h-9"
                      :class="selectedSalesOrder !== null ? 'border-amber-500 bg-amber-500 text-white hover:border-amber-600 hover:bg-amber-600 hover:text-white' : ''"
                      :disabled="submitLocked || sourceLoading || !supplierReady"
                      @click="sourceSelectorVisible = true"
                    >
                      <FaIcon
                        :name="selectedSalesOrder === null ? 'i-lucide:search' : 'i-lucide:arrow-left-right'"
                        aria-hidden="true"
                      />
                      {{ selectedSalesOrder === null ? '选择销售订单' : '重选销售订单' }}
                    </FaButton>
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
              </section>

              <section
                v-show="activeStep === 1"
                class="gap-6 grid grid-cols-[minmax(0,1fr)] min-w-0"
                aria-label="采购产品明细与付款约定"
                data-testid="purchase-order-step-products-payment"
              >
                <FaCard
                  class="min-w-0"
                  title="采购产品明细"
                  :description="purchaseType === 'STOCK'
                    ? productMode === 'CATALOG'
                      ? '仅可手工添加当前供应商的数据库产品。'
                      : '仅可手工添加自定义产品。'
                    : '从销售订单同步当前产品类型；可删除本次暂不采购的行。'"
                  content-class="min-w-0"
                >
                  <div v-if="salesLinkedCreate" class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p class="text-sm text-muted-foreground m-0">
                      {{ selectedSalesOrder ? `来源：${selectedSalesOrder.orderNo} · ${selectedSalesOrder.customerName}` : '请先在第一步关联销售订单' }}
                    </p>
                    <FaButton
                      type="button"
                      class="shrink-0 min-h-11 sm:min-h-9"
                      :loading="synchronizing"
                      :disabled="submitLocked || !sourceReady"
                      @click="synchronizeSourceProducts"
                    >
                      <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />同步销售产品明细
                    </FaButton>
                  </div>
                  <QsOrderProductLineEditor
                    class="purchase-order-line-editor"
                    :model-value="formModel.lines"
                    :read-only-lines="purchasedSourceLines"
                    currency="CNY"
                    :currencies="fixedCurrencies"
                    :load-products="loadPurchaseProducts"
                    :labels="lineLabels"
                    :disabled="submitLocked || currencyUnavailable || !supplierReady"
                    :field-errors="fieldErrors"
                    :fixed-product-supplier-value="formModel.supplierValue ?? undefined"
                    :maximum-quantity-by-key="maximumQuantityByKey"
                    :catalog-product-addable="purchaseType === 'STOCK' && productMode === 'CATALOG'"
                    :custom-product-addable="purchaseType === 'STOCK' && productMode === 'CUSTOM'"
                    :catalog-line-initial-actual-unit-price-amount="null"
                    custom-reference-unit-price-editable
                    :temporary-line-initial-actual-unit-price-amount="null"
                    product-selection-description="采购定价读取产品档案采购成本；本单采购价必须确认填写。"
                    @update:model-value="handleLinesUpdate"
                  />
                </FaCard>

                <PurchaseOrderPaymentTerms
                  :balance-due-amount="formModel.balanceDueAmount"
                  :currencies="fixedCurrencies"
                  :deposit-due-amount="formModel.depositDueAmount"
                  :disabled="submitLocked"
                  :field-errors="fieldErrors"
                  :purchase-total-amount="purchaseTotalAmount"
                  @update:balance-due-amount="handleBalanceUpdate"
                  @update:deposit-due-amount="handleDepositUpdate"
                />
              </section>

              <section
                v-show="activeStep === 2"
                aria-label="预定义货物件"
                data-testid="purchase-order-step-mark-remark"
              >
                <FaCard :title="t('purchaseOrderParts.title')" :description="t('purchaseOrderParts.configurationHelp')">
                  <div class="gap-4 grid grid-cols-1">
                    <div aria-label="货件配置" tabindex="-1" class="outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-primary/40" data-testid="purchase-order-part-configurator">
                      <QsPartConfigurator
                        :products="partProducts"
                        :model-value="displayedParts"
                        :disabled="editingLocked"
                        @update:model-value="handlePartsUpdate"
                        @warning="handlePartWarning"
                      />
                    </div>
                    <FaFormItem name="expectedShippingMarkResolution" label="采购唛头" required :auto-bind="false">
                      <div
                        class="p-3 outline-none border border-border rounded-lg bg-background min-w-0 w-full focus-visible:ring-2 focus-visible:ring-primary/40"
                        data-testid="purchase-order-shipping-mark-resolution"
                        :data-availability="shippingMarkResolution?.availability ?? 'PENDING'"
                        aria-label="采购唛头规则"
                        aria-live="polite"
                        :aria-busy="shippingMarkState.loading"
                        tabindex="-1"
                      >
                        <p v-if="shippingMarkState.loading" class="text-sm text-muted-foreground m-0 py-2" role="status">
                          正在匹配采购唛头规则…
                        </p>
                        <template v-else>
                          <div class="flex gap-2 items-center">
                            <p class="text-sm text-foreground font-medium m-0 min-w-0 break-words" data-testid="purchase-order-shipping-mark-name">
                              {{ shippingMarkResolution?.name || '尚未匹配唛头规则' }}
                            </p>
                            <FaTag
                              :variant="shippingMarkAvailable ? 'default' : 'destructive'"
                              class="shrink-0"
                              data-testid="purchase-order-shipping-mark-status"
                            >
                              {{ shippingMarkAvailable ? '可用' : '不可用' }}
                            </FaTag>
                            <!-- FaPopover 仅封装点击触发；此处使用现有 Arco 多触发浮层统一悬停、点击与键盘焦点。 -->
                            <APopover
                              v-if="shippingMarkResolution"
                              v-model:popup-visible="shippingMarkDetailsOpen"
                              :trigger="['hover', 'click', 'focus']"
                              :click-to-close="false"
                              :mouse-enter-delay="200"
                              :mouse-leave-delay="150"
                              position="br"
                              content-class="bg-background! border-border! p-3!"
                              arrow-class="bg-background! border-border!"
                            >
                              <FaButton
                                type="button"
                                variant="ghost"
                                size="icon"
                                class="text-muted-foreground ml-auto shrink-0 size-11 sm:size-7"
                                aria-label="唛头规则详细配置"
                                aria-haspopup="dialog"
                                :aria-expanded="shippingMarkDetailsOpen"
                                :aria-controls="shippingMarkDetailsId"
                              >
                                <FaIcon name="i-lucide:info" class="size-4" />
                              </FaButton>
                              <template #content>
                                <div :id="shippingMarkDetailsId" class="text-foreground max-w-[calc(100vw-64px)] w-72" role="dialog" aria-label="唛头规则详细配置" data-testid="purchase-order-shipping-mark-details">
                                  <dl class="text-sm leading-6 m-0 gap-x-3 gap-y-1 grid grid-cols-[auto_minmax(0,1fr)]">
                                    <dt class="text-muted-foreground">
                                      规则编码
                                    </dt>
                                    <dd class="font-qs-data-mono m-0 break-all">
                                      {{ shippingMarkResolution.ruleCode || '-' }}
                                    </dd>
                                    <dt class="text-muted-foreground">
                                      匹配来源
                                    </dt>
                                    <dd class="m-0">
                                      {{ shippingMarkResolution.matchSource === 'CUSTOM_RULE' ? '自定义采购固定规则' : '供应商绑定规则' }}
                                    </dd>
                                    <dt class="text-muted-foreground">
                                      生效版本
                                    </dt>
                                    <dd class="m-0">
                                      {{ shippingMarkResolution.activeRevision === null ? '无生效版本' : `第 ${shippingMarkResolution.activeRevision} 版` }}
                                    </dd>
                                    <template v-if="shippingMarkResolution.activeConfig">
                                      <dt class="text-muted-foreground">
                                        重置周期
                                      </dt>
                                      <dd class="m-0">
                                        {{ numberingResetPolicyLabel(shippingMarkResolution.activeConfig.resetPolicy) }}
                                      </dd>
                                      <dt class="text-muted-foreground">
                                        时区
                                      </dt>
                                      <dd class="font-qs-data-mono m-0 break-all">
                                        {{ shippingMarkResolution.activeConfig.timezone }}
                                      </dd>
                                      <dt class="text-muted-foreground">
                                        最长长度
                                      </dt>
                                      <dd class="m-0">
                                        {{ shippingMarkResolution.activeConfig.maxOutputLength }} 位
                                      </dd>
                                    </template>
                                  </dl>
                                  <p class="text-xs text-muted-foreground leading-relaxed m-0 mt-2" data-testid="purchase-order-shipping-mark-dispatch-detail">
                                    {{ t(PURCHASE_SHIPPING_MARK_DISPATCH_HINT) }}
                                  </p>
                                </div>
                              </template>
                            </APopover>
                          </div>
                          <p v-if="shippingMarkResolution?.activeConfig" class="font-qs-data-mono text-sm text-foreground leading-5 m-0 mt-1 break-all" aria-label="编号结构" data-testid="purchase-order-shipping-mark-structure">
                            {{ formatNumberingRuleStructure(shippingMarkResolution.activeConfig) }}
                          </p>
                          <p class="text-xs text-muted-foreground leading-5 m-0 mt-1" data-testid="purchase-order-shipping-mark-hint">
                            <template v-if="shippingMarkResolution">
                              {{ shippingMarkResolution.matchSource === 'CUSTOM_RULE' ? '自定义采购' : '供应商绑定' }} ·
                            </template>{{ t('purchaseOrderParts.reviewDispatch') }}
                          </p>
                          <div v-if="!shippingMarkAvailable" class="mt-2" role="alert">
                            <p class="text-sm text-destructive m-0 break-words">
                              {{ shippingMarkState.error || shippingMarkResolution?.message || '尚未匹配采购唛头规则' }}
                            </p>
                            <p class="text-xs text-muted-foreground m-0 mt-1">
                              {{ shippingMarkState.error ? '可返回上一步后重试，已填写的内容会保留。' : '请联系管理员配置可用规则。' }}
                            </p>
                          </div>
                        </template>
                      </div>
                      <p v-if="fieldErrors.expectedShippingMarkResolution" class="text-xs text-destructive m-0 mt-1" role="alert">
                        {{ fieldErrors.expectedShippingMarkResolution }}
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
                      <p v-if="fieldErrors.remark" class="text-xs text-destructive m-0 mt-1" role="alert">
                        {{ fieldErrors.remark }}
                      </p>
                    </FaFormItem>
                  </div>
                </FaCard>
              </section>

              <nav
                v-if="steppedCreate"
                class="mt-1 pt-4 border-t border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                aria-label="采购订单填写步骤操作"
              >
                <FaButton
                  type="button"
                  variant="outline"
                  class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                  :disabled="submitLocked"
                  @click="requestBack"
                >
                  取消
                </FaButton>
                <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <FaButton
                    v-if="activeStep > 0"
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="submitLocked"
                    @click="previousStep"
                  >
                    上一步
                  </FaButton>
                  <FaButton
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="submitLocked"
                    @click="nextStep"
                  >
                    下一步
                  </FaButton>
                  <FaButton
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto xl:hidden"
                    :disabled="submitLocked"
                    @click="openDetailsDrawer"
                  >
                    查看已填详情
                  </FaButton>
                </div>
              </nav>
            </main>
          </div>
        </FaForm>
      </FaPageMain>

      <Transition name="purchase-order-summary-panel">
        <aside
          v-if="steppedCreate"
          v-show="isDesktopSummary || createSurface === 'review'"
          data-testid="purchase-order-create-summary-column"
          class="purchase-order-summary-column min-w-0 self-stretch"
          :data-surface="createSurface"
          :aria-label="createSurface === 'review' ? '采购订单最终核对' : '已填采购订单详情'"
        >
          <div class="purchase-order-summary-shell">
            <header
              v-if="createSurface === 'review'"
              data-testid="purchase-order-create-review"
              class="purchase-order-review-heading"
            >
              <p class="text-xs text-primary tracking-wide font-semibold m-0">
                第 4 步，共 4 步 · 最终核对
              </p>
              <h2
                ref="reviewHeadingRef"
                class="text-xl tracking-tight font-semibold m-0 mt-1 outline-none rounded-md focus-visible:ring-2 focus-visible:ring-primary/40"
                tabindex="-1"
              >
                核对采购订单
              </h2>
              <p class="text-sm text-muted-foreground leading-6 m-0 mt-2">
                {{ t('purchaseOrderParts.reviewHelp') }}
              </p>
            </header>

            <div class="purchase-order-summary-region rounded-2xl min-h-0">
              <QsPurchaseOrderDesc
                :currencies="fixedCurrencies"
                :model="purchaseOrderDescModel"
              >
                <template #parts>
                  <PurchaseOrderPartsReview :products="partProducts" :parts="displayedParts" :compact="createSurface !== 'review'" />
                </template>
                <template #shipping-mark>
                  <PurchaseOrderShippingMarkSummary
                    :resolution="shippingMarkResolution"
                    :loading="shippingMarkState.loading"
                    :error="shippingMarkState.error"
                  />
                </template>
              </QsPurchaseOrderDesc>
              <PurchaseOrderPaymentRecipients v-if="productMode === 'CUSTOM' && createSurface === 'review'" :accounts="paymentAccounts" class="p-5 bg-card" />
            </div>

            <Transition name="purchase-order-submit-bar">
              <div
                v-if="createSurface === 'review'"
                class="purchase-order-review-actions p-4 border border-border rounded-2xl bg-background/95 shadow-lg"
              >
                <FaAlert
                  v-if="submission.phase === 'unknown'"
                  title="提交结果未知"
                  description="订单可能已经创建，请使用原幂等请求重新确认。"
                  variant="destructive"
                />
                <p
                  id="purchase-order-review-submit-status"
                  class="text-sm text-muted-foreground leading-5 m-0"
                  role="status"
                  aria-live="polite"
                >
                  {{ submitStatusMessage }}
                </p>
                <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <FaButton
                    type="button"
                    variant="outline"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    :disabled="editingLocked"
                    @click="returnToPurchaseOrderForm"
                  >
                    返回修改
                  </FaButton>
                  <FaButton
                    v-if="submission.phase === 'unknown'"
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    @click="retryUnknownSubmission"
                  >
                    使用相同请求重新确认
                  </FaButton>
                  <FaButton
                    v-else
                    type="button"
                    class="min-h-11 w-full sm:min-h-9 sm:min-w-36 sm:w-auto"
                    :loading="submitLocked"
                    :disabled="!submitReady"
                    aria-describedby="purchase-order-review-submit-status"
                    @click="requestSubmit"
                  >
                    提交订单
                  </FaButton>
                </div>
              </div>
            </Transition>
          </div>
        </aside>
      </Transition>
    </div>

    <QsGenericDrawer
      v-if="steppedCreate"
      v-model="detailsDrawerVisible"
      data-testid="purchase-order-details-drawer"
      title="已填采购订单详情"
      description="实时核对当前已填资料；完成第三步后通过“下一步”进入全屏核对。"
      placement="right"
      size="xl"
      :submitting="submitLocked"
    >
      <QsPurchaseOrderDesc
        :currencies="fixedCurrencies"
        :model="purchaseOrderDescModel"
        class="border-0 rounded-none shadow-none md:rounded-xl"
      >
        <template #parts>
          <PurchaseOrderPartsReview :products="partProducts" :parts="displayedParts" />
        </template>
        <template #shipping-mark>
          <PurchaseOrderShippingMarkSummary
            :resolution="shippingMarkResolution"
            :loading="shippingMarkState.loading"
            :error="shippingMarkState.error"
          />
        </template>
      </QsPurchaseOrderDesc>
      <template #footer>
        <div class="flex w-full justify-end">
          <FaButton type="button" variant="outline" class="min-h-11 w-full md:w-auto" @click="detailsDrawerVisible = false">
            继续填写
          </FaButton>
        </div>
      </template>
    </QsGenericDrawer>

    <PurchaseSourceSalesOrderSelector
      v-if="purchaseType === 'SALES_LINKED'"
      v-model="sourceSelectorVisible"
      :product-mode="productMode ?? 'CATALOG'"
      :supplier-value="formModel.supplierValue"
      :selected-order-id="selectedSalesOrder?.id ?? null"
      :disabled="submitLocked"
      :load-sales-orders="loadSourceSalesOrders"
      @confirm="handleSourceSalesOrderConfirm"
    />

    <QsGenericModal
      :model-value="supplierChangeConfirmVisible"
      title="确认更换供应商？"
      description="更换后将清空已选销售订单、采购产品明细、已采购展示行、定金和尾款。"
      size="sm"
      :dismiss-on-overlay="false"
      :submitting="submitLocked"
      @update:model-value="$event ? (supplierChangeConfirmVisible = true) : cancelSupplierChange()"
    >
      <p class="text-sm text-muted-foreground m-0">
        当前已填写的下游采购资料依赖原供应商，确认后需重新选择或添加。
      </p>
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="submitLocked" @click="cancelSupplierChange">
          保留原供应商
        </FaButton>
        <FaButton type="button" :disabled="submitLocked" @click="confirmSupplierChange">
          确认更换
        </FaButton>
      </template>
    </QsGenericModal>

    <QsGenericModal
      :model-value="submitConfirmVisible"
      title="确认提交采购订单？"
      :description="t('purchaseOrderParts.submitDescription')"
      size="sm"
      :closable="false"
      :dismiss-on-overlay="false"
      :submitting="submitLocked"
      @update:model-value="submitConfirmVisible = $event"
    >
      <FaAlert
        v-if="submission.phase === 'unknown'"
        title="保存结果未知"
        :description="formErrorDisplay"
        variant="destructive"
        class="mb-4"
      />
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
          货件数
        </dt>
        <dd class="text-sm font-medium m-0" data-testid="purchase-order-confirm-part-count">
          {{ t('purchaseOrderParts.confirmation', { count: displayedParts.length }) }}
        </dd>
        <dt class="text-sm text-muted-foreground">
          采购总价
        </dt>
        <dd class="m-0 overflow-x-auto">
          <AmountDisplay :value="purchaseTotalAmount" currency="CNY" :currencies="fixedCurrencies" />
        </dd>
      </dl>
      <PurchaseOrderPartsReview :products="partProducts" :parts="displayedParts" class="mt-4" />
      <section class="mt-4 pt-4 border-t border-border/70 min-w-0" aria-label="唛头规则" data-testid="purchase-order-confirm-shipping-mark">
        <h3 class="text-xs text-muted-foreground font-normal m-0 mb-2">
          唛头规则
        </h3>
        <PurchaseOrderShippingMarkSummary
          :resolution="shippingMarkResolution"
          :loading="shippingMarkState.loading"
          :error="shippingMarkState.error"
        />
      </section>
      <template #footer>
        <FaButton type="button" variant="outline" :disabled="editingLocked" @click="submitConfirmVisible = false">
          返回检查
        </FaButton>
        <FaButton v-if="submission.phase === 'unknown'" type="button" @click="retryUnknownSubmission">
          使用相同请求重新确认
        </FaButton>
        <FaButton v-else type="button" :loading="submitLocked" :disabled="!shippingMarkAvailable || editingLocked" @click="confirmSubmit">
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
.purchase-order-create-page {
  --purchase-order-sticky-top: calc(var(--g-slots-layout-top-height, 0px) + var(--g-header-actual-height, 0px) + var(--g-topbar-actual-height, 0px) + var(--g-main-container-padding-top, 0px) + 1rem);
  --purchase-order-review-viewport-height: calc(100dvh - var(--purchase-order-sticky-top));
}

.purchase-order-step-navigation,
.purchase-order-review-heading {
  scroll-margin-top: var(--purchase-order-sticky-top);
}

/*
 * 采购定价在临时产品场景同时展示金额输入、固定币种和下拉图标。
 * 仅在采购创建页扩大该语义列并同步增加表格宽度，避免影响销售订单共用组件的列布局。
 */
.purchase-order-line-editor :deep([data-slot="order-product-line-table"]) {
  min-width: 137rem;
}

.purchase-order-line-editor :deep([data-column="reference-unit-price"]) {
  width: 20rem;
  min-width: 20rem;
}

.purchase-order-create-layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
  transition:
    grid-template-columns 600ms cubic-bezier(0.22, 1, 0.36, 1),
    column-gap 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.purchase-order-alert-stack {
  grid-column: 1 / -1;
}

.purchase-order-form-track,
.purchase-order-summary-column {
  grid-column: 1;
  min-width: 0;
}

.purchase-order-form-track {
  transition:
    opacity 360ms ease,
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}

/*
 * 全屏核对时表单保持在组件树内以保留填写状态，但退出布局和焦点顺序。
 * inert/aria-hidden 与视觉过渡同步，避免键盘用户进入不可见控件。
 */
.purchase-order-create-layout--review .purchase-order-form-track {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  max-height: var(--purchase-order-review-viewport-height);
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-1rem);
}

.purchase-order-summary-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.purchase-order-summary-region {
  overflow: visible;
}

.purchase-order-review-heading {
  padding: 0.25rem 0.25rem 0;
}

.purchase-order-review-actions {
  display: grid;
  gap: 0.75rem;
  margin-bottom: max(0.75rem, env(safe-area-inset-bottom));
  backdrop-filter: blur(12px);
}

.purchase-order-summary-panel-enter-active,
.purchase-order-summary-panel-leave-active,
.purchase-order-submit-bar-enter-active,
.purchase-order-submit-bar-leave-active {
  transition:
    opacity 360ms ease,
    transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
}

.purchase-order-summary-panel-enter-from,
.purchase-order-summary-panel-leave-to {
  opacity: 0;
  transform: translateY(0.75rem);
}

.purchase-order-submit-bar-enter-from,
.purchase-order-submit-bar-leave-to {
  opacity: 0;
  transform: translateY(calc(100% + 1rem));
}

@media (width >= 1280px) {
  .purchase-order-create-layout--form {
    grid-template-columns: minmax(0, calc(100% - 31.5rem)) minmax(0, 30rem);
  }

  .purchase-order-create-layout--review {
    grid-template-columns: minmax(0, 0) minmax(0, 100%);
    column-gap: 0;
  }

  .purchase-order-summary-column {
    position: sticky;
    top: var(--purchase-order-sticky-top);
    grid-column: 2;
  }

  .purchase-order-create-layout--form .purchase-order-summary-column {
    height: 100%;
    min-height: calc(100dvh - var(--purchase-order-sticky-top) - 1rem);
    max-height: none;
    contain: size;
  }

  .purchase-order-create-layout--form .purchase-order-summary-shell {
    height: 100%;
    min-height: 0;
  }

  .purchase-order-create-layout--form .purchase-order-summary-region {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .purchase-order-create-layout--review .purchase-order-form-track {
    width: calc(100% - 31.5rem);
  }
}

.purchase-order-create-layout--review .purchase-order-summary-column {
  position: relative;
  top: auto;
  min-height: var(--purchase-order-review-viewport-height);
  max-height: none;
}

.purchase-order-create-layout--review .purchase-order-summary-shell {
  min-height: inherit;
}

@media (prefers-reduced-motion: reduce) {
  .purchase-order-create-layout,
  .purchase-order-form-track,
  .purchase-order-summary-panel-enter-active,
  .purchase-order-summary-panel-leave-active,
  .purchase-order-submit-bar-enter-active,
  .purchase-order-submit-bar-leave-active {
    transition: none;
  }

  .purchase-order-create-layout--review .purchase-order-form-track {
    transform: none;
  }
}

/* 创建页使用窗口滚动；局部 overflow 会让桌面实时详情失去正确的 sticky 参照系。 */
:global(.layout .main-container:has(.purchase-order-create-page)),
:global(#app-content:has(.purchase-order-create-page)) {
  overflow: visible;
}
</style>
