<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type {
  DictionaryStatusChangeRequest,
  DictionaryTypeStatusAction,
} from './dictionary-status.logic'
import type {
  CreateDictionaryItemRequestDto,
  CreateDictionaryTypeRequestDto,
  DictionaryItemDto,
  DictionaryTypeDto,
  UpdateDictionaryItemRequestDto,
  UpdateDictionaryTypeRequestDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import dictionariesApi from '@/api/modules/dictionaries'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { invalidateDictionaryCatalogCache } from '@/dictionary-catalog/default-provider'
import DictionaryItemFormModal from './dictionary-item-form-modal.vue'
import {
  findMatchingCreatedDictionaryItem,
  matchesDictionaryItemUpdateResult,
} from './dictionary-item-form.logic'
import DictionaryItemTable from './dictionary-item-table.vue'
import {
  buildDictionaryItemListQuery,
  buildDictionaryTypeListQuery,
  canApplyDictionaryItemResponse,
  canApplyDictionaryMutationResult,
  canApplyDictionaryQueryResponse,
  createDictionaryItemQueryRefreshScheduler,
  createDictionaryManagementState,
  createDictionarySelection,
  isDictionaryAbortError,
  resolveDictionaryAccessTransition,
  resolveDictionaryItemResponsePage,
  resolveDictionaryTypeEmptyKind,
  resolveDictionaryTypeResponsePage,
  resolveDictionaryTypeSelection,
  transitionDictionaryMutationState,
  transitionDictionaryQueryState,
} from './dictionary-management.logic'
import DictionaryStatusChangeModal from './dictionary-status-change-modal.vue'
import {
  buildDictionaryTypeCreateReconciliationQuery,
  findMatchingCreatedDictionaryType,
  getDictionaryItemMutationFailure,
  getDictionaryTypeMutationFailure,
  matchesDictionaryItemStatus,
  matchesDictionaryTypeStatus,
  matchesDictionaryTypeUpdate,
  resolveDictionaryItemActions,
  resolveDictionaryTypeActions,
} from './dictionary-status.logic'
import DictionaryTypeFormModal from './dictionary-type-form-modal.vue'
import DictionaryTypeList from './dictionary-type-list.vue'

defineOptions({ name: 'SystemBasicDataDictionaries' })

const appAccountStore = useAppAccountStore()
const { auth } = useAppAuth()
const toast = useQsToast()
const canRead = computed(() => auth('dictionaries:read'))
const canCreate = computed(() => auth('dictionaries:create'))
const canUpdate = computed(() => auth('dictionaries:update'))
const canEnable = computed(() => auth('dictionaries:enable'))
const canDisable = computed(() => auth('dictionaries:disable'))

const managementState = ref(createDictionaryManagementState(canRead.value))
const dictionaryTypes = ref<DictionaryTypeDto[]>([])
const dictionaryItems = ref<DictionaryItemDto[]>([])
const typeTotal = ref(0)
const itemTotal = ref(0)
const typeError = ref('')
const itemError = ref('')
const typeDrawerOpen = ref(false)
const typePage = ref(1)
const typePageSize = ref(20)
const typeSearch = ref('')
const typeStatus = ref<'DISABLED' | 'ENABLED'>()
const itemPage = ref(1)
const itemPageSize = ref(20)
const itemSearch = ref('')
const itemFilters = ref<QsGenericTableFilterValues>({})
const itemSorting = ref<TableSortingState>([
  { id: 'sortOrder', desc: false },
])

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formTarget = ref<DictionaryTypeDto | null>(null)
const formSubmitting = ref(false)
const formError = ref<string | null>(null)
const formRequestId = ref<string | null>(null)
const formFieldErrors = ref<Readonly<Record<string, string>>>({})

const itemFormVisible = ref(false)
const itemFormMode = ref<'create' | 'edit'>('create')
const itemFormTarget = ref<DictionaryItemDto | null>(null)
const itemFormSubmitting = ref(false)
const itemFormError = ref<string | null>(null)
const itemFormRequestId = ref<string | null>(null)
const itemFormFieldErrors = ref<Readonly<Record<string, string>>>({})

const statusVisible = ref(false)
const statusAction = ref<DictionaryTypeStatusAction>('disable')
const statusTarget = ref<DictionaryTypeDto | null>(null)
const statusTargetKind = ref<'item' | 'type'>('type')
const statusItemTarget = ref<DictionaryItemDto | null>(null)
const statusSubmitting = ref(false)
const statusError = ref<string | null>(null)
const statusErrorCode = ref<string>()
const statusRequestId = ref<string>()

let typeAbortController: AbortController | null = null
let itemAbortController: AbortController | null = null
let reconciliationAbortController: AbortController | null = null
let typeRequestVersion = 0
let itemRequestVersion = 0
let mutationVersion = 0
let mutationTargetKey: string | null = null
let disposed = false

type DictionaryTypeMutationKind = 'create' | 'disable' | 'enable' | 'update'

interface DictionaryTypeMutationContext {
  readonly authEpoch: number
  readonly kind: DictionaryTypeMutationKind
  readonly targetKey: string
  readonly version: number
}

type DictionaryTypeFormSubmission
  = | {
    readonly data: CreateDictionaryTypeRequestDto
    readonly mode: 'create'
  }
  | {
    readonly data: UpdateDictionaryTypeRequestDto
    readonly mode: 'edit'
    readonly typeId: string
  }

type DictionaryItemFormSubmission
  = | {
    readonly data: CreateDictionaryItemRequestDto
    readonly mode: 'create'
    readonly typeId: string
  }
  | {
    readonly data: UpdateDictionaryItemRequestDto
    readonly itemId: string
    readonly mode: 'edit'
    readonly typeId: string
  }

const selectedTypeId = computed(() => {
  return managementState.value.selection.kind === 'selected'
    ? managementState.value.selection.typeId
    : null
})
const selectedType = computed(() => {
  return dictionaryTypes.value.find(type => type.id === selectedTypeId.value) ?? null
})
const itemQueryScheduler = createDictionaryItemQueryRefreshScheduler(() => {
  const typeId = selectedTypeId.value
  if (!disposed && typeId !== null) {
    void loadDictionaryItems(typeId)
  }
})
const typeBusy = computed(() => {
  return managementState.value.typeQuery === 'loading'
    || managementState.value.typeQuery === 'refreshing'
})
const itemBusy = computed(() => {
  return managementState.value.itemQuery === 'loading'
    || managementState.value.itemQuery === 'refreshing'
})
const typeEmptyKind = computed(() => resolveDictionaryTypeEmptyKind({
  search: typeSearch.value,
  status: typeStatus.value,
}))
const selectedTypeActions = computed(() => selectedType.value === null
  ? null
  : resolveDictionaryTypeActions(selectedType.value, {
      canDisable: canDisable.value,
      canEnable: canEnable.value,
      canUpdate: canUpdate.value,
    }))

function dictionaryItemActions(item: DictionaryItemDto) {
  const type = selectedType.value
  if (type === null) {
    return null
  }
  return resolveDictionaryItemActions(item, type, {
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canUpdate: canUpdate.value,
  })
}

function mutationOverlayIsOpen(): boolean {
  return formVisible.value || itemFormVisible.value || statusVisible.value
}

function setTypeQuery(event: Parameters<typeof transitionDictionaryQueryState>[1]): void {
  managementState.value = {
    ...managementState.value,
    typeQuery: transitionDictionaryQueryState(
      managementState.value.typeQuery,
      event,
    ),
  }
}

function setItemQuery(event: Parameters<typeof transitionDictionaryQueryState>[1]): void {
  managementState.value = {
    ...managementState.value,
    itemQuery: transitionDictionaryQueryState(
      managementState.value.itemQuery,
      event,
    ),
  }
}

function setMutation(
  event: Parameters<typeof transitionDictionaryMutationState>[1],
): void {
  managementState.value = {
    ...managementState.value,
    mutation: transitionDictionaryMutationState(
      managementState.value.mutation,
      event,
    ),
  }
}

function mutationPermissionIsCurrent(kind: DictionaryTypeMutationKind): boolean {
  if (!canRead.value) {
    return false
  }
  switch (kind) {
    case 'create':
      return canCreate.value
    case 'update':
      return canUpdate.value
    case 'enable':
      return canEnable.value
    case 'disable':
      return canDisable.value
    default:
      return false
  }
}

function mutationResultIsCurrent(input: {
  readonly authEpoch: number
  readonly kind: DictionaryTypeMutationKind
  readonly targetKey: string
  readonly version: number
}): boolean {
  return !disposed && canApplyDictionaryMutationResult({
    authorized: mutationPermissionIsCurrent(input.kind),
    authEpoch: input.authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    currentTargetId: mutationTargetKey,
    latestMutationVersion: mutationVersion,
    mutationVersion: input.version,
    targetId: input.targetKey,
  })
}

function abortReconciliation(): void {
  reconciliationAbortController?.abort()
  reconciliationAbortController = null
}

function resetFormFailure(): void {
  formError.value = null
  formRequestId.value = null
  formFieldErrors.value = {}
}

function resetItemFormFailure(): void {
  itemFormError.value = null
  itemFormRequestId.value = null
  itemFormFieldErrors.value = {}
}

function resetStatusFailure(): void {
  statusError.value = null
  statusErrorCode.value = undefined
  statusRequestId.value = undefined
}

/**
 * Mutation 请求本身没有安全的取消语义。关闭浮层时只作废回写所有权，并取消
 * reconciliation GET；已经发出的写请求仍由 Server 决定最终结果。
 */
function invalidateMutationContext(
  event: 'authority-loss' | 'cancel',
): void {
  mutationVersion += 1
  mutationTargetKey = null
  abortReconciliation()
  setMutation(event)
}

function beginMutationOverlay(targetKey: string): void {
  mutationVersion += 1
  mutationTargetKey = targetKey
  abortReconciliation()
  setMutation('open')
}

function beginMutationRequest(
  kind: DictionaryTypeMutationKind,
  targetKey: string,
): DictionaryTypeMutationContext | null {
  if (
    managementState.value.mutation !== 'editing'
    || !mutationPermissionIsCurrent(kind)
  ) {
    return null
  }

  mutationVersion += 1
  mutationTargetKey = targetKey
  abortReconciliation()
  setMutation('submit')
  return {
    authEpoch: appAccountStore.authEpoch,
    kind,
    targetKey,
    version: mutationVersion,
  }
}

function replaceDictionaryTypeSnapshot(type: DictionaryTypeDto): void {
  dictionaryTypes.value = dictionaryTypes.value.map(current =>
    current.id === type.id ? type : current)
  if (formTarget.value?.id === type.id) {
    formTarget.value = type
  }
  if (statusTarget.value?.id === type.id) {
    statusTarget.value = type
  }
}

function replaceDictionaryItemSnapshot(item: DictionaryItemDto): void {
  const itemIndex = dictionaryItems.value.findIndex(current =>
    current.id === item.id)
  if (itemIndex === -1) {
    dictionaryItems.value = [...dictionaryItems.value, item]
  }
  else {
    dictionaryItems.value = dictionaryItems.value.map(current =>
      current.id === item.id ? item : current)
  }
  if (itemFormTarget.value?.id === item.id) {
    itemFormTarget.value = item
  }
  if (statusItemTarget.value?.id === item.id) {
    statusItemTarget.value = item
  }
}

function dictionaryTypeActions(type: DictionaryTypeDto) {
  return resolveDictionaryTypeActions(type, {
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canUpdate: canUpdate.value,
  })
}

function openCreateType(): void {
  if (
    !canRead.value
    || !canCreate.value
    || mutationOverlayIsOpen()
  ) {
    return
  }
  formMode.value = 'create'
  formTarget.value = null
  resetFormFailure()
  beginMutationOverlay('create:new')
  formVisible.value = true
}

function openEditType(type: DictionaryTypeDto): void {
  if (
    !canRead.value
    || !dictionaryTypeActions(type).canEdit
    || mutationOverlayIsOpen()
  ) {
    return
  }
  formMode.value = 'edit'
  formTarget.value = type
  resetFormFailure()
  beginMutationOverlay(`update:${type.id}`)
  formVisible.value = true
}

function openTypeStatusChange(
  type: DictionaryTypeDto,
  action: DictionaryTypeStatusAction,
): void {
  const actions = dictionaryTypeActions(type)
  if (
    !canRead.value
    || (action === 'enable' && !actions.canEnable)
    || (action === 'disable' && !actions.canDisable)
    || mutationOverlayIsOpen()
  ) {
    return
  }
  statusAction.value = action
  statusTargetKind.value = 'type'
  statusTarget.value = type
  statusItemTarget.value = null
  resetStatusFailure()
  beginMutationOverlay(`${action}:${type.id}`)
  statusVisible.value = true
}

function openCreateItem(): void {
  const type = selectedType.value
  if (
    !canRead.value
    || !canCreate.value
    || type === null
    || mutationOverlayIsOpen()
  ) {
    return
  }
  itemFormMode.value = 'create'
  itemFormTarget.value = null
  resetItemFormFailure()
  beginMutationOverlay(`item:create:${type.id}`)
  itemFormVisible.value = true
}

function openEditItem(item: DictionaryItemDto): void {
  const type = selectedType.value
  const actions = dictionaryItemActions(item)
  if (
    !canRead.value
    || type === null
    || item.dictionaryTypeId !== type.id
    || actions?.canEdit !== true
    || mutationOverlayIsOpen()
  ) {
    return
  }
  itemFormMode.value = 'edit'
  itemFormTarget.value = item
  resetItemFormFailure()
  beginMutationOverlay(`item:update:${type.id}:${item.id}`)
  itemFormVisible.value = true
}

function openItemStatusChange(
  item: DictionaryItemDto,
  action: DictionaryTypeStatusAction,
): void {
  const type = selectedType.value
  const actions = dictionaryItemActions(item)
  if (
    !canRead.value
    || type === null
    || item.dictionaryTypeId !== type.id
    || (action === 'enable' && actions?.canEnable !== true)
    || (action === 'disable' && actions?.canDisable !== true)
    || mutationOverlayIsOpen()
  ) {
    return
  }
  statusAction.value = action
  statusTargetKind.value = 'item'
  statusTarget.value = type
  statusItemTarget.value = item
  resetStatusFailure()
  beginMutationOverlay(`item:${action}:${type.id}:${item.id}`)
  statusVisible.value = true
}

function cancelForm(): void {
  if (formSubmitting.value) {
    return
  }
  formVisible.value = false
  formTarget.value = null
  resetFormFailure()
  invalidateMutationContext('cancel')
}

function handleFormVisibilityChange(visible: boolean): void {
  if (!visible) {
    cancelForm()
  }
}

function cancelItemForm(): void {
  if (itemFormSubmitting.value) {
    return
  }
  itemFormVisible.value = false
  itemFormTarget.value = null
  resetItemFormFailure()
  invalidateMutationContext('cancel')
}

function handleItemFormVisibilityChange(visible: boolean): void {
  if (!visible) {
    cancelItemForm()
  }
}

function cancelStatusChange(): void {
  if (statusSubmitting.value) {
    return
  }
  statusVisible.value = false
  statusTarget.value = null
  statusItemTarget.value = null
  statusTargetKind.value = 'type'
  resetStatusFailure()
  invalidateMutationContext('cancel')
}

/**
 * 每种资源使用独立的 AbortController 和版本号。abort 后仍推进版本，确保即便底层
 * Promise 最终完成，旧 finally 也不能关闭新请求的 loading 或清空新 controller。
 */
function abortTypeQuery(): void {
  typeRequestVersion += 1
  typeAbortController?.abort()
  typeAbortController = null
}

function abortItemQuery(): void {
  itemRequestVersion += 1
  itemAbortController?.abort()
  itemAbortController = null
}

function abortProtectedQueries(): void {
  abortTypeQuery()
  abortItemQuery()
}

function typeResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return !disposed
    && typeAbortController === controller
    && canApplyDictionaryQueryResponse({
      aborted: controller.signal.aborted,
      authorized: canRead.value,
      authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      latestRequestVersion: typeRequestVersion,
      requestVersion,
    })
}

function itemResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  requestedTypeId: string,
  controller: AbortController,
): boolean {
  return !disposed
    && itemAbortController === controller
    && canApplyDictionaryItemResponse({
      aborted: controller.signal.aborted,
      authorized: canRead.value,
      authEpoch,
      currentAuthEpoch: appAccountStore.authEpoch,
      currentTypeId: selectedTypeId.value,
      latestRequestVersion: itemRequestVersion,
      requestedTypeId,
      requestVersion,
    })
}

async function loadDictionaryTypes(): Promise<void> {
  if (!canRead.value || disposed) {
    return
  }

  abortTypeQuery()
  const controller = new AbortController()
  typeAbortController = controller
  const requestVersion = typeRequestVersion
  const authEpoch = appAccountStore.authEpoch
  typeError.value = ''
  setTypeQuery({
    type: 'request',
    hasData: dictionaryTypes.value.length > 0,
  })

  try {
    const response = await dictionariesApi.types.list(
      buildDictionaryTypeListQuery({
        page: typePage.value,
        pageSize: typePageSize.value,
        search: typeSearch.value,
        status: typeStatus.value,
      }),
      controller.signal,
    )
    if (!typeResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    const resolvedPage = resolveDictionaryTypeResponsePage({
      itemCount: response.data.items.length,
      page: response.data.page,
      pageSize: response.data.pageSize,
      total: response.data.total,
    })
    if (resolvedPage !== response.data.page) {
      typePage.value = resolvedPage
      void loadDictionaryTypes()
      return
    }

    dictionaryTypes.value = response.data.items
    typePage.value = response.data.page
    typePageSize.value = response.data.pageSize
    typeTotal.value = response.data.total
    setTypeQuery({
      type: 'success',
      itemCount: response.data.items.length,
    })

    const nextSelection = resolveDictionaryTypeSelection(
      response.data.items,
      selectedTypeId.value,
    )
    const nextTypeId = nextSelection.kind === 'selected'
      ? nextSelection.typeId
      : null
    if (nextTypeId !== selectedTypeId.value) {
      selectDictionaryType(nextTypeId, false)
    }
    else {
      managementState.value = {
        ...managementState.value,
        selection: nextSelection,
      }
    }
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || !typeResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    typeError.value = '暂时无法读取字典类型，请稍后重试。'
    setTypeQuery({ type: 'failure' })
  }
  finally {
    if (
      typeAbortController === controller
      && requestVersion === typeRequestVersion
    ) {
      typeAbortController = null
    }
  }
}

function searchDictionaryTypes(search: string): void {
  typeSearch.value = search
  typePage.value = 1
  void loadDictionaryTypes()
}

function filterDictionaryTypes(
  status: 'DISABLED' | 'ENABLED' | undefined,
): void {
  typeStatus.value = status
  typePage.value = 1
  void loadDictionaryTypes()
}

function changeDictionaryTypePage(page: number): void {
  typePage.value = page
  void loadDictionaryTypes()
}

function changeDictionaryTypePageSize(pageSize: number): void {
  typePageSize.value = pageSize
  typePage.value = 1
  void loadDictionaryTypes()
}

const UNKNOWN_MUTATION_RESULT_MESSAGE
  = '操作结果未知，已停止自动处理。请关闭弹窗并刷新列表后人工确认，系统不会自动重放本次写入。'

async function reconcileUnknownTypeCreate(
  context: DictionaryTypeMutationContext,
  request: CreateDictionaryTypeRequestDto,
): Promise<DictionaryTypeDto | undefined> {
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await dictionariesApi.types.list(
      buildDictionaryTypeCreateReconciliationQuery(request.code),
      controller.signal,
    )
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return undefined
    }
    return findMatchingCreatedDictionaryType(response.data.items, request)
  }
  catch {
    return undefined
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
  }
}

