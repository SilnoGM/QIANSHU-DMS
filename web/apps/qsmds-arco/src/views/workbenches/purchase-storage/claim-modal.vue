<script setup lang="ts">
import type { ClaimShipmentStorageContainerChangeDto, ClaimShipmentStorageLineDto, SalesOrderDetailDto, SalesOrderListItemDto, ShipmentStorageClaimContainerChangeDto, ShipmentStorageClaimRequestDto, ShipmentStorageDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { storageFailureMessage } from '@/views/workbenches/shipment-storage/logic'
import { buildClaimContainerCopyText } from './claim-container-copy'
import { buildClaimMapping, hasCustomTargetLine } from './claim-mapping'

interface ContainerDraft {
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  codAmount: string | null
  codTouched: boolean
}

defineOptions({ name: 'ShipmentStorageClaimModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  storageRecord: ShipmentStorageDetailDto | null
  mode?: 'apply' | 'direct' | 'review'
  claimRequest?: ShipmentStorageClaimRequestDto | null
}>(), {
  mode: 'direct',
  claimRequest: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'requested': []
  'claimed': []
  'rejected': []
  'refresh': []
}>()

const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const appAccountStore = useAppAccountStore()
const orders = ref<SalesOrderListItemDto[]>([])
const ordersLoading = ref(false)
const selectedOrderId = ref('')
const selectedOrder = ref<SalesOrderDetailDto | null>(null)
const orderLoading = ref(false)
const error = ref('')
const submitting = ref(false)
const rejectMode = ref(false)
const rejectReason = ref('')
const overrideConfirmed = ref(false)
const overrideReason = ref('')
const manualTargets = ref<Record<string, string>>({})
const containerDrafts = ref<Record<string, ContainerDraft>>({})
const copyOpen = ref(false)
const copyText = ref('')
const copyError = ref('')
const copyPending = ref(false)
let controller: AbortController | null = null

const isReview = computed(() => props.mode === 'review')
const modalTitle = computed(() => {
  if (isReview.value) {
    return '审核调货申请'
  }
  return props.mode === 'apply' ? '申请调货' : '认领寄仓货件'
})
const reviewRequest = computed(() => props.mode === 'review' ? props.claimRequest : null)
const reviewAllocations = computed(() => reviewRequest.value?.allocations ?? [])
const displayCostTotal = computed(() => reviewRequest.value?.costTotalCny
  ?? props.storageRecord?.cost.totalCostCny
  ?? '0.00')
const displayOrderNo = computed(() => {
  if (isReview.value) {
    return reviewRequest.value?.targetSalesOrderNo ?? '—'
  }
  return selectedOrder.value?.orderNo ?? '—'
})
const reviewQuantity = computed(() => reviewAllocations.value.reduce((sum, line) => sum + line.quantity, 0))
const reviewHasOverride = computed(() => reviewAllocations.value
  .some(line => line.productMatchMode === 'MANUAL_OVERRIDE'))
const reviewHasLegacyMapping = computed(() => reviewAllocations.value
  .some(line => line.purchaseOrderLineId === null))
const reviewContainerChanges = computed(() => (reviewRequest.value?.containerChanges ?? [])
  .filter(change => change.recipientChanged || change.codChanged))
const reviewHasLegacyContainerChanges = computed(() => (
  reviewRequest.value !== null && reviewRequest.value.containerChanges === null
))
const containerItems = computed(() => props.storageRecord?.containerLoadingItems ?? [])
const hasContainerItems = computed(() => containerItems.value.length > 0)
const containerDraftsValid = computed(() => containerItems.value.every((item) => {
  const draft = containerDrafts.value[item.id]
  return draft !== undefined
    && draft.recipientName.trim() !== ''
    && draft.recipientPhone.trim() !== ''
    && draft.recipientAddress.trim() !== ''
}))

const orderOptions = computed(() => orders.value
  .filter(order => order.id !== props.storageRecord?.originSalesOrderId)
  .map(order => ({ value: order.id, label: `${order.orderNo} · ${order.customerName}` })))

const mapping = computed(() => buildClaimMapping(
  props.storageRecord?.lineSummary.previews ?? [],
  selectedOrder.value?.lines ?? [],
  manualTargets.value,
))
const manualTargetSources = computed(() => {
  const unmatchedIds = new Set(mapping.value.unmatched.map(item => item.purchaseOrderLineId))
  return (props.storageRecord?.lineSummary.previews ?? []).filter(source => (
    source.lineType === 'CUSTOM' && unmatchedIds.has(source.lineId)
  ))
})
const manualTargetOptions = computed(() => (selectedOrder.value?.lines ?? [])
  .filter(line => line.lineType === 'CUSTOM')
  .map(line => ({
    value: line.id,
    label: `第${line.lineNumber}行 · ${line.productName} · ×${line.quantity}`,
  })))
const hasCustomTargetLines = computed(() => hasCustomTargetLine(selectedOrder.value?.lines ?? []))
const unmatchedToDisplay = computed(() => {
  if (hasCustomTargetLines.value) {
    return mapping.value.unmatched
  }
  // 没有自定义目标行时，自定义库存产品的空下拉已经由专门提示说明，不重复报错。
  const customSourceIds = new Set(manualTargetSources.value.map(source => source.lineId))
  return mapping.value.unmatched.filter(item => !customSourceIds.has(item.purchaseOrderLineId))
})
const unmatchedRemainingBySource = computed(() => new Map(
  mapping.value.unmatched.map(item => [item.purchaseOrderLineId, item.remaining]),
))
const missingCustomTargetMessage = computed(() => (
  `自定义库存产品「${manualTargetSources.value.map(source => source.productName).join('、')}」`
  + '无法映射到目录产品行；请选择包含对应自定义产品的销售订单。'
))
const canSubmitMapping = computed(() => (
  selectedOrderId.value !== ''
  && selectedOrder.value !== null
  && mapping.value.complete
  && containerDraftsValid.value
  && (
    !mapping.value.requiresConfirmation
    || (overrideConfirmed.value && overrideReason.value.trim() !== '')
  )
))

function buildClaimLines(): ClaimShipmentStorageLineDto[] {
  const note = overrideReason.value.trim()
  return mapping.value.rows.map(row => ({
    purchaseOrderLineId: row.purchaseOrderLineId,
    salesOrderLineId: row.targetLineId,
    quantity: row.quantity,
    ...(row.mismatch
      ? { productMatchOverride: true, productMatchNote: note }
      : {}),
  }))
}

function setManualTarget(sourceId: string, targetLineId: string): void {
  const next = { ...manualTargets.value }
  if (targetLineId === '') {
    delete next[sourceId]
  }
  else {
    next[sourceId] = targetLineId
  }
  manualTargets.value = next
  overrideConfirmed.value = false
  overrideReason.value = ''
}

function createContainerDraft(item: ShipmentStorageDetailDto['containerLoadingItems'][number]): ContainerDraft {
  return {
    recipientName: item.recipientName ?? '',
    recipientPhone: item.recipientPhone ?? '',
    recipientAddress: item.recipientAddress ?? '',
    codAmount: item.codAmountTwd,
    codTouched: false,
  }
}

function resetContainerDrafts(): void {
  containerDrafts.value = Object.fromEntries(containerItems.value.map(item => [
    item.id,
    createContainerDraft(item),
  ]))
}

function syncContainerRecipients(order: SalesOrderDetailDto): void {
  const next = { ...containerDrafts.value }
  for (const item of containerItems.value) {
    const draft = next[item.id] ?? createContainerDraft(item)
    next[item.id] = {
      ...draft,
      recipientName: order.customer.name,
      recipientPhone: order.customer.phone,
      recipientAddress: order.customer.fullAddress,
    }
  }
  containerDrafts.value = next
}

function updateContainerDraft(itemId: string, patch: Partial<ContainerDraft>): void {
  const item = containerItems.value.find(candidate => candidate.id === itemId)
  const draft = containerDrafts.value[itemId] ?? (item === undefined ? undefined : createContainerDraft(item))
  if (draft === undefined) {
    return
  }
  containerDrafts.value = {
    ...containerDrafts.value,
    [itemId]: { ...draft, ...patch },
  }
  overrideConfirmed.value = false
  overrideReason.value = ''
}

function updateContainerCod(itemId: string, value: string | null): void {
  updateContainerDraft(itemId, { codAmount: value, codTouched: true })
}

function buildContainerChanges(): ClaimShipmentStorageContainerChangeDto[] {
  return containerItems.value.map((item) => {
    const draft = containerDrafts.value[item.id]
    return {
      loadingItemId: item.id,
      expectedVersion: item.version,
      recipientName: draft?.recipientName.trim() ?? '',
      recipientPhone: draft?.recipientPhone.trim() ?? '',
      recipientAddress: draft?.recipientAddress.trim() ?? '',
      codTouched: draft?.codTouched === true,
      ...(draft?.codTouched === true ? { codAmountTwd: draft.codAmount } : {}),
    }
  })
}

function handleClaimSuccess(changes: readonly ShipmentStorageClaimContainerChangeDto[]): void {
  const text = buildClaimContainerCopyText(changes)
  if (text === '') {
    emit('claimed')
    return
  }
  copyText.value = text
  copyError.value = ''
  copyPending.value = true
  copyOpen.value = true
}

function closeCopy(): void {
  copyOpen.value = false
  if (copyPending.value) {
    copyPending.value = false
    emit('claimed')
  }
}

function setCopyVisible(value: boolean): void {
  if (!value) {
    closeCopy()
  }
}

async function copyClaimText(): Promise<void> {
  try {
    await navigator.clipboard.writeText(copyText.value)
    copyError.value = ''
    toast.success('装柜修改信息已复制')
  }
  catch {
    copyError.value = '复制失败，请手动选择文本复制'
  }
}

function reset(): void {
  controller?.abort()
  controller = null
  orders.value = []
  selectedOrderId.value = ''
  selectedOrder.value = null
  error.value = ''
  submitting.value = false
  rejectMode.value = false
  rejectReason.value = ''
  overrideConfirmed.value = false
  overrideReason.value = ''
  manualTargets.value = {}
  containerDrafts.value = {}
  copyOpen.value = false
  copyText.value = ''
  copyError.value = ''
  copyPending.value = false
  resetContainerDrafts()
}

async function loadOrders(signal: AbortSignal): Promise<void> {
  ordersLoading.value = true
  try {
    const response = await salesOrdersApi.list({
      view: 'pending',
      statusSelection: 'PENDING',
      page: 1,
      pageSize: 100,
      // 认领只能落到待采购订单；运营申请再收窄为本人负责的销售订单。
      ...(props.mode === 'apply' && appAccountStore.userId !== ''
        ? { issuerUserId: appAccountStore.userId }
        : {}),
    }, signal)
    if (!signal.aborted) {
      orders.value = response.data.items
    }
  }
  catch (failure) {
    if (!signal.aborted) {
      error.value = storageFailureMessage(failure, '销售订单加载失败')
    }
  }
  finally {
    if (!signal.aborted) {
      ordersLoading.value = false
    }
  }
}

async function changeOrder(value: string): Promise<void> {
  selectedOrderId.value = value
  selectedOrder.value = null
  overrideConfirmed.value = false
  overrideReason.value = ''
  manualTargets.value = {}
  error.value = ''
  if (value === '') {
    return
  }
  const request = new AbortController()
  controller?.abort()
  controller = request
  orderLoading.value = true
  try {
    const response = await salesOrdersApi.getById(value, request.signal)
    if (!request.signal.aborted) {
      selectedOrder.value = response.data
      syncContainerRecipients(response.data)
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = storageFailureMessage(failure, '销售订单详情加载失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      orderLoading.value = false
    }
  }
}

function validateContainerDrafts(): boolean {
  if (containerDraftsValid.value) {
    return true
  }
  error.value = '请完整填写每条装柜明细的收件人姓名、电话和地址'
  return false
}

async function submitApply(): Promise<void> {
  const record = props.storageRecord
  if (record === null || selectedOrderId.value === '' || submitting.value) {
    return
  }
  if (!validateContainerDrafts()) {
    return
  }
  if (!mapping.value.complete) {
    error.value = '库存产品无法完整映射到目标订单行'
    return
  }
  if (mapping.value.requiresConfirmation
    && (!overrideConfirmed.value || overrideReason.value.trim() === '')) {
    error.value = '存在自定义跨产品映射，请先确认并填写原因'
    return
  }
  submitting.value = true
  error.value = ''
  const request = new AbortController()
  try {
    await shipmentStorageApi.createClaimRequest(record.id, {
      salesOrderId: selectedOrderId.value,
      lines: buildClaimLines(),
      containerChanges: buildContainerChanges(),
      requestKey: crypto.randomUUID(),
    }, request.signal)
    toast.success('调货申请已提交')
    emit('requested')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请提交失败')
  }
  finally {
    submitting.value = false
  }
}

async function submitDirect(): Promise<void> {
  const record = props.storageRecord
  if (record === null || selectedOrderId.value === '' || submitting.value) {
    return
  }
  if (!validateContainerDrafts()) {
    return
  }
  if (!mapping.value.complete) {
    error.value = '库存产品无法完整映射到目标订单行'
    return
  }
  if (mapping.value.requiresConfirmation
    && (!overrideConfirmed.value || overrideReason.value.trim() === '')) {
    error.value = '存在自定义跨产品映射，请先确认并填写原因'
    return
  }
  submitting.value = true
  error.value = ''
  const request = new AbortController()
  try {
    const response = await shipmentStorageApi.claim(record.id, {
      salesOrderId: selectedOrderId.value,
      lines: buildClaimLines(),
      containerChanges: buildContainerChanges(),
      requestKey: crypto.randomUUID(),
    }, request.signal)
    toast.success('寄仓货件已认领')
    handleClaimSuccess(response.data.containerChanges ?? [])
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '认领失败')
  }
  finally {
    submitting.value = false
  }
}

async function approveRequest(): Promise<void> {
  const record = props.storageRecord
  const request = reviewRequest.value
  if (record === null || request === null || submitting.value) {
    return
  }
  if (reviewHasLegacyContainerChanges.value) {
    error.value = '历史调货申请缺少装柜修改快照，请让申请人撤回后重新提交'
    return
  }
  submitting.value = true
  error.value = ''
  const controller = new AbortController()
  try {
    const response = await shipmentStorageApi.approveClaimRequest(record.id, request.id, controller.signal)
    toast.success('调货申请已通过')
    handleClaimSuccess(response.data.containerChanges ?? [])
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请审核失败')
    // 复检失败时服务端会把申请转为拒绝；通知页面刷新锁定态。
    emit('refresh')
  }
  finally {
    submitting.value = false
  }
}

async function rejectRequest(): Promise<void> {
  const record = props.storageRecord
  const request = reviewRequest.value
  if (record === null || request === null || submitting.value) {
    return
  }
  if (rejectReason.value.trim() === '') {
    error.value = '请填写拒绝原因'
    return
  }
  submitting.value = true
  error.value = ''
  const controller = new AbortController()
  try {
    await shipmentStorageApi.rejectClaimRequest(record.id, request.id, {
      reason: rejectReason.value.trim(),
    }, controller.signal)
    toast.success('调货申请已拒绝')
    emit('rejected')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请拒绝失败')
  }
  finally {
    submitting.value = false
  }
}

async function submit(): Promise<void> {
  if (isReview.value) {
    await approveRequest()
    return
  }
  if (props.mode === 'apply') {
    await submitApply()
    return
  }
  await submitDirect()
}

watch(() => props.modelValue, (visible) => {
  reset()
  if (visible && !isReview.value) {
    const request = new AbortController()
    controller = request
    void loadOrders(request.signal)
  }
})

function setVisible(value: boolean): void {
  if (submitting.value) {
    return
  }
  emit('update:modelValue', value)
}
</script>

<template>
  <FaModal :model-value="modelValue" :title="modalTitle" size="lg" @update:model-value="setVisible">
    <div class="flex flex-col gap-4">
      <FaAlert v-if="error" :description="error" variant="destructive" />
      <div class="gap-3 grid sm:grid-cols-2">
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            寄仓货件
          </p>
          <p class="mb-0 mt-1">
            {{ storageRecord?.shipmentNo ?? '—' }} · {{ storageRecord?.shippingMarkText ?? '无唛头' }}
          </p>
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            成本合计
          </p>
          <AmountDisplay
            :value="displayCostTotal"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="text-lg text-primary font-semibold mt-1"
          />
        </div>
      </div>

      <div v-if="isReview" class="flex flex-col gap-3">
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            申请人
          </p>
          <QsPersonDisplay
            v-if="reviewRequest"
            :display-name="reviewRequest.applicant.displayName"
            :avatar-url="reviewRequest.applicant.avatarUrl"
            size="sm"
            class="mt-1"
          />
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            目标销售订单
          </p>
          <p class="mb-0 mt-1">
            {{ displayOrderNo }}
          </p>
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            认领映射
          </p>
          <div
            v-for="(line, index) in reviewAllocations"
            :key="`${line.purchaseOrderLineId ?? 'legacy'}-${line.salesOrderLineId}-${index}`"
            class="mt-2 flex gap-3 items-start justify-between"
          >
            <div class="min-w-0">
              <p class="mb-0 truncate">
                {{ line.sourceProductName ?? '—' }}
              </p>
              <p v-if="line.sourceProductDescription" class="text-xs text-muted-foreground mb-0 truncate">
                {{ line.sourceProductDescription }}
              </p>
              <p class="text-xs text-muted-foreground mb-0 truncate">
                {{ line.purchaseOrderLineId === null
                  ? '历史申请，缺少库存分配映射'
                  : `→ 第${line.lineNumber}行 ${line.productName}` }}
              </p>
              <p v-if="line.productDescription" class="text-xs text-muted-foreground mb-0 truncate">
                {{ line.productDescription }}
              </p>
              <p v-if="line.productMatchMode === 'MANUAL_OVERRIDE'" class="text-xs text-amber-600 mb-0 mt-1">
                人工确认跨产品{{ line.productMatchNote ? `：${line.productMatchNote}` : '' }}
              </p>
            </div>
            <span class="font-mono shrink-0">× {{ line.quantity }}</span>
          </div>
          <p class="qs-type-meta text-muted-foreground mb-0 mt-2">
            整件认领数量：{{ reviewQuantity }}
          </p>
          <FaAlert
            v-if="reviewHasOverride"
            class="mt-2"
            variant="destructive"
            title="包含人工确认的跨产品映射"
            description="请核对库存产品与目标销售行确为同一产品后再同意。"
          />
          <FaAlert
            v-if="reviewHasLegacyMapping"
            class="mt-2"
            variant="destructive"
            title="申请映射数据过旧"
            description="该申请缺少库存分配映射，不能直接同意；请让申请人撤回后重新提交。"
          />
        </div>
        <div v-if="reviewHasLegacyContainerChanges" class="p-3 border border-border rounded-lg">
          <FaAlert
            variant="destructive"
            title="申请缺少装柜修改快照"
            description="该申请不能直接同意；请让申请人撤回后重新提交。"
          />
        </div>
        <div v-else-if="reviewContainerChanges.length > 0" class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            装柜收件信息（只读）
          </p>
          <div
            v-for="change in reviewContainerChanges"
            :key="change.loadingItemId"
            class="mt-3 pt-3 border-t border-border first:mt-2 first:pt-0 first:border-t-0"
          >
            <div class="flex gap-2 items-baseline justify-between">
              <span class="font-medium">{{ change.containerBatchName }} · 第{{ change.lineNumber }}行 · {{ change.oceanShippingMarkText || '—' }}</span>
              <span class="text-xs text-muted-foreground">v{{ change.expectedVersion }}</span>
            </div>
            <dl v-if="change.recipientChanged" class="text-sm mt-1 gap-x-3 gap-y-1 grid grid-cols-[4.5rem_minmax(0,1fr)]">
              <dt class="text-muted-foreground">
                姓名
              </dt>
              <dd class="m-0 break-words">
                {{ change.beforeRecipientName || '—' }} → {{ change.afterRecipientName }}
              </dd>
              <dt class="text-muted-foreground">
                电话
              </dt>
              <dd class="m-0 break-words">
                {{ change.beforeRecipientPhone || '—' }} → {{ change.afterRecipientPhone }}
              </dd>
              <dt class="text-muted-foreground">
                地址
              </dt>
              <dd class="m-0 break-words">
                {{ change.beforeRecipientAddress || '—' }} → {{ change.afterRecipientAddress }}
              </dd>
            </dl>
            <p v-if="change.codChanged" class="text-sm mb-0 mt-1">
              代收：{{ change.beforeCodAmountTwd ?? '无代收' }}
              →
              {{ change.afterCodAmountTwd === null ? '取消代收' : change.afterCodAmountTwd }}
            </p>
          </div>
        </div>
        <div v-if="rejectMode" class="p-3 border border-border rounded-lg flex flex-col gap-2">
          <span class="text-sm">拒绝原因 <span class="text-destructive">*</span></span>
          <FaTextarea
            v-model="rejectReason"
            :rows="3"
            maxlength="500"
            placeholder="请说明拒绝原因"
            :disabled="submitting"
          />
        </div>
      </div>

      <template v-else>
        <label class="flex flex-col gap-1">
          <span class="text-sm">目标销售订单</span>
          <FaSelect
            :model-value="selectedOrderId"
            :options="orderOptions"
            :disabled="ordersLoading || submitting"
            :placeholder="ordersLoading ? '加载中…' : '选择待采购的销售订单'"
            @update:model-value="changeOrder(String($event))"
          />
        </label>
        <p v-if="!ordersLoading && orderOptions.length === 0" class="text-sm text-muted-foreground mb-0">
          没有可选择的待采购销售订单。
        </p>
        <div v-if="orderLoading" class="text-sm text-muted-foreground">
          正在加载销售行…
        </div>
        <div v-else-if="selectedOrder" class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            认领映射
          </p>
          <div
            v-for="row in mapping.rows"
            :key="row.key"
            class="mt-2 flex gap-3 items-start justify-between"
          >
            <div class="min-w-0">
              <p class="mb-0 truncate">
                {{ row.sourceProductName }}
              </p>
              <p v-if="row.sourceProductDescription" class="text-xs text-muted-foreground mb-0 truncate">
                {{ row.sourceProductDescription }}
              </p>
              <p class="text-xs text-muted-foreground mb-0 truncate">
                → 第{{ row.targetLineNumber }}行 {{ row.targetProductName }}
                <span v-if="row.mismatch" class="text-amber-600">（跨产品，需确认）</span>
              </p>
              <p v-if="row.targetProductDescription" class="text-xs text-muted-foreground mb-0 truncate">
                {{ row.targetProductDescription }}
              </p>
            </div>
            <span class="font-mono shrink-0">× {{ row.quantity }}</span>
          </div>
          <FaAlert
            v-if="manualTargetSources.length > 0 && !hasCustomTargetLines"
            class="mt-3"
            variant="destructive"
            title="目标订单没有自定义产品行"
            :description="missingCustomTargetMessage"
          />
          <div v-else-if="manualTargetSources.length > 0" class="mt-3 p-3 border border-amber-500/40 rounded-lg">
            <p class="text-sm mb-0">
              以下自定义库存产品没有同名目标行，请选择目标销售行：
            </p>
            <div
              v-for="source in manualTargetSources"
              :key="source.lineId"
              class="mt-2 gap-2 grid items-center sm:grid-cols-[minmax(0,1fr)_12rem]"
            >
              <span class="text-sm truncate">
                {{ source.productName }} × {{ unmatchedRemainingBySource.get(source.lineId) ?? source.quantity }}
              </span>
              <FaSelect
                :model-value="manualTargets[source.lineId] ?? ''"
                :options="manualTargetOptions"
                :disabled="submitting"
                placeholder="选择目标行"
                @update:model-value="setManualTarget(source.lineId, String($event))"
              />
            </div>
          </div>
          <div v-if="unmatchedToDisplay.length > 0" class="mt-2 flex flex-col gap-1">
            <p
              v-for="item in unmatchedToDisplay"
              :key="item.purchaseOrderLineId"
              class="text-xs text-destructive mb-0"
            >
              {{ item.productName }} × {{ item.remaining }} 无法匹配目标订单行。
            </p>
          </div>
          <div v-if="mapping.requiresConfirmation" class="mt-3 p-3 border border-amber-500/40 rounded-lg">
            <FaCheckbox v-model="overrideConfirmed" :disabled="submitting">
              我已核对以上跨产品为同一产品
            </FaCheckbox>
            <FaTextarea
              v-model="overrideReason"
              class="mt-2"
              :rows="3"
              maxlength="500"
              placeholder="填写确认原因（必填）"
              :disabled="submitting || !overrideConfirmed"
            />
          </div>
          <p v-else-if="mapping.complete" class="qs-type-meta text-muted-foreground mb-0 mt-2">
            首期只支持整件认领；映射按库存分配行生成，每行数量完整对应。
          </p>
          <p v-else class="text-xs text-destructive mb-0 mt-2">
            库存产品无法完整映射到目标订单行，不能整件走货。
          </p>
        </div>
        <div v-if="selectedOrder && hasContainerItems" class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            装柜收件信息
          </p>
          <p class="text-xs text-muted-foreground mb-0 mt-1">
            按装柜明细逐行核对；收件人信息默认取目标订单客户，可修改。收件人姓名、电话、地址必填。
          </p>
          <div
            v-for="item in containerItems"
            :key="item.id"
            class="mt-3 pt-3 border-t border-border first:mt-2 first:pt-0 first:border-t-0"
          >
            <div class="flex gap-2 items-baseline justify-between">
              <span class="font-medium">{{ item.containerBatch.containerBatchName }} · 第{{ item.lineNumber }}行 · {{ item.oceanShippingMarkText || '—' }}</span>
              <span class="text-xs text-muted-foreground">{{ item.goodsName }}</span>
            </div>
            <div class="mt-2 gap-3 grid sm:grid-cols-2">
              <label class="flex flex-col gap-1">
                <span class="text-sm">收件人姓名 <span class="text-destructive">*</span></span>
                <FaInput
                  :model-value="containerDrafts[item.id]?.recipientName ?? ''"
                  maxlength="128"
                  :disabled="submitting"
                  @update:model-value="updateContainerDraft(item.id, { recipientName: String($event ?? '') })"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-sm">收件人电话 <span class="text-destructive">*</span></span>
                <FaInput
                  :model-value="containerDrafts[item.id]?.recipientPhone ?? ''"
                  maxlength="128"
                  :disabled="submitting"
                  @update:model-value="updateContainerDraft(item.id, { recipientPhone: String($event ?? '') })"
                />
              </label>
              <label class="flex flex-col gap-1 sm:col-span-2">
                <span class="text-sm">收件人地址 <span class="text-destructive">*</span></span>
                <FaTextarea
                  :model-value="containerDrafts[item.id]?.recipientAddress ?? ''"
                  :rows="2"
                  maxlength="2000"
                  :disabled="submitting"
                  @update:model-value="updateContainerDraft(item.id, { recipientAddress: String($event ?? '') })"
                />
              </label>
              <label class="flex flex-col gap-1 sm:col-span-2">
                <span class="text-sm">此票代收金额</span>
                <MoneyInput
                  :model-value="containerDrafts[item.id]?.codAmount ?? null"
                  currency="TWD"
                  :currencies="currencyCatalog.currencies.value"
                  :currency-selectable="false"
                  :disabled="submitting"
                  min="0"
                  @update:model-value="updateContainerCod(item.id, $event)"
                />
              </label>
              <p class="text-xs text-muted-foreground mb-0 sm:col-span-2">
                留空或填 0 表示本行不涉及代收；修改后会按「取消代收」通知。
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex gap-2 justify-end">
        <template v-if="isReview">
          <template v-if="rejectMode">
            <FaButton variant="outline" :disabled="submitting" @click="rejectMode = false">
              取消
            </FaButton>
            <FaButton variant="destructive" :loading="submitting" @click="rejectRequest">
              确认拒绝
            </FaButton>
          </template>
          <template v-else>
            <FaButton variant="outline" :disabled="submitting || !reviewRequest" @click="rejectMode = true">
              拒绝
            </FaButton>
            <FaButton :loading="submitting" :disabled="!reviewRequest || reviewHasLegacyMapping || reviewHasLegacyContainerChanges" @click="submit">
              同意调货
            </FaButton>
          </template>
        </template>
        <template v-else>
          <FaButton variant="outline" :disabled="submitting" @click="setVisible(false)">
            取消
          </FaButton>
          <FaButton
            :loading="submitting"
            :disabled="!canSubmitMapping"
            @click="submit"
          >
            {{ mode === 'apply' ? '提交申请' : '确认认领' }}
          </FaButton>
        </template>
      </div>
    </template>
  </FaModal>

  <QsGenericModal
    :model-value="copyOpen"
    title="复制装柜修改信息"
    description="请复制后发送给运营人员或顺联航群组。"
    size="md"
    :z-index="3000"
    @update:model-value="setCopyVisible"
  >
    <div class="flex flex-col gap-3">
      <FaAlert v-if="copyError" :description="copyError" variant="destructive" />
      <pre class="text-sm font-mono m-0 p-4 border border-border rounded-lg bg-muted/30 max-h-96 whitespace-pre-wrap break-words overflow-auto">{{ copyText }}</pre>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" @click="closeCopy">
        关闭
      </FaButton>
      <FaButton type="button" @click="copyClaimText">
        复制
      </FaButton>
    </template>
  </QsGenericModal>
</template>
