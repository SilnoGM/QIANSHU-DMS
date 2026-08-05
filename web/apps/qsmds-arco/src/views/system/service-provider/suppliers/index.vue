<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type {
  SupplierCreateIntent,
  SupplierFormFieldErrors,
  SupplierFormMode,
  SupplierStatusAction,
} from './supplier-management.logic'
import type {
  CreateSupplierRequestDto,
  SupplierDto,
  SupplierListItemDto,
  UpdateSupplierRequestDto,
} from '@/api/modules/suppliers'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import { useMediaQuery } from '@vueuse/core'
import suppliersApi from '@/api/modules/suppliers'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { hasVisibleTableColumn } from '../../shared/table-query'
import SupplierDetailDrawer from './supplier-detail-drawer.vue'
import SupplierFormDrawer from './supplier-form-drawer.vue'
import {
  buildSupplierListQuery,
  canApplySupplierMutationResult,
  canApplySupplierQueryResponse,
  createSupplierCreateIntentFromPayload,
  getSupplierApiFailure,
  getSupplierMutationFailure,
  isSupplierAbortError,
  markSupplierCreateIntentUnknown,
  resolveSupplierActions,
  retrySupplierCreateIntent,
} from './supplier-management.logic'
import SupplierStatusChangeModal from './supplier-status-change-modal.vue'

defineOptions({ name: 'SystemServiceProviderSuppliers' })

type SupplierRowAction = 'detail' | 'disable' | 'edit' | 'enable'
type FormSubmission
  = | { mode: 'create', value: CreateSupplierRequestDto }
    | { mode: 'edit', supplierId: string, value: UpdateSupplierRequestDto }

interface SupplierFormDrawerExpose {
  closeForAuthorityLoss: () => void
  closeWithoutDirtyGuard: () => void
}

interface PendingMobileAction {
  readonly action: SupplierRowAction
  readonly supplier: SupplierListItemDto
}

interface PendingDetailAction {
  readonly action: SupplierStatusAction | 'edit'
  readonly supplier: SupplierDto
}

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()
const isNarrow = useMediaQuery('(max-width: 767px)')

const canRead = computed(() => auth('suppliers:read'))
const canCreate = computed(() => auth('suppliers:create'))
const canUpdate = computed(() => auth('suppliers:update'))
const canEnable = computed(() => auth('suppliers:enable'))
const canDisable = computed(() => auth('suppliers:disable'))

const rows = ref<SupplierListItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const sorting = ref<TableSortingState>([
  { desc: true, id: 'updatedAt' },
])
const listLoading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let listRefreshQueued = false
let disposed = false

const detailVisible = ref(false)
const detail = ref<SupplierDto | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailRequestId = ref<string>()
const detailTargetId = ref<string | null>(null)
let detailRequestVersion = 0
let detailAbortController: AbortController | null = null

const formDrawerRef = useTemplateRef<SupplierFormDrawerExpose>('formDrawerRef')
const formVisible = ref(false)
const formMode = ref<SupplierFormMode>('create')
const formTarget = ref<SupplierDto | null>(null)
const formLoading = ref(false)
const formSubmitting = ref(false)
const formError = ref('')
const formRequestId = ref<string>()
const formFieldErrors = ref<SupplierFormFieldErrors>({})
const createIntent = ref<SupplierCreateIntent | null>(null)
const createResultUnknown = computed(() => createIntent.value?.state === 'unknown')
const discardConfirmVisible = ref(false)

const statusVisible = ref(false)
const statusAction = ref<SupplierStatusAction>('enable')
const statusTarget = ref<SupplierDto | null>(null)
const statusSubmitting = ref(false)
const statusError = ref('')
const statusRequestId = ref<string>()

const mobileActionsVisible = ref(false)
const mobileActionTarget = ref<SupplierListItemDto | null>(null)
const pendingMobileAction = ref<PendingMobileAction | null>(null)
const pendingDetailAction = ref<PendingDetailAction | null>(null)

let mutationGeneration = 0
let currentMutationTargetId: string | null = null