/** edit/status 的网络未知结果只读取当前 Type；调用方再做精确最终状态匹配。 */
async function reconcileUnknownTypeMutation(
  context: DictionaryTypeMutationContext,
  typeId: string,
): Promise<DictionaryTypeDto | undefined> {
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await dictionariesApi.types.get(typeId, controller.signal)
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return undefined
    }
    return response.data
  }
  catch {
    return undefined
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
  }
}

async function refreshStateChangedType(
  context: DictionaryTypeMutationContext,
  typeId: string,
  surface: 'form' | 'status',
): Promise<void> {
  if (!mutationResultIsCurrent(context)) {
    return
  }
  setMutation('fail')
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller

  try {
    const response = await dictionariesApi.types.get(typeId, controller.signal)
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return
    }

    replaceDictionaryTypeSnapshot(response.data)
    setMutation('resume-editing')
    if (surface === 'form') {
      formError.value
        = '数据已被其他操作更新。未编辑字段已合并最新值；双方同时修改的字段已标记，请核对后重新提交。'
      formRequestId.value = null
      formFieldErrors.value = {}
    }
    else {
      statusError.value
        = '数据已被其他操作更新，已载入最新版本。请核对当前状态后重新提交。'
      statusErrorCode.value = 'DICTIONARY_TYPE_STATE_CHANGED'
      statusRequestId.value = undefined
    }

    if (selectedTypeId.value === typeId) {
      void loadDictionaryItems(typeId)
    }
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || reconciliationAbortController !== controller
      || !mutationResultIsCurrent(context)
    ) {
      return
    }
    const message
      = '数据已发生变化，但暂时无法读取最新版本。请关闭弹窗并刷新列表后重试。'
    if (surface === 'form') {
      formError.value = message
    }
    else {
      statusError.value = message
      statusErrorCode.value = 'DICTIONARY_TYPE_STATE_CHANGED'
    }
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
    if (mutationResultIsCurrent(context)) {
      if (surface === 'form') {
        formSubmitting.value = false
      }
      else {
        statusSubmitting.value = false
      }
    }
  }
}

/**
 * 只有可信成功响应或可证明的最终状态才失效 Catalog。该操作不回写受保护
 * DTO，因此只绑定原 authEpoch，不受浮层关闭或细粒度撤权影响。
 */
function invalidateMutationCatalog(
  context: DictionaryTypeMutationContext,
  code: string,
): void {
  if (context.authEpoch !== appAccountStore.authEpoch) {
    return
  }
  invalidateDictionaryCatalogCache({
    broadcast: true,
    code,
  })
}

/**
 * Network error 无法证明请求没有在 Server 提交。失效只会清除受影响 code 的
 * 只读缓存，不代表写入成功；在 UI ownership 判定前执行可覆盖撤权和卸载竞态。
 */
function invalidatePossiblyChangedCatalog(
  context: DictionaryTypeMutationContext,
  code: string,
): void {
  invalidateMutationCatalog(context, code)
}

async function finishDictionaryTypeMutation(input: {
  readonly confirmedAfterNetworkFailure: boolean
  readonly context: DictionaryTypeMutationContext
  readonly surface: 'form' | 'status'
  readonly type: DictionaryTypeDto
}): Promise<void> {
  if (!mutationResultIsCurrent(input.context)) {
    return
  }

  replaceDictionaryTypeSnapshot(input.type)
  setMutation('complete')
  if (input.surface === 'form') {
    formSubmitting.value = false
  }
  else {
    statusSubmitting.value = false
  }
  await nextTick()
  if (!mutationResultIsCurrent(input.context)) {
    return
  }

  if (input.surface === 'form') {
    formVisible.value = false
    formTarget.value = null
    resetFormFailure()
  }
  else {
    statusVisible.value = false
    statusTarget.value = null
    resetStatusFailure()
  }

  mutationVersion += 1
  mutationTargetKey = null

  const labels: Readonly<Record<DictionaryTypeMutationKind, string>> = {
    create: '字典类型已创建',
    disable: '字典类型已停用',
    enable: '字典类型已启用',
    update: '字典类型已更新',
  }
  toast.success(labels[input.context.kind], {
    description: input.confirmedAfterNetworkFailure
      ? `${input.type.name} 已通过最终状态核对确认。`
      : input.type.name,
  })

  const shouldRefreshItems = selectedTypeId.value === input.type.id
  await loadDictionaryTypes()
  if (shouldRefreshItems && selectedTypeId.value === input.type.id) {
    await loadDictionaryItems(input.type.id)
  }
}

function applyKnownFormFailure(error: unknown): void {
  const failure = getDictionaryTypeMutationFailure(error)
  formError.value = failure.message
  formRequestId.value = failure.requestId ?? null
  formFieldErrors.value = failure.fieldErrors
  formSubmitting.value = false
  setMutation('known-failure')
}

async function handleTypeFormSubmit(
  submission: DictionaryTypeFormSubmission,
): Promise<void> {
  if (
    !canRead.value
    || !formVisible.value
    || formSubmitting.value
    || submission.mode !== formMode.value
  ) {
    return
  }

  const operationTarget = formTarget.value
  if (submission.mode === 'edit' && (
    operationTarget === null
    || submission.typeId !== operationTarget.id
  )) {
    formError.value = '未找到待编辑字典类型，请关闭弹窗后重试。'
    return
  }

  const kind: DictionaryTypeMutationKind
    = submission.mode === 'create' ? 'create' : 'update'
  const targetKey = submission.mode === 'create'
    ? `create:${submission.data.code}`
    : `update:${submission.typeId}`
  const context = beginMutationRequest(kind, targetKey)
  if (context === null) {
    formError.value = '当前身份已无权执行该操作，或当前操作上下文已经失效。'
    return
  }

  resetFormFailure()
  formSubmitting.value = true
  try {
    const response = submission.mode === 'create'
      ? await dictionariesApi.types.create(submission.data)
      : await dictionariesApi.types.update(
          submission.typeId,
          submission.data,
        )
    invalidateMutationCatalog(context, response.data.code)
    if (!mutationResultIsCurrent(context)) {
      return
    }
    await finishDictionaryTypeMutation({
      confirmedAfterNetworkFailure: false,
      context,
      surface: 'form',
      type: response.data,
    })
  }
  catch (error) {
    const failure = getDictionaryTypeMutationFailure(error)
    if (failure.unknownResult) {
      invalidatePossiblyChangedCatalog(
        context,
        submission.mode === 'create'
          ? submission.data.code
          : operationTarget!.code,
      )
    }
    if (!mutationResultIsCurrent(context)) {
      return
    }
    if (failure.stateChanged && submission.mode === 'edit') {
      formError.value = failure.message
      formRequestId.value = failure.requestId ?? null
      await refreshStateChangedType(
        context,
        submission.typeId,
        'form',
      )
      return
    }
    if (!failure.unknownResult) {
      applyKnownFormFailure(error)
      return
    }

    setMutation('unknown-result')
    const reconciled = submission.mode === 'create'
      ? await reconcileUnknownTypeCreate(context, submission.data)
      : await reconcileUnknownTypeMutation(context, submission.typeId)
    if (!mutationResultIsCurrent(context)) {
      return
    }
    // Create 没有 idempotency/operation identity；同字段对象可能早已存在，
    // 因此只可作为人工核对候选，不能据此宣告本次请求成功。
    const confirmed = submission.mode === 'edit'
      && reconciled !== undefined
      && matchesDictionaryTypeUpdate(
        reconciled,
        submission.typeId,
        submission.data,
      )
      ? reconciled
      : undefined
    if (confirmed !== undefined) {
      invalidateMutationCatalog(context, confirmed.code)
      await finishDictionaryTypeMutation({
        confirmedAfterNetworkFailure: true,
        context,
        surface: 'form',
        type: confirmed,
      })
      return
    }

    if (reconciled !== undefined) {
      replaceDictionaryTypeSnapshot(reconciled)
    }
    formError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
    formSubmitting.value = false
    setMutation('fail')
  }
}

async function handleTypeStatusSubmit(
  request: DictionaryStatusChangeRequest,
): Promise<void> {
  const operationTarget = statusTarget.value
  if (
    request.targetKind !== 'type'
    || !canRead.value
    || !statusVisible.value
    || statusTargetKind.value !== 'type'
    || statusSubmitting.value
    || operationTarget === null
    || request.typeId !== operationTarget.id
    || request.action !== statusAction.value
    || request.expectedVersion !== operationTarget.version
  ) {
    return
  }

  const context = beginMutationRequest(
    request.action,
    `${request.action}:${request.typeId}`,
  )
  if (context === null) {
    statusError.value = '当前身份已无权执行该操作，或当前操作上下文已经失效。'
    return
  }

  resetStatusFailure()
  statusSubmitting.value = true
  const data = { expectedVersion: request.expectedVersion }
  try {
    const response = request.action === 'enable'
      ? await dictionariesApi.types.enable(request.typeId, data)
      : await dictionariesApi.types.disable(request.typeId, data)
    invalidateMutationCatalog(context, response.data.code)
    if (!mutationResultIsCurrent(context)) {
      return
    }
    await finishDictionaryTypeMutation({
      confirmedAfterNetworkFailure: false,
      context,
      surface: 'status',
      type: response.data,
    })
  }
  catch (error) {
    const failure = getDictionaryTypeMutationFailure(error)
    if (failure.unknownResult) {
      invalidatePossiblyChangedCatalog(context, operationTarget.code)
    }
    if (!mutationResultIsCurrent(context)) {
      return
    }
    if (failure.stateChanged) {
      statusError.value = failure.message
      statusErrorCode.value = failure.code
      statusRequestId.value = failure.requestId
      await refreshStateChangedType(
        context,
        request.typeId,
        'status',
      )
      return
    }
    if (!failure.unknownResult) {
      statusError.value = failure.message
      statusErrorCode.value = failure.code
      statusRequestId.value = failure.requestId
      statusSubmitting.value = false
      setMutation('known-failure')
      return
    }

    setMutation('unknown-result')
    const reconciled = await reconcileUnknownTypeMutation(
      context,
      request.typeId,
    )
    if (!mutationResultIsCurrent(context)) {
      return
    }
    const confirmed = reconciled !== undefined
      && matchesDictionaryTypeStatus(
        reconciled,
        request.typeId,
        request.action === 'enable',
      )
      ? reconciled
      : undefined
    if (confirmed !== undefined) {
      invalidateMutationCatalog(context, confirmed.code)
      await finishDictionaryTypeMutation({
        confirmedAfterNetworkFailure: true,
        context,
        surface: 'status',
        type: confirmed,
      })
      return
    }

    if (reconciled !== undefined) {
      replaceDictionaryTypeSnapshot(reconciled)
    }
    statusError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
    statusErrorCode.value = undefined
    statusRequestId.value = undefined
    statusSubmitting.value = false
    setMutation('fail')
  }
}