const columns: QsGenericTableColumn<SupplierListItemDto>[] = [
  {
    accessorFn: item => item.legalName,
    id: 'supplier',
    minWidth: 260,
    title: '供应商',
  },
  {
    accessorKey: 'entityType',
    id: 'entityType',
    title: '主体类型',
    width: 120,
  },
  {
    accessorFn: item => item.primaryContactName,
    id: 'contact',
    minWidth: 180,
    title: '主要联系人',
  },
  {
    accessorFn: item => item.primaryAddressRegionPath.map(region => region.name).join(' '),
    id: 'region',
    minWidth: 210,
    title: '主要地区',
  },
  {
    accessorKey: 'enabled',
    id: 'status',
    title: '状态',
    width: 110,
  },
  {
    accessorKey: 'updatedAt',
    enableMultiSort: false,
    id: 'updatedAt',
    minWidth: 180,
    sortable: true,
    title: '更新时间',
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '使用状态',
    options: [
      { label: '已启用', value: 'ENABLED' },
      { label: '已停用', value: 'DISABLED' },
    ],
  },
  {
    key: 'entityType',
    label: '主体类型',
    options: [
      { label: '企业/组织', value: 'ORGANIZATION' },
      { label: '个人', value: 'INDIVIDUAL' },
    ],
  },
]