async function reconcileUnknownItemCreate(
  context: DictionaryTypeMutationContext,
  typeId: string,
  request: CreateDictionaryItemRequestDto,
): Promise<DictionaryItemDto | undefined> {
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await dictionariesApi.items.list(
      typeId,
      buildDictionaryItemListQuery({
        page: 1,
        pageSize: 20,
        search: request.value,
        sorting: [{ id: 'value', desc: false }],
        status: undefined,
      }),
      controller.signal,
    )
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return undefined
    }
    return findMatchingCreatedDictionaryItem(
      response.data.items,
      typeId,
      request,
    )
  }
  catch {
    return undefined
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
  }
}

async function reconcileUnknownItemMutation(
  context: DictionaryTypeMutationContext,
  typeId: string,
  itemId: string,
): Promise<DictionaryItemDto | undefined> {
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await dictionariesApi.items.get(
      typeId,
      itemId,
      controller.signal,
    )
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return undefined
    }
    return response.data
  }
  catch {
    return undefined
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
  }
}

async function refreshStateChangedItem(
  context: DictionaryTypeMutationContext,
  typeId: string,
  itemId: string,
  surface: 'form' | 'status',
): Promise<void> {
  if (!mutationResultIsCurrent(context)) {
    return
  }
  setMutation('fail')
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller

  try {
    const [itemResponse, typeResponse] = await Promise.all([
      dictionariesApi.items.get(
        typeId,
        itemId,
        controller.signal,
      ),
      dictionariesApi.types.get(typeId, controller.signal),
    ])
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return
    }

    replaceDictionaryTypeSnapshot(typeResponse.data)
    replaceDictionaryItemSnapshot(itemResponse.data)
    setMutation('resume-editing')
    if (surface === 'form') {
      itemFormError.value
        = '数据已被其他操作更新。未编辑字段已合并最新值；双方同时修改的字段已标记，请核对后重新提交。'
      itemFormRequestId.value = null
      itemFormFieldErrors.value = {}
    }
    else {
      statusError.value
        = '条目已被其他操作更新，已载入最新版本。请核对当前状态后重新提交。'
      statusErrorCode.value = 'DICTIONARY_ITEM_STATE_CHANGED'
      statusRequestId.value = undefined
    }
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || reconciliationAbortController !== controller
      || !mutationResultIsCurrent(context)
    ) {
      return
    }
    const message
      = '条目已发生变化，但暂时无法读取最新版本。请关闭弹窗并刷新列表后重试。'
    if (surface === 'form') {
      itemFormError.value = message
    }
    else {
      statusError.value = message
      statusErrorCode.value = 'DICTIONARY_ITEM_STATE_CHANGED'
    }
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
    if (mutationResultIsCurrent(context)) {
      if (surface === 'form') {
        itemFormSubmitting.value = false
      }
      else {
        statusSubmitting.value = false
      }
    }
  }
}

/**
 * 最后启用条目约束失败通常表示父 Type 统计已在别处变化。错误码本身先禁用重提，
 * 再以 exact Type/Item GET 刷新动作依据；读取失败也不能自动重放 Mutation。
 */
async function refreshItemStatusConstraint(
  context: DictionaryTypeMutationContext,
  typeId: string,
  itemId: string,
): Promise<void> {
  abortReconciliation()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const [itemResponse, typeResponse] = await Promise.all([
      dictionariesApi.items.get(typeId, itemId, controller.signal),
      dictionariesApi.types.get(typeId, controller.signal),
    ])
    if (
      reconciliationAbortController !== controller
      || controller.signal.aborted
      || !mutationResultIsCurrent(context)
    ) {
      return
    }
    replaceDictionaryTypeSnapshot(typeResponse.data)
    replaceDictionaryItemSnapshot(itemResponse.data)
  }
  catch {
    // 稳定领域错误已在 Modal 展示并禁用重提；读取失败保持 fail-closed。
  }
  finally {
    if (reconciliationAbortController === controller) {
      reconciliationAbortController = null
    }
  }
}

async function finishDictionaryItemMutation(input: {
  readonly confirmedAfterNetworkFailure: boolean
  readonly context: DictionaryTypeMutationContext
  readonly item: DictionaryItemDto
  readonly surface: 'form' | 'status'
  readonly type: DictionaryTypeDto
}): Promise<void> {
  if (!mutationResultIsCurrent(input.context)) {
    return
  }

  replaceDictionaryItemSnapshot(input.item)
  setMutation('complete')
  if (input.surface === 'form') {
    itemFormSubmitting.value = false
  }
  else {
    statusSubmitting.value = false
  }
  await nextTick()
  if (!mutationResultIsCurrent(input.context)) {
    return
  }

  if (input.surface === 'form') {
    itemFormVisible.value = false
    itemFormTarget.value = null
    resetItemFormFailure()
  }
  else {
    statusVisible.value = false
    statusTarget.value = null
    statusItemTarget.value = null
    statusTargetKind.value = 'type'
    resetStatusFailure()
  }

  mutationVersion += 1
  mutationTargetKey = null

  const labels: Readonly<Record<DictionaryTypeMutationKind, string>> = {
    create: '字典条目已创建',
    disable: '字典条目已停用',
    enable: '字典条目已启用',
    update: '字典条目已更新',
  }
  toast.success(labels[input.context.kind], {
    description: input.confirmedAfterNetworkFailure
      ? `${input.item.label} 已通过最终状态核对确认。`
      : `${input.type.name} · ${input.item.label}`,
  })

  await loadDictionaryTypes()
  if (selectedTypeId.value === input.type.id) {
    await loadDictionaryItems(input.type.id)
  }
}

function applyKnownItemFormFailure(error: unknown): void {
  const failure = getDictionaryItemMutationFailure(error)
  itemFormError.value = failure.message
  itemFormRequestId.value = failure.requestId ?? null
  itemFormFieldErrors.value = failure.fieldErrors
  itemFormSubmitting.value = false
  setMutation('known-failure')
}

function dictionaryItemUpdateHasChanges(
  request: UpdateDictionaryItemRequestDto,
): boolean {
  return ['description', 'label', 'sortOrder', 'tone']
    .some(field => Object.hasOwn(request, field))
}

async function handleItemFormSubmit(
  submission: DictionaryItemFormSubmission,
): Promise<void> {
  const operationType = selectedType.value
  const operationTarget = itemFormTarget.value
  if (
    !canRead.value
    || !itemFormVisible.value
    || itemFormSubmitting.value
    || submission.mode !== itemFormMode.value
    || operationType === null
    || submission.typeId !== operationType.id
    || (
      submission.mode === 'edit'
      && (
        operationTarget === null
        || submission.itemId !== operationTarget.id
        || operationTarget.dictionaryTypeId !== operationType.id
        || submission.data.expectedVersion !== operationTarget.version
        || !dictionaryItemUpdateHasChanges(submission.data)
      )
    )
  ) {
    return
  }

  const kind: DictionaryTypeMutationKind
    = submission.mode === 'create' ? 'create' : 'update'
  const targetKey = submission.mode === 'create'
    ? `item:create:${operationType.id}:${submission.data.value}`
    : `item:update:${operationType.id}:${submission.itemId}`
  const context = beginMutationRequest(kind, targetKey)
  if (context === null) {
    itemFormError.value
      = '当前身份已无权执行该操作，或当前操作上下文已经失效。'
    return
  }

  resetItemFormFailure()
  itemFormSubmitting.value = true
  try {
    const response = submission.mode === 'create'
      ? await dictionariesApi.items.create(operationType.id, submission.data)
      : await dictionariesApi.items.update(
          operationType.id,
          submission.itemId,
          submission.data,
        )
    invalidateMutationCatalog(context, operationType.code)
    if (!mutationResultIsCurrent(context)) {
      return
    }
    await finishDictionaryItemMutation({
      confirmedAfterNetworkFailure: false,
      context,
      item: response.data,
      surface: 'form',
      type: operationType,
    })
  }
  catch (error) {
    const failure = getDictionaryItemMutationFailure(error)
    if (failure.unknownResult) {
      invalidatePossiblyChangedCatalog(context, operationType.code)
    }
    if (!mutationResultIsCurrent(context)) {
      return
    }
    if (failure.stateChanged && submission.mode === 'edit') {
      itemFormError.value = failure.message
      itemFormRequestId.value = failure.requestId ?? null
      await refreshStateChangedItem(
        context,
        operationType.id,
        submission.itemId,
        'form',
      )
      return
    }
    if (!failure.unknownResult) {
      applyKnownItemFormFailure(error)
      return
    }

    setMutation('unknown-result')
    const reconciled = submission.mode === 'create'
      ? await reconcileUnknownItemCreate(
          context,
          operationType.id,
          submission.data,
        )
      : await reconcileUnknownItemMutation(
          context,
          operationType.id,
          submission.itemId,
        )
    if (!mutationResultIsCurrent(context)) {
      return
    }
    const confirmed = submission.mode === 'edit'
      && reconciled !== undefined
      && matchesDictionaryItemUpdateResult(
        reconciled,
        operationType.id,
        submission.itemId,
        submission.data,
      )
      ? reconciled
      : undefined
    if (confirmed !== undefined) {
      invalidateMutationCatalog(context, operationType.code)
      await finishDictionaryItemMutation({
        confirmedAfterNetworkFailure: true,
        context,
        item: confirmed,
        surface: 'form',
        type: operationType,
      })
      return
    }

    if (reconciled !== undefined) {
      replaceDictionaryItemSnapshot(reconciled)
    }
    itemFormError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
    itemFormSubmitting.value = false
    setMutation('fail')
  }
}

async function handleItemStatusSubmit(
  request: DictionaryStatusChangeRequest,
): Promise<void> {
  const operationType = statusTarget.value
  const operationTarget = statusItemTarget.value
  if (
    request.targetKind !== 'item'
    || !canRead.value
    || !statusVisible.value
    || statusTargetKind.value !== 'item'
    || statusSubmitting.value
    || operationType === null
    || operationTarget === null
    || request.typeId !== operationType.id
    || request.itemId !== operationTarget.id
    || operationTarget.dictionaryTypeId !== operationType.id
    || request.action !== statusAction.value
    || request.expectedVersion !== operationTarget.version
  ) {
    return
  }

  const actions = resolveDictionaryItemActions(operationTarget, operationType, {
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canUpdate: canUpdate.value,
  })
  if (
    (request.action === 'enable' && !actions.canEnable)
    || (request.action === 'disable' && !actions.canDisable)
  ) {
    statusError.value = actions.disableBlockedReason
      ?? '当前身份已无权执行该操作，或目标状态已经变化。'
    return
  }

  const context = beginMutationRequest(
    request.action,
    `item:${request.action}:${request.typeId}:${request.itemId}`,
  )
  if (context === null) {
    statusError.value = '当前身份已无权执行该操作，或当前操作上下文已经失效。'
    return
  }

  resetStatusFailure()
  statusSubmitting.value = true
  const data = { expectedVersion: request.expectedVersion }
  try {
    const response = request.action === 'enable'
      ? await dictionariesApi.items.enable(
          request.typeId,
          request.itemId,
          data,
        )
      : await dictionariesApi.items.disable(
          request.typeId,
          request.itemId,
          data,
        )
    invalidateMutationCatalog(context, operationType.code)
    if (!mutationResultIsCurrent(context)) {
      return
    }
    await finishDictionaryItemMutation({
      confirmedAfterNetworkFailure: false,
      context,
      item: response.data,
      surface: 'status',
      type: operationType,
    })
  }
  catch (error) {
    const failure = getDictionaryItemMutationFailure(error)
    if (failure.unknownResult) {
      invalidatePossiblyChangedCatalog(context, operationType.code)
    }
    if (!mutationResultIsCurrent(context)) {
      return
    }
    if (failure.stateChanged) {
      statusError.value = failure.message
      statusErrorCode.value = failure.code
      statusRequestId.value = failure.requestId
      await refreshStateChangedItem(
        context,
        request.typeId,
        request.itemId,
        'status',
      )
      return
    }
    if (!failure.unknownResult) {
      statusError.value = failure.message
      statusErrorCode.value = failure.code
      statusRequestId.value = failure.requestId
      statusSubmitting.value = false
      setMutation('known-failure')
      if (failure.code === 'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED') {
        await refreshItemStatusConstraint(
          context,
          request.typeId,
          request.itemId,
        )
      }
      return
    }

    setMutation('unknown-result')
    const reconciled = await reconcileUnknownItemMutation(
      context,
      request.typeId,
      request.itemId,
    )
    if (!mutationResultIsCurrent(context)) {
      return
    }
    const confirmed = reconciled !== undefined
      && matchesDictionaryItemStatus(
        reconciled,
        request.typeId,
        request.itemId,
        request.action === 'enable',
        operationType.enabled,
      )
      ? reconciled
      : undefined
    if (confirmed !== undefined) {
      invalidateMutationCatalog(context, operationType.code)
      await finishDictionaryItemMutation({
        confirmedAfterNetworkFailure: true,
        context,
        item: confirmed,
        surface: 'status',
        type: operationType,
      })
      return
    }

    if (reconciled !== undefined) {
      replaceDictionaryItemSnapshot(reconciled)
    }
    statusError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
    statusErrorCode.value = undefined
    statusRequestId.value = undefined
    statusSubmitting.value = false
    setMutation('fail')
  }
}

function handleDictionaryStatusSubmit(
  request: DictionaryStatusChangeRequest,
): void {
  if (request.targetKind === 'item') {
    void handleItemStatusSubmit(request)
    return
  }
  void handleTypeStatusSubmit(request)
}

async function loadDictionaryItems(requestedTypeId: string): Promise<void> {
  if (!canRead.value || disposed || requestedTypeId !== selectedTypeId.value) {
    return
  }

  abortItemQuery()
  const controller = new AbortController()
  itemAbortController = controller
  const requestVersion = itemRequestVersion
  const authEpoch = appAccountStore.authEpoch
  itemError.value = ''
  setItemQuery({
    type: 'request',
    hasData: dictionaryItems.value.length > 0,
  })

  try {
    const response = await dictionariesApi.items.list(
      requestedTypeId,
      buildDictionaryItemListQuery({
        page: itemPage.value,
        pageSize: itemPageSize.value,
        search: itemSearch.value,
        sorting: itemSorting.value,
        status: itemFilters.value.ownStatus,
      }),
      controller.signal,
    )
    if (!itemResponseIsCurrent(
      requestVersion,
      authEpoch,
      requestedTypeId,
      controller,
    )) {
      return
    }

    const resolvedPage = resolveDictionaryItemResponsePage({
      itemCount: response.data.items.length,
      page: response.data.page,
      pageSize: response.data.pageSize,
      total: response.data.total,
    })
    if (resolvedPage !== response.data.page) {
      itemPage.value = resolvedPage
      void loadDictionaryItems(requestedTypeId)
      return
    }

    dictionaryItems.value = response.data.items
    itemPage.value = response.data.page
    itemPageSize.value = response.data.pageSize
    itemTotal.value = response.data.total
    setItemQuery({
      type: 'success',
      itemCount: response.data.items.length,
    })
  }
  catch (error) {
    if (
      isDictionaryAbortError(error)
      || !itemResponseIsCurrent(
        requestVersion,
        authEpoch,
        requestedTypeId,
        controller,
      )
    ) {
      return
    }
    // 查询模型已切到新条件/新页码；失败时不能让旧行继续以新上下文可操作。
    dictionaryItems.value = []
    itemTotal.value = 0
    itemError.value = '暂时无法读取字典条目，请稍后重试。'
    setItemQuery({ type: 'failure' })
  }
  finally {
    if (
      itemAbortController === controller
      && requestVersion === itemRequestVersion
    ) {
      itemAbortController = null
    }
  }
}