const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`)
const mobileDrawerTitle = computed(() => mobileActionTarget.value === null
  ? '供应商操作'
  : `供应商操作 · ${mobileActionTarget.value.legalName}`)

function currentSort(): {
  sortBy: 'code' | 'legalName' | 'updatedAt'
  sortOrder: 'asc' | 'desc'
} {
  const selected = sorting.value[0]
  const sortBy = selected?.id === 'code' || selected?.id === 'legalName'
    ? selected.id
    : 'updatedAt'
  return { sortBy, sortOrder: selected?.desc === false ? 'asc' : 'desc' }
}

function listResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplySupplierQueryResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: listRequestVersion,
    requestVersion,
  })
}

async function loadSuppliers(): Promise<void> {
  if (disposed || !canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  listLoading.value = true
  listError.value = ''
  listRequestId.value = undefined

  try {
    const response = await suppliersApi.list(buildSupplierListQuery({
      entityType: filters.value.entityType,
      page: page.value,
      pageSize: pageSize.value,
      query: search.value,
      ...currentSort(),
      status: filters.value.status,
    }), controller.signal)
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }
    rows.value = response.data.items
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (
      isSupplierAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getSupplierApiFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      listLoading.value = false
    }
  }
}

function scheduleListRefresh(): void {
  page.value = 1
  if (listRefreshQueued) {
    return
  }
  listRefreshQueued = true
  queueMicrotask(() => {
    listRefreshQueued = false
    void loadSuppliers()
  })
}

function handlePaginationChange(): void {
  void loadSuppliers()
}

function supplierActions(supplier: SupplierListItemDto) {
  return resolveSupplierActions(supplier, {
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canRead: canRead.value,
    canUpdate: canUpdate.value,
  })
}

function resetFormFailure(): void {
  formError.value = ''
  formRequestId.value = undefined
  formFieldErrors.value = {}
}

function resetStatusFailure(): void {
  statusError.value = ''
  statusRequestId.value = undefined
}

function detailResponseIsCurrent(
  supplierId: string,
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return detailTargetId.value === supplierId
    && canApplySupplierQueryResponse({
      aborted: controller.signal.aborted,
      authorized: canRead.value,
      authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      latestRequestVersion: detailRequestVersion,
      requestVersion,
    })
}

async function fetchSupplierDetail(
  supplierId: string,
): Promise<SupplierDto | null> {
  if (!canRead.value) {
    return null
  }
  detailAbortController?.abort()
  const controller = new AbortController()
  detailAbortController = controller
  detailTargetId.value = supplierId
  const requestVersion = ++detailRequestVersion
  const authEpoch = appAccountStore.authEpoch
  detailLoading.value = true
  detailError.value = ''
  detailRequestId.value = undefined

  try {
    const response = await suppliersApi.get(supplierId, controller.signal)
    if (!detailResponseIsCurrent(
      supplierId,
      requestVersion,
      authEpoch,
      controller,
    )) {
      return null
    }
    detail.value = response.data
    return response.data
  }
  catch (error) {
    if (
      isSupplierAbortError(error)
      || !detailResponseIsCurrent(
        supplierId,
        requestVersion,
        authEpoch,
        controller,
      )
    ) {
      return null
    }
    const failure = getSupplierApiFailure(error)
    detailError.value = failure.message
    detailRequestId.value = failure.requestId
    return null
  }
  finally {
    if (requestVersion === detailRequestVersion) {
      detailLoading.value = false
    }
  }
}

function openCreate(): void {
  if (!canRead.value || !canCreate.value) {
    return
  }
  formMode.value = 'create'
  formTarget.value = null
  formLoading.value = false
  createIntent.value = null
  resetFormFailure()
  formVisible.value = true
}

async function openDetail(supplier: SupplierListItemDto): Promise<void> {
  if (!canRead.value) {
    return
  }
  detail.value = null
  detailTargetId.value = supplier.id
  detailVisible.value = true
  await fetchSupplierDetail(supplier.id)
}

async function openEdit(supplier: SupplierListItemDto): Promise<void> {
  if (!supplierActions(supplier).canEdit) {
    return
  }
  formMode.value = 'edit'
  formTarget.value = null
  formLoading.value = true
  resetFormFailure()
  formVisible.value = true
  const loaded = await fetchSupplierDetail(supplier.id)
  if (formVisible.value && canUpdate.value) {
    formTarget.value = loaded
    if (loaded === null) {
      formError.value = detailError.value || '供应商详情加载失败，请关闭后重试'
      formRequestId.value = detailRequestId.value
    }
  }
  formLoading.value = false
}

async function openStatus(
  supplier: SupplierListItemDto,
  action: SupplierStatusAction,
): Promise<void> {
  const actions = supplierActions(supplier)
  if (
    (action === 'enable' && !actions.canEnable)
    || (action === 'disable' && !actions.canDisable)
  ) {
    return
  }
  const loaded = await fetchSupplierDetail(supplier.id)
  if (loaded === null) {
    if (detailError.value !== '') {
      toast.error(detailError.value)
    }
    return
  }
  statusAction.value = action
  statusTarget.value = loaded
  resetStatusFailure()
  statusVisible.value = true
}

function mutationResultIsCurrent(
  generation: number,
  targetId: string,
  authEpoch: number,
  authorized: boolean,
): boolean {
  return canApplySupplierMutationResult({
    authorized,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    currentGeneration: mutationGeneration,
    currentTargetId: currentMutationTargetId,
    generation,
    targetId,
  })
}

async function finishFormSuccess(message: string): Promise<void> {
  formSubmitting.value = false
  createIntent.value = null
  await nextTick()
  formDrawerRef.value?.closeWithoutDirtyGuard()
  toast.success(message)
  await loadSuppliers()
}

async function executeCreateIntent(intent: SupplierCreateIntent): Promise<void> {
  if (formSubmitting.value || !canRead.value || !canCreate.value) {
    return
  }
  const targetId = intent.idempotencyKey
  const generation = ++mutationGeneration
  currentMutationTargetId = targetId
  const authEpoch = appAccountStore.authEpoch
  formSubmitting.value = true
  resetFormFailure()

  try {
    await suppliersApi.create(
      intent.payload as CreateSupplierRequestDto,
      intent.idempotencyKey,
    )
    if (!mutationResultIsCurrent(
      generation,
      targetId,
      authEpoch,
      canRead.value && canCreate.value,
    )) {
      return
    }
    page.value = 1
    await finishFormSuccess('供应商停用草稿已创建')
  }
  catch (error) {
    if (!mutationResultIsCurrent(
      generation,
      targetId,
      authEpoch,
      canRead.value && canCreate.value,
    )) {
      return
    }
    const failure = getSupplierMutationFailure(error, 'create')
    formRequestId.value = failure.requestId
    formFieldErrors.value = failure.fieldErrors
    if (failure.unknownResult) {
      createIntent.value = markSupplierCreateIntentUnknown(intent)
      formError.value = '创建结果未知，请点击“使用原请求确认结果”；系统不会自动重放。'
    }
    else {
      createIntent.value = null
      formError.value = failure.message
    }
  }
  finally {
    if (generation === mutationGeneration) {
      formSubmitting.value = false
    }
  }
}

async function retryUnknownCreate(): Promise<void> {
  const intent = createIntent.value
  if (intent === null || intent.state !== 'unknown') {
    return
  }
  const retry = retrySupplierCreateIntent(intent)
  await executeCreateIntent({
    idempotencyKey: retry.idempotencyKey,
    payload: retry.payload,
    state: 'unknown',
  })
}

async function executeUpdate(
  supplierId: string,
  value: UpdateSupplierRequestDto,
): Promise<void> {
  if (formSubmitting.value || !canRead.value || !canUpdate.value) {
    return
  }
  const generation = ++mutationGeneration
  currentMutationTargetId = supplierId
  const authEpoch = appAccountStore.authEpoch
  formSubmitting.value = true
  resetFormFailure()
  try {
    await suppliersApi.update(supplierId, value)
    if (!mutationResultIsCurrent(
      generation,
      supplierId,
      authEpoch,
      canRead.value && canUpdate.value,
    )) {
      return
    }
    await finishFormSuccess('供应商资料已更新')
  }
  catch (error) {
    if (!mutationResultIsCurrent(
      generation,
      supplierId,
      authEpoch,
      canRead.value && canUpdate.value,
    )) {
      return
    }
    const failure = getSupplierMutationFailure(error, 'update')
    formError.value = failure.message
    formRequestId.value = failure.requestId
    formFieldErrors.value = failure.fieldErrors
    if (failure.unknownResult || failure.requiresRefresh) {
      const refreshed = await fetchSupplierDetail(supplierId)
      if (formVisible.value) {
        formTarget.value = refreshed
      }
    }
  }
  finally {
    if (generation === mutationGeneration) {
      formSubmitting.value = false
    }
  }
}

async function handleFormSubmit(submission: FormSubmission): Promise<void> {
  if (submission.mode === 'create') {
    const intent = createSupplierCreateIntentFromPayload(submission.value)
    createIntent.value = intent
    await executeCreateIntent(intent)
    return
  }
  await executeUpdate(submission.supplierId, submission.value)
}

async function handleStatusConfirm(request: {
  action: SupplierStatusAction
  expectedVersion: number
  supplierId: string
}): Promise<void> {
  const authorized = request.action === 'enable' ? canEnable.value : canDisable.value
  if (statusSubmitting.value || !canRead.value || !authorized) {
    return
  }
  const generation = ++mutationGeneration
  currentMutationTargetId = request.supplierId
  const authEpoch = appAccountStore.authEpoch
  statusSubmitting.value = true
  resetStatusFailure()
  try {
    if (request.action === 'enable') {
      await suppliersApi.enable(request.supplierId, {
        expectedVersion: request.expectedVersion,
      })
    }
    else {
      await suppliersApi.disable(request.supplierId, {
        expectedVersion: request.expectedVersion,
      })
    }
    if (!mutationResultIsCurrent(
      generation,
      request.supplierId,
      authEpoch,
      canRead.value && (request.action === 'enable'
        ? canEnable.value
        : canDisable.value),
    )) {
      return
    }
    statusSubmitting.value = false
    statusVisible.value = false
    statusTarget.value = null
    toast.success(request.action === 'enable' ? '供应商已启用' : '供应商已停用')
    await loadSuppliers()
  }
  catch (error) {
    if (!mutationResultIsCurrent(
      generation,
      request.supplierId,
      authEpoch,
      canRead.value && (request.action === 'enable'
        ? canEnable.value
        : canDisable.value),
    )) {
      return
    }
    const failure = getSupplierMutationFailure(error, 'status')
    statusError.value = failure.message
    statusRequestId.value = failure.requestId
    if (failure.unknownResult || failure.requiresRefresh) {
      statusTarget.value = await fetchSupplierDetail(request.supplierId)
    }
  }
  finally {
    if (generation === mutationGeneration) {
      statusSubmitting.value = false
    }
  }
}

function closeMobileActions(): void {
  pendingMobileAction.value = null
  mobileActionsVisible.value = false
}

function openMobileActions(supplier: SupplierListItemDto): void {
  mobileActionTarget.value = supplier
  mobileActionsVisible.value = true
}

function performRowAction(
  supplier: SupplierListItemDto,
  action: SupplierRowAction,
): void {
  if (action === 'detail') {
    void openDetail(supplier)
  }
  else if (action === 'edit') {
    void openEdit(supplier)
  }
  else { void openStatus(supplier, action) }
}

function requestRowAction(
  supplier: SupplierListItemDto,
  action: SupplierRowAction,
): void {
  if (mobileActionsVisible.value) {
    pendingMobileAction.value = { action, supplier }
    mobileActionsVisible.value = false
    return
  }
  performRowAction(supplier, action)
}

async function handleMobileActionsClosed(): Promise<void> {
  mobileActionTarget.value = null
  const pending = pendingMobileAction.value
  pendingMobileAction.value = null
  if (pending !== null && canRead.value) {
    await nextTick()
    await nextTick()
    performRowAction(pending.supplier, pending.action)
  }
}

function handleDetailAction(
  action: SupplierStatusAction | 'edit',
  selected: SupplierDto,
): void {
  pendingDetailAction.value = { action, supplier: selected }
  detailVisible.value = false
}

async function handleDetailClosed(): Promise<void> {
  if (!detailVisible.value) {
    detail.value = null
    detailTargetId.value = null
  }
  const pending = pendingDetailAction.value
  pendingDetailAction.value = null
  if (pending === null || !canRead.value) {
    return
  }
  // 等待详情 Drawer 完成焦点恢复，再打开下一个维护上下文，避免两个焦点锁重叠。
  await nextTick()
  await nextTick()
  if (pending.action === 'edit') {
    if (!canUpdate.value) {
      return
    }
    formMode.value = 'edit'
    formTarget.value = pending.supplier
    resetFormFailure()
    formVisible.value = true
    return
  }
  const authorized = pending.action === 'enable'
    ? canEnable.value
    : canDisable.value
  if (!authorized) {
    return
  }
  statusAction.value = pending.action
  statusTarget.value = pending.supplier
  resetStatusFailure()
  statusVisible.value = true
}

function requestDiscardConfirmation(): void {
  if (!createResultUnknown.value) {
    discardConfirmVisible.value = true
  }
}

async function discardFormChanges(): Promise<void> {
  discardConfirmVisible.value = false
  createIntent.value = null
  await nextTick()
  formDrawerRef.value?.closeWithoutDirtyGuard()
}

function handleFormClosed(): void {
  if (!formVisible.value) {
    formTarget.value = null
    createIntent.value = null
    resetFormFailure()
  }
}

function clearListContext(): void {
  rows.value = []
  total.value = 0
  listLoading.value = false
  listError.value = ''
  listRequestId.value = undefined
}

function clearProtectedContexts(): void {
  mutationGeneration += 1
  currentMutationTargetId = null
  listAbortController?.abort()
  detailAbortController?.abort()
  listRequestVersion += 1
  detailRequestVersion += 1
  closeMobileActions()
  if (formVisible.value) {
    formDrawerRef.value?.closeForAuthorityLoss()
  }
  formVisible.value = false
  formTarget.value = null
  formSubmitting.value = false
  createIntent.value = null
  detailVisible.value = false
  detail.value = null
  detailTargetId.value = null
  pendingDetailAction.value = null
  statusVisible.value = false
  statusTarget.value = null
  statusSubmitting.value = false
  discardConfirmVisible.value = false
  resetFormFailure()
  resetStatusFailure()
}

function statusClass(supplier: SupplierListItemDto): string {
  return supplier.enabled
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-border bg-muted text-muted-foreground'
}

function entityTypeLabel(entityType: SupplierListItemDto['entityType']): string {
  return entityType === 'ORGANIZATION' ? '企业/组织' : '个人'
}

function regionLabel(supplier: SupplierListItemDto): string {
  return supplier.primaryAddressRegionPath.map(region => region.name).join(' ')
    || '未填写'
}

function contactChannelLabel(supplier: SupplierListItemDto): string {
  if (supplier.hasPrimaryContactPhone && supplier.hasPrimaryContactWechatId) {
    return '电话、微信'
  }
  if (supplier.hasPrimaryContactPhone) {
    return '电话'
  }
  if (supplier.hasPrimaryContactWechatId) {
    return '微信'
  }
  return '无联系方式'
}

watch(
  () => ({
    authEpoch: appAccountStore.authEpoch,
    canCreate: canCreate.value,
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canRead: canRead.value,
    canUpdate: canUpdate.value,
  }),
  (next, previous) => {
    const identityChanged = next.authEpoch !== previous.authEpoch
    if (identityChanged || !next.canRead) {
      clearListContext()
      clearProtectedContexts()
      if (next.canRead) {
        page.value = 1
        void loadSuppliers()
      }
      return
    }
    if (
      formVisible.value
      && ((formMode.value === 'create' && !next.canCreate)
        || (formMode.value === 'edit' && !next.canUpdate))
    ) {
      formDrawerRef.value?.closeForAuthorityLoss()
      formVisible.value = false
      createIntent.value = null
    }
    if (
      statusVisible.value
      && ((statusAction.value === 'enable' && !next.canEnable)
        || (statusAction.value === 'disable' && !next.canDisable))
    ) {
      statusVisible.value = false
      statusTarget.value = null
      mutationGeneration += 1
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadSuppliers()
  }
})

onBeforeUnmount(() => {
  disposed = true
  listAbortController?.abort()
  detailAbortController?.abort()
  mutationGeneration += 1
})
</script>

<template>
  <div class="supplier-management-page min-w-0" data-testid="supplier-management-page">
    <FaPageHeader description="维护供应商主体、登记、主要联系人、主要地址、状态与备注；Supplier Code 由现有 SUPPLIER 规则自动生成。">
      <template #title>
        <h1 class="m-0">
          供应商管理
        </h1>
      </template>
      <FaButton
        v-if="canRead && canCreate"
        data-testid="supplier-create"
        class="min-h-11 md:min-h-9"
        @click="openCreate"
      >
        <FaIcon name="i-lucide:plus" />
        新建供应商
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权查看供应商"
        description="当前身份缺少 suppliers:read 权限。"
        class="min-h-64"
      />

      <section v-else class="min-w-0" aria-label="供应商列表">
        <p class="qs-type-description mb-4 mt-0 max-w-3xl">
          列表只展示联系渠道与地区摘要；完整登记号、电话、微信号、详细地址和备注仅在详情中读取。
        </p>

        <QsGenericTable
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:search="search"
          v-model:filters="filters"
          v-model:sorting="sorting"
          data-testid="supplier-table"
          row-key="id"
          :addable="false"
          :action-column="{ align: 'right', title: '操作', width: 230 }"
          :columns="columns"
          :data="rows"
          empty-title="暂无供应商"
          empty-description="当前查询条件下没有可展示的供应商。"
          :error="listErrorDisplay"
          :filter-definitions="filterDefinitions"
          :loading="listLoading"
          :page-size-options="[20, 50, 100]"
          search-placeholder="搜索名称、Code、登记号、电话或微信号"
          :total="total"
          table-class="min-w-[1260px]"
          @filter-change="scheduleListRefresh"
          @pagination-change="handlePaginationChange"
          @retry="loadSuppliers"
          @search="scheduleListRefresh"
          @sorting-change="scheduleListRefresh"
        >
          <template #cell-supplier="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <strong class="qs-type-body-medium break-words">
                {{ row.original.legalName }}
              </strong>
              <div class="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
                <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
                  {{ row.original.code }}
                </code>
                <span class="qs-type-meta break-words">
                  {{ row.original.shortName || '暂无简称' }}
                </span>
              </div>
            </div>
          </template>

          <template #cell-entityType="{ row }">
            <span class="qs-type-body">{{ entityTypeLabel(row.original.entityType) }}</span>
          </template>

          <template #cell-contact="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <span class="qs-type-body break-words">
                {{ row.original.primaryContactName || '未填写联系人' }}
              </span>
              <span class="qs-type-meta">{{ contactChannelLabel(row.original) }}</span>
            </div>
          </template>

          <template #cell-region="{ row }">
            <span class="qs-type-body break-words">{{ regionLabel(row.original) }}</span>
          </template>

          <template #cell-status="{ row }">
            <FaTag variant="outline" class="qs-type-status-tag" :class="statusClass(row.original)">
              {{ row.original.enabled ? '已启用' : '已停用' }}
            </FaTag>
          </template>

          <template #cell-updatedAt="{ row }">
            <DateTimeDisplay :value="row.original.updatedAt" />
          </template>

          <template #actions="{ row: supplier }">
            <FaButton
              v-if="isNarrow"
              class="min-h-11 w-full"
              variant="outline"
              size="sm"
              :aria-label="`供应商操作 · ${supplier.legalName}`"
              @click="openMobileActions(supplier)"
            >
              操作
            </FaButton>
            <div v-else class="flex gap-1 items-center justify-end">
              <FaButton
                variant="ghost"
                size="sm"
                :aria-label="`查看供应商 · ${supplier.legalName}`"
                @click="requestRowAction(supplier, 'detail')"
              >
                查看
              </FaButton>
              <FaButton
                v-if="supplierActions(supplier).canEdit"
                variant="ghost"
                size="sm"
                :aria-label="`编辑供应商 · ${supplier.legalName}`"
                @click="requestRowAction(supplier, 'edit')"
              >
                编辑
              </FaButton>
              <FaButton
                v-if="supplierActions(supplier).canEnable"
                variant="ghost"
                size="sm"
                :aria-label="`启用供应商 · ${supplier.legalName}`"
                @click="requestRowAction(supplier, 'enable')"
              >
                启用
              </FaButton>
              <FaButton
                v-if="supplierActions(supplier).canDisable"
                variant="ghost"
                size="sm"
                class="text-destructive"
                :aria-label="`停用供应商 · ${supplier.legalName}`"
                @click="requestRowAction(supplier, 'disable')"
              >
                停用
              </FaButton>
            </div>
          </template>

          <template #mobile-row="{ columns: visibleColumns, row: supplier, rowNumber }">
            <div data-testid="supplier-mobile-row" class="gap-4 grid min-w-0">
              <div class="flex gap-3 min-w-0 items-start justify-between">
                <div v-if="hasVisibleTableColumn(visibleColumns, 'supplier')" class="min-w-0">
                  <strong class="qs-type-body-medium block break-words">
                    {{ supplier.legalName }}
                  </strong>
                  <code class="qs-type-data-emphasis block [overflow-wrap:anywhere]">
                    {{ supplier.code }}
                  </code>
                  <span v-if="supplier.shortName" class="qs-type-meta mt-1 block break-words">
                    {{ supplier.shortName }}
                  </span>
                </div>
                <div class="flex shrink-0 flex-col gap-1 items-end">
                  <FaTag
                    v-if="hasVisibleTableColumn(visibleColumns, 'status')"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="statusClass(supplier)"
                  >
                    {{ supplier.enabled ? '已启用' : '已停用' }}
                  </FaTag>
                  <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                </div>
              </div>

              <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[390px]:grid-cols-1">
                <div v-if="hasVisibleTableColumn(visibleColumns, 'entityType')">
                  <dt class="qs-type-compact-label mb-1">
                    主体类型
                  </dt>
                  <dd class="qs-type-body m-0">
                    {{ entityTypeLabel(supplier.entityType) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'contact')">
                  <dt class="qs-type-compact-label mb-1">
                    主要联系人
                  </dt>
                  <dd class="qs-type-body m-0 break-words">
                    {{ supplier.primaryContactName || '未填写' }} · {{ contactChannelLabel(supplier) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'region')">
                  <dt class="qs-type-compact-label mb-1">
                    主要地区
                  </dt>
                  <dd class="qs-type-body m-0 break-words">
                    {{ regionLabel(supplier) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')">
                  <dt class="qs-type-compact-label mb-1">
                    更新时间
                  </dt>
                  <dd class="m-0">
                    <DateTimeDisplay :value="supplier.updatedAt" />
                  </dd>
                </div>
              </dl>
            </div>
          </template>
        </QsGenericTable>
      </section>
    </FaPageMain>

    <FaDrawer
      v-model="mobileActionsVisible"
      :title="mobileDrawerTitle"
      side="bottom"
      :footer="false"
      content-class="h-[min(26rem,calc(100dvh-1.5rem))]"
      destroy-on-close
      @closed="handleMobileActionsClosed"
    >
      <div
        v-if="mobileActionTarget"
        data-testid="supplier-actions-drawer"
        class="pb-[max(0.75rem,env(safe-area-inset-bottom))] gap-3 grid"
      >
        <FaButton class="min-h-11 w-full" variant="outline" @click="requestRowAction(mobileActionTarget, 'detail')">
          查看详情
        </FaButton>
        <FaButton
          v-if="supplierActions(mobileActionTarget).canEdit"
          class="min-h-11 w-full"
          variant="outline"
          @click="requestRowAction(mobileActionTarget, 'edit')"
        >
          编辑资料
        </FaButton>
        <FaButton
          v-if="supplierActions(mobileActionTarget).canEnable"
          class="min-h-11 w-full"
          @click="requestRowAction(mobileActionTarget, 'enable')"
        >
          启用供应商
        </FaButton>
        <FaButton
          v-if="supplierActions(mobileActionTarget).canDisable"
          class="min-h-11 w-full"
          variant="destructive"
          @click="requestRowAction(mobileActionTarget, 'disable')"
        >
          停用供应商
        </FaButton>
      </div>
    </FaDrawer>

    <SupplierFormDrawer
      ref="formDrawerRef"
      v-model="formVisible"
      :mode="formMode"
      :supplier="formTarget"
      :loading="formLoading"
      :submitting="formSubmitting"
      :create-result-unknown="createResultUnknown"
      :error="formError"
      :request-id="formRequestId"
      :field-errors="formFieldErrors"
      @submit="handleFormSubmit"
      @retry-create="retryUnknownCreate"
      @close-request="requestDiscardConfirmation"
      @closed="handleFormClosed"
    />

    <SupplierDetailDrawer
      v-model="detailVisible"
      :detail="detail"
      :loading="detailLoading"
      :error="detailError"
      :request-id="detailRequestId"
      :allow-edit="canUpdate"
      :allow-enable="canEnable && detail?.enabled === false"
      :allow-disable="canDisable && detail?.enabled === true"
      @reload="detailTargetId && fetchSupplierDetail(detailTargetId)"
      @action="handleDetailAction"
      @closed="handleDetailClosed"
    />

    <SupplierStatusChangeModal
      v-model="statusVisible"
      :action="statusAction"
      :supplier="statusTarget"
      :submitting="statusSubmitting"
      :error="statusError"
      :request-id="statusRequestId"
      @confirm="handleStatusConfirm"
    />

    <QsGenericModal
      v-model="discardConfirmVisible"
      title="放弃未保存修改？"
      description="当前供应商资料尚未保存，关闭后本次编辑内容将丢失。"
      size="sm"
      data-testid="supplier-discard-confirm"
    >
      <FaAlert
        icon="i-lucide:triangle-alert"
        title="未保存修改"
        description="此操作只放弃当前表单，不会修改 Server 中的供应商资料。"
      />
      <template #footer>
        <FaButton
          variant="outline"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          @click="discardConfirmVisible = false"
        >
          继续编辑
        </FaButton>
        <FaButton
          variant="destructive"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          @click="discardFormChanges"
        >
          放弃修改
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .supplier-management-page :deep(.animate-pulse) {
    animation: none !important;
  }
}
</style>