/**
 * QsGenericTable 清除条件时会在同一轮连续发出 search/filter 事件；合并到一个
 * microtask，只请求最终受控状态，避免重复 GET 与闪烁。
 */
function scheduleDictionaryItemRefresh(): void {
  itemPage.value = 1
  itemQueryScheduler.schedule()
}

function searchDictionaryItems(search: string): void {
  itemSearch.value = search
  scheduleDictionaryItemRefresh()
}

function filterDictionaryItems(filters: QsGenericTableFilterValues): void {
  itemFilters.value = { ...filters }
  scheduleDictionaryItemRefresh()
}

function sortDictionaryItems(sorting: TableSortingState): void {
  itemSorting.value = sorting
  scheduleDictionaryItemRefresh()
}

function paginateDictionaryItems(input: {
  page: number
  pageSize: number
}): void {
  itemPage.value = input.page
  itemPageSize.value = input.pageSize
  const typeId = selectedTypeId.value
  if (typeId !== null) {
    void loadDictionaryItems(typeId)
  }
}

/** Type 切换只关闭 Item 领域浮层；Type 自身浮层继续由各自操作上下文管理。 */
function closeItemOverlaysForTypeSwitch(): void {
  const itemStatusOpen = statusVisible.value && statusTargetKind.value === 'item'
  if (!itemFormVisible.value && !itemStatusOpen) {
    return
  }

  itemFormVisible.value = false
  itemFormSubmitting.value = false
  itemFormTarget.value = null
  resetItemFormFailure()
  if (itemStatusOpen) {
    statusVisible.value = false
    statusSubmitting.value = false
    statusTarget.value = null
    statusItemTarget.value = null
    statusTargetKind.value = 'type'
    resetStatusFailure()
  }
  invalidateMutationContext('cancel')
}

/** Type 选择只写页面本地状态；先作废旧 Item，再建立新选择的请求归属。 */
function selectDictionaryType(
  typeId: string | null,
  closeDrawer = true,
): void {
  if (typeId === selectedTypeId.value) {
    if (closeDrawer) {
      typeDrawerOpen.value = false
    }
    return
  }
  itemQueryScheduler.invalidate()
  abortItemQuery()
  closeItemOverlaysForTypeSwitch()
  dictionaryItems.value = []
  itemTotal.value = 0
  itemError.value = ''
  itemPage.value = 1
  managementState.value = {
    ...managementState.value,
    itemQuery: 'idle',
    selection: createDictionarySelection(typeId),
  }
  if (closeDrawer) {
    typeDrawerOpen.value = false
  }

  if (typeId !== null) {
    void loadDictionaryItems(typeId)
  }
}

function clearProtectedData(): void {
  itemQueryScheduler.invalidate()
  dictionaryTypes.value = []
  dictionaryItems.value = []
  typeTotal.value = 0
  itemTotal.value = 0
  typeError.value = ''
  itemError.value = ''
  itemPage.value = 1
  managementState.value = {
    ...managementState.value,
    itemQuery: 'idle',
    selection: createDictionarySelection(null),
    typeQuery: 'idle',
  }
}

function closeProtectedOverlays(): void {
  typeDrawerOpen.value = false
  formVisible.value = false
  itemFormVisible.value = false
  statusVisible.value = false
  formSubmitting.value = false
  itemFormSubmitting.value = false
  statusSubmitting.value = false
  formTarget.value = null
  itemFormTarget.value = null
  statusTarget.value = null
  statusItemTarget.value = null
  statusTargetKind.value = 'type'
  resetFormFailure()
  resetItemFormFailure()
  resetStatusFailure()
  invalidateMutationContext('authority-loss')
}

function applyAccessBoundary(
  authorized: boolean,
  identityChanged: boolean,
): void {
  const transition = resolveDictionaryAccessTransition({
    authorized,
    identityChanged,
    previousState: managementState.value,
  })
  if (transition.shouldAbortQueries) {
    abortProtectedQueries()
  }
  if (transition.shouldClearProtectedData) {
    clearProtectedData()
  }
  if (transition.shouldCloseOverlays) {
    closeProtectedOverlays()
  }
  managementState.value = transition.nextState

  if (transition.shouldReload) {
    void loadDictionaryTypes()
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([authEpoch, authorized], [previousAuthEpoch]) => {
    applyAccessBoundary(authorized, authEpoch !== previousAuthEpoch)
  },
)

watch(
  [canCreate, canUpdate, canEnable, canDisable],
  ([createAllowed, updateAllowed, enableAllowed, disableAllowed]) => {
    const typeFormPermissionLost = formVisible.value
      && (
        (formMode.value === 'create' && !createAllowed)
        || (formMode.value === 'edit' && !updateAllowed)
      )
    const itemFormPermissionLost = itemFormVisible.value
      && (
        (itemFormMode.value === 'create' && !createAllowed)
        || (itemFormMode.value === 'edit' && !updateAllowed)
      )
    const statusPermissionLost = statusVisible.value
      && (
        (statusAction.value === 'enable' && !enableAllowed)
        || (statusAction.value === 'disable' && !disableAllowed)
      )
    if (
      typeFormPermissionLost
      || itemFormPermissionLost
      || statusPermissionLost
    ) {
      /*
       * 细粒度权限撤销不一定推进 authEpoch。立即作废写响应归属并关闭领域浮层，
       * 但保留仍可读取的列表，避免把 mutation 权限变化误判为 read 撤权。
       */
      closeProtectedOverlays()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadDictionaryTypes()
  }
})

onBeforeUnmount(() => {
  disposed = true
  itemQueryScheduler.dispose()
  abortProtectedQueries()
  abortReconciliation()
  clearProtectedData()
  closeProtectedOverlays()
})
</script>

<template>
  <div class="dictionary-management-page min-w-0">
    <FaPageHeader
      title="字典管理"
      description="维护全局、平铺且低风险的业务选项；类型码与条目值作为稳定身份，不随展示名称变化。"
    >
      <FaButton
        v-if="canRead && canCreate"
        class="min-h-11 md:min-h-9"
        @click="openCreateType"
      >
        <FaIcon name="i-lucide:plus" />
        新增类型
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="managementState.access === 'forbidden'"
        icon="i-lucide:shield-alert"
        title="无权查看字典"
        description="当前身份缺少 dictionaries:read 权限。"
        class="min-h-64"
      />

      <div
        v-else
        class="gap-5 grid min-w-0 md:grid-cols-[18rem_minmax(0,1fr)]"
        data-testid="dictionary-management-workspace"
      >
        <aside
          class="min-w-0 hidden md:pr-5 md:border-r md:border-border md:block"
          aria-label="字典类型目录"
          data-testid="dictionary-type-panel"
        >
          <DictionaryTypeList
            v-model:page="typePage"
            v-model:page-size="typePageSize"
            v-model:search="typeSearch"
            :busy="typeBusy"
            :empty-kind="typeEmptyKind"
            :error="typeError"
            :items="dictionaryTypes"
            :query-state="managementState.typeQuery"
            :selected-type-id="selectedTypeId"
            :status="typeStatus"
            :total="typeTotal"
            @page-change="changeDictionaryTypePage"
            @page-size-change="changeDictionaryTypePageSize"
            @retry="loadDictionaryTypes"
            @search="searchDictionaryTypes"
            @select="selectDictionaryType"
            @status-change="filterDictionaryTypes"
          />
        </aside>

        <section class="min-w-0" aria-labelledby="dictionary-item-panel-title">
          <div class="mb-4 flex flex-wrap gap-3 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-meta m-0">
                当前类型
              </p>
              <h2 id="dictionary-item-panel-title" class="qs-type-compact-title mb-0 mt-1 break-words">
                {{ selectedType?.name ?? '字典条目' }}
              </h2>
              <code v-if="selectedType" class="qs-type-data mt-1 block break-all">
                {{ selectedType.code }}
              </code>
            </div>

            <FaButton
              variant="outline"
              class="min-h-11 md:hidden"
              data-testid="dictionary-open-type-drawer"
              aria-controls="dictionary-type-drawer"
              :aria-expanded="typeDrawerOpen"
              @click="typeDrawerOpen = true"
            >
              <FaIcon name="i-lucide:list-filter" />
              选择类型
            </FaButton>
          </div>

          <section
            v-if="selectedType"
            class="mb-4 p-4 border border-border rounded-lg bg-muted/10 gap-4 grid"
            aria-label="当前字典类型摘要"
          >
            <dl class="m-0 gap-x-6 gap-y-3 grid grid-cols-2 sm:grid-cols-4">
              <div class="gap-1 grid">
                <dt class="qs-type-label text-muted-foreground">
                  自身状态
                </dt>
                <dd class="m-0">
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="selectedType.enabled
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground'"
                  >
                    {{ selectedType.enabled ? '已启用' : '已停用' }}
                  </FaTag>
                </dd>
              </div>
              <div class="gap-1 grid">
                <dt class="qs-type-label text-muted-foreground">
                  全部条目
                </dt>
                <dd class="qs-type-data m-0 tabular-nums">
                  {{ selectedType.itemCount }}
                </dd>
              </div>
              <div class="gap-1 grid">
                <dt class="qs-type-label text-muted-foreground">
                  自身启用条目
                </dt>
                <dd class="qs-type-data m-0 tabular-nums">
                  {{ selectedType.enabledItemCount }}
                </dd>
              </div>
              <div class="gap-1 grid">
                <dt class="qs-type-label text-muted-foreground">
                  版本
                </dt>
                <dd class="qs-type-data m-0 tabular-nums">
                  v{{ selectedType.version }}
                </dd>
              </div>
            </dl>

            <p v-if="selectedType.description" class="qs-type-body m-0 break-words">
              {{ selectedType.description }}
            </p>

            <div class="flex flex-wrap gap-2 items-center justify-end" aria-label="字典类型操作">
              <span
                v-if="selectedTypeActions && !selectedTypeActions.hasAny"
                class="qs-type-meta"
              >
                {{ selectedTypeActions.readonlyReason }}
              </span>
              <FaButton
                v-if="selectedTypeActions?.canEdit"
                variant="outline"
                class="min-h-11 md:min-h-9"
                @click="openEditType(selectedType)"
              >
                <FaIcon name="i-lucide:pencil" />
                编辑类型
              </FaButton>
              <FaButton
                v-if="selectedTypeActions?.canEnable"
                variant="outline"
                class="min-h-11 md:min-h-9"
                @click="openTypeStatusChange(selectedType, 'enable')"
              >
                <FaIcon name="i-lucide:circle-play" />
                启用类型
              </FaButton>
              <FaButton
                v-if="selectedTypeActions?.canDisable"
                variant="destructive"
                class="min-h-11 md:min-h-9"
                @click="openTypeStatusChange(selectedType, 'disable')"
              >
                <FaIcon name="i-lucide:circle-pause" />
                停用类型
              </FaButton>
            </div>
          </section>

          <FaEmpty
            v-if="managementState.selection.kind === 'none'"
            icon="i-lucide:mouse-pointer-click"
            title="请选择字典类型"
            description="从类型目录中选择一项后查看其条目。"
            class="border border-border rounded-lg bg-muted/10 min-h-64"
          />

          <DictionaryItemTable
            v-else-if="selectedType"
            v-model:page="itemPage"
            v-model:page-size="itemPageSize"
            v-model:search="itemSearch"
            v-model:filters="itemFilters"
            v-model:sorting="itemSorting"
            :can-create="canCreate"
            :can-disable="canDisable"
            :can-enable="canEnable"
            :can-update="canUpdate"
            :dictionary-type="selectedType"
            :error="itemError"
            :items="dictionaryItems"
            :loading="itemBusy"
            :total="itemTotal"
            @add="openCreateItem"
            @edit="openEditItem"
            @filter-change="filterDictionaryItems"
            @pagination-change="paginateDictionaryItems"
            @retry="selectedTypeId && loadDictionaryItems(selectedTypeId)"
            @search="searchDictionaryItems"
            @sorting-change="sortDictionaryItems"
            @status="openItemStatusChange"
          />
        </section>
      </div>
    </FaPageMain>

    <QsGenericDrawer
      v-if="managementState.access === 'active'"
      v-model="typeDrawerOpen"
      title="选择字典类型"
      description="选择只保存在当前页面，不改变地址。"
      placement="bottom"
      size="lg"
    >
      <div
        id="dictionary-type-drawer"
        class="pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <DictionaryTypeList
          v-model:page="typePage"
          v-model:page-size="typePageSize"
          v-model:search="typeSearch"
          :busy="typeBusy"
          :empty-kind="typeEmptyKind"
          :error="typeError"
          :items="dictionaryTypes"
          :query-state="managementState.typeQuery"
          :selected-type-id="selectedTypeId"
          :status="typeStatus"
          :total="typeTotal"
          @page-change="changeDictionaryTypePage"
          @page-size-change="changeDictionaryTypePageSize"
          @retry="loadDictionaryTypes"
          @search="searchDictionaryTypes"
          @select="selectDictionaryType"
          @status-change="filterDictionaryTypes"
        />
      </div>
    </QsGenericDrawer>

    <DictionaryTypeFormModal
      :model-value="formVisible"
      :mode="formMode"
      :dictionary-type="formTarget"
      :submitting="formSubmitting"
      :error="formError"
      :field-errors="formFieldErrors"
      :request-id="formRequestId"
      :submission-blocked="managementState.mutation === 'error'"
      @update:model-value="handleFormVisibilityChange"
      @submit="handleTypeFormSubmit"
    />

    <DictionaryItemFormModal
      :model-value="itemFormVisible"
      :mode="itemFormMode"
      :dictionary-type="selectedType"
      :dictionary-item="itemFormTarget"
      :submitting="itemFormSubmitting"
      :error="itemFormError"
      :field-errors="itemFormFieldErrors"
      :request-id="itemFormRequestId"
      :submission-blocked="managementState.mutation === 'error'"
      @update:model-value="handleItemFormVisibilityChange"
      @submit="handleItemFormSubmit"
    />

    <DictionaryStatusChangeModal
      :model-value="statusVisible"
      :action="statusAction"
      :target-kind="statusTargetKind"
      :type="statusTarget"
      :item="statusItemTarget"
      :submitting="statusSubmitting"
      :error="statusError"
      :error-code="statusErrorCode"
      :request-id="statusRequestId"
      :submission-blocked="managementState.mutation === 'error'"
      @cancel="cancelStatusChange"
      @submit="handleDictionaryStatusSubmit"
    />
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .dictionary-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
