<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { RegionFormSubmit } from './region-form.logic'
import type {
  RegionStatusAction,
  RegionStatusChangeRequest,
} from './region-status.logic'
import type { RegionScope } from './regions.logic'
import type {
  CreateRegionRequestDto,
  RegionDto,
  RegionNavigationNodeDto,
  UpdateRegionRequestDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import regionsApi from '@/api/modules/regions'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { invalidateRegionSelectorCache } from '@/components/business/QsRegionSelector/provider'

import { hasVisibleTableColumn } from '../../shared/table-query'
import RegionFormModal from './region-form-modal.vue'
import RegionScopeTree from './region-scope-tree.vue'
import RegionStatusChangeModal from './region-status-change-modal.vue'
import {
  administrativeTypeLabel,
  buildRegionListQuery,
  buildRegionReconciliationQuery,
  canApplyRegionResponse,
  childLevelForScope,
  createRegionQueryRefreshScheduler,
  createRegionScopeTree,
  createRootRegionScope,
  findMatchingCreatedRegion,
  getRegionApiFailure,
  getRegionMutationFailure,
  isRegionAbortError,
  matchesRegionStatus,
  matchesRegionUpdate,
  normalizeRegionFilters,
  ownStatusLabel,
  regionDisplayStatus,
  regionDisplayStatusLabel,
  regionLevelLabel,
  regionScopeKey,
  requiresRegionNavigationRefresh,
  resolveRegionAdminActions,
  ROOT_SCOPE_ID,
} from './regions.logic'

defineOptions({ name: 'SystemBasicDataRegions' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const canRead = computed(() => auth('regions:read'))
const canCreate = computed(() => auth('regions:create'))
const canUpdate = computed(() => auth('regions:update'))
const canEnable = computed(() => auth('regions:enable'))
const canDisable = computed(() => auth('regions:disable'))
const scope = ref<RegionScope>(createRootRegionScope())
const scopeDrawerVisible = ref(false)

const navigation = ref<RegionNavigationNodeDto[]>([])
const navigationLoading = ref(false)
const navigationError = ref('')
const navigationRequestId = ref<string>()
let navigationRequestVersion = 0
let navigationAbortController: AbortController | null = null

const rows = ref<RegionDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const sorting = ref<TableSortingState>([
  { id: 'sortOrder', desc: false },
])
const listLoading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let lastAppliedFilters: QsGenericTableFilterValues = {}

const formVisible = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formScope = ref<RegionScope>(createRootRegionScope())
const formTarget = ref<RegionDto | null>(null)
const formSubmitting = ref(false)
const formError = ref<string | null>(null)
const formRequestId = ref<string | null>(null)
const formFieldErrors = ref<Readonly<Record<string, string>>>({})

const statusVisible = ref(false)
const statusAction = ref<RegionStatusAction>('disable')
const statusScope = ref<RegionScope>(createRootRegionScope())
const statusTarget = ref<RegionDto | null>(null)
const statusSubmitting = ref(false)
const statusError = ref<string | null>(null)
const statusRequestId = ref<string>()

let reconciliationAbortController: AbortController | null = null

const navigationTree = computed(() => createRegionScopeTree(navigation.value))
const targetLevel = computed(() => childLevelForScope(scope.value))
const targetLevelLabel = computed(() => regionLevelLabel(targetLevel.value))
const formTargetLevel = computed(() => formMode.value === 'edit' && formTarget.value !== null
  ? formTarget.value.level
  : childLevelForScope(formScope.value))
const formParentPath = computed(() =>
  formScope.value.path.map(node => node.name))
const scopePathLabel = computed(() => scope.value.kind === 'ROOT'
  ? scope.value.label
  : scope.value.path.map(node => node.name).join(' '))
const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`)
const emptyTitle = computed(() => `暂无${targetLevelLabel.value}`)
const emptyDescription = computed(() =>
  `${scopePathLabel.value}当前没有直属${targetLevelLabel.value}。`)
const searchPlaceholder = computed(() =>
  `搜索当前直属${targetLevelLabel.value}的名称、英文名或 Code`)

const columns: QsGenericTableColumn<RegionDto>[] = [
  {
    accessorKey: 'name',
    enableMultiSort: false,
    id: 'name',
    minWidth: 190,
    sortable: true,
    title: '名称',
  },
  {
    accessorKey: 'code',
    copyable: true,
    enableMultiSort: false,
    id: 'code',
    minWidth: 170,
    sortable: true,
    title: 'Code',
  },
  {
    accessorKey: 'level',
    id: 'level',
    title: '层级',
    width: 110,
  },
  {
    accessorKey: 'administrativeType',
    id: 'administrativeType',
    minWidth: 170,
    title: '行政类型',
  },
  {
    accessorKey: 'enabled',
    id: 'enabled',
    title: '自身状态',
    width: 110,
  },
  {
    accessorFn: regionDisplayStatus,
    id: 'effectiveStatus',
    title: '有效状态',
    width: 120,
  },
  {
    accessorKey: 'sortOrder',
    align: 'right',
    enableMultiSort: false,
    id: 'sortOrder',
    sortable: true,
    title: '排序',
    width: 100,
  },
  {
    accessorKey: 'updatedAt',
    enableMultiSort: false,
    id: 'updatedAt',
    sortable: true,
    title: '更新时间',
    width: 190,
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'ownStatus',
    label: '自身状态',
    options: [
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' },
    ],
  },
  {
    key: 'availability',
    label: '有效状态',
    options: [
      { label: '有效', value: 'EFFECTIVE' },
      { label: '继承停用', value: 'ANCESTOR_DISABLED' },
    ],
  },
]

function navigationResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyRegionResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    currentScopeId: ROOT_SCOPE_ID,
    latestRequestVersion: navigationRequestVersion,
    requestVersion,
    scopeId: ROOT_SCOPE_ID,
  })
}

async function loadNavigation(): Promise<void> {
  if (!canRead.value) {
    return
  }
  navigationAbortController?.abort()
  const controller = new AbortController()
  navigationAbortController = controller
  const requestVersion = ++navigationRequestVersion
  const authEpoch = appAccountStore.authEpoch
  navigationLoading.value = true
  navigationError.value = ''
  navigationRequestId.value = undefined

  try {
    const response = await regionsApi.management.navigation(controller.signal)
    if (!navigationResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }
    navigation.value = response.data
  }
  catch (error) {
    if (
      isRegionAbortError(error)
      || !navigationResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getRegionApiFailure(error)
    navigationError.value = failure.message
    navigationRequestId.value = failure.requestId
  }
  finally {
    if (navigationResponseIsCurrent(requestVersion, authEpoch, controller)) {
      navigationLoading.value = false
    }
  }
}

function listResponseIsCurrent(
  requestVersion: number,
  requestScopeKey: string,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyRegionResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    currentScopeId: regionScopeKey(scope.value),
    latestRequestVersion: listRequestVersion,
    requestVersion,
    scopeId: requestScopeKey,
  })
}

async function loadRegions(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const requestScopeKey = regionScopeKey(scope.value)
  const authEpoch = appAccountStore.authEpoch
  const query = buildRegionListQuery({
    filters: filters.value,
    page: page.value,
    pageSize: pageSize.value,
    scope: scope.value,
    search: search.value,
    sorting: sorting.value,
  })
  listLoading.value = true
  listError.value = ''
  listRequestId.value = undefined

  try {
    const response = await regionsApi.management.list(query, controller.signal)
    if (!listResponseIsCurrent(
      requestVersion,
      requestScopeKey,
      authEpoch,
      controller,
    )) {
      return
    }
    rows.value = response.data.items
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (
      isRegionAbortError(error)
      || !listResponseIsCurrent(
        requestVersion,
        requestScopeKey,
        authEpoch,
        controller,
      )
    ) {
      return
    }
    const failure = getRegionApiFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (listResponseIsCurrent(
      requestVersion,
      requestScopeKey,
      authEpoch,
      controller,
    )) {
      listLoading.value = false
    }
  }
}

const queryScheduler = createRegionQueryRefreshScheduler(() => {
  void loadRegions()
})

function scheduleQueryRefresh(): void {
  page.value = 1
  queryScheduler.schedule()
}

function changedFilterKey(
  previous: QsGenericTableFilterValues,
  next: QsGenericTableFilterValues,
): 'availability' | 'ownStatus' | undefined {
  const ownChanged = previous.ownStatus !== next.ownStatus
  const availabilityChanged = previous.availability !== next.availability
  if (ownChanged && !availabilityChanged) {
    return 'ownStatus'
  }
  if (availabilityChanged && !ownChanged) {
    return 'availability'
  }
  return undefined
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  const normalized = normalizeRegionFilters(
    nextFilters,
    changedFilterKey(lastAppliedFilters, nextFilters),
  )
  filters.value = { ...normalized }
  lastAppliedFilters = { ...normalized }
  scheduleQueryRefresh()
}

function handlePaginationChange(
  pagination: { page: number, pageSize: number },
): void {
  page.value = pagination.page
  pageSize.value = pagination.pageSize
  void loadRegions()
}

function selectScope(nextScope: RegionScope): void {
  scopeDrawerVisible.value = false
  if (regionScopeKey(nextScope) === regionScopeKey(scope.value)) {
    return
  }
  scope.value = nextScope
  rows.value = []
  total.value = 0
  search.value = ''
  page.value = 1
  void loadRegions()
}

const UNKNOWN_MUTATION_RESULT_MESSAGE = '操作结果未知，请刷新后确认'

function resetFormFailure(): void {
  formError.value = null
  formRequestId.value = null
  formFieldErrors.value = {}
}

function resetStatusFailure(): void {
  statusError.value = null
  statusRequestId.value = undefined
}

function openCreate(): void {
  if (!canRead.value || !canCreate.value) {
    return
  }
  formMode.value = 'create'
  formScope.value = scope.value
  formTarget.value = null
  resetFormFailure()
  formVisible.value = true
}

function regionActions(region: RegionDto) {
  return resolveRegionAdminActions({
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canUpdate: canUpdate.value,
    enabled: region.enabled,
  })
}

function openEdit(region: RegionDto): void {
  if (!canRead.value || !regionActions(region).canEdit) {
    return
  }
  formMode.value = 'edit'
  formScope.value = scope.value
  formTarget.value = region
  resetFormFailure()
  formVisible.value = true
}

function openStatusChange(
  region: RegionDto,
  action: RegionStatusAction,
): void {
  const actions = regionActions(region)
  if (
    !canRead.value
    || (action === 'enable' && !actions.canEnable)
    || (action === 'disable' && !actions.canDisable)
  ) {
    return
  }
  statusAction.value = action
  statusScope.value = scope.value
  statusTarget.value = region
  resetStatusFailure()
  statusVisible.value = true
}

function cancelForm(): void {
  if (!formSubmitting.value) {
    formVisible.value = false
  }
}

function cancelStatusChange(): void {
  if (!statusSubmitting.value) {
    statusVisible.value = false
  }
}

async function reconcileUnknownCreate(
  operationScope: RegionScope,
  request: CreateRegionRequestDto,
): Promise<RegionDto | undefined> {
  reconciliationAbortController?.abort()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await regionsApi.management.list(
      buildRegionReconciliationQuery(operationScope, request.code),
      controller.signal,
    )
    return findMatchingCreatedRegion(
      response.data.items,
      operationScope,
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

async function reconcileUnknownUpdate(
  regionId: string,
  request: UpdateRegionRequestDto,
): Promise<RegionDto | undefined> {
  reconciliationAbortController?.abort()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await regionsApi.management.get(regionId, controller.signal)
    return matchesRegionUpdate(response.data, request)
      ? response.data
      : undefined
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

async function reconcileUnknownStatus(
  regionId: string,
  enabled: boolean,
): Promise<RegionDto | undefined> {
  reconciliationAbortController?.abort()
  const controller = new AbortController()
  reconciliationAbortController = controller
  try {
    const response = await regionsApi.management.get(regionId, controller.signal)
    return matchesRegionStatus(response.data, enabled)
      ? response.data
      : undefined
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

async function refreshAfterRegionMutation(region: RegionDto): Promise<void> {
  const refreshes: Promise<void>[] = [loadRegions()]
  if (requiresRegionNavigationRefresh(region.level)) {
    refreshes.push(loadNavigation())
  }
  await Promise.all(refreshes)
}

async function closeFormAfterSuccess(): Promise<void> {
  /*
   * 先解除 QsGenericModal 的提交锁，再等待一次渲染，确保成功关闭不会被组件按
   * “提交中禁止遮罩/Escape/close”规则拦截。
   */
  formSubmitting.value = false
  await nextTick()
  formVisible.value = false
}

async function closeStatusAfterSuccess(): Promise<void> {
  statusSubmitting.value = false
  await nextTick()
  statusVisible.value = false
}

async function finishRegionMutation(input: {
  confirmedAfterNetworkFailure: boolean
  kind: 'create' | 'disable' | 'enable' | 'update'
  region: RegionDto
  surface: 'form' | 'status'
}): Promise<void> {
  if (input.surface === 'form') {
    await closeFormAfterSuccess()
  }
  else {
    await closeStatusAfterSuccess()
  }

  /*
   * mutation 已经成功后，各展示副作用不能反向改变结论：Selector provider
   * 内部保证失效通知隔离，列表/导航加载也各自在局部 error surface 收敛失败。
   */
  invalidateRegionSelectorCache({ broadcast: true })
  if (!canRead.value) {
    formTarget.value = null
    statusTarget.value = null
    return
  }
  const labels = {
    create: '地区已创建',
    disable: '地区已停用',
    enable: '地区已启用',
    update: '地区已更新',
  } as const
  toast.success(labels[input.kind], {
    description: input.confirmedAfterNetworkFailure
      ? `${input.region.name} 已通过最终状态核对确认。`
      : input.region.name,
  })
  await refreshAfterRegionMutation(input.region)
}

function applyKnownFormFailure(error: unknown): void {
  const failure = getRegionMutationFailure(error)
  formError.value = failure.message
  formRequestId.value = failure.requestId ?? null
  formFieldErrors.value = failure.fieldErrors
  formSubmitting.value = false
}

async function handleFormSubmit(submission: RegionFormSubmit): Promise<void> {
  if (
    !canRead.value
    || formSubmitting.value
    || !formVisible.value
    || submission.mode !== formMode.value
  ) {
    return
  }

  const operationScope = formScope.value
  const operationTarget = formTarget.value
  if (
    (submission.mode === 'create' && !canCreate.value)
    || (submission.mode === 'edit' && !canUpdate.value)
  ) {
    formError.value = '当前身份已无权执行该操作，请刷新页面后重试'
    return
  }
  if (submission.mode === 'edit' && operationTarget === null) {
    formError.value = '未找到待编辑地区，请关闭弹窗后重试'
    return
  }
  if (
    submission.mode === 'edit'
    && Object.keys(submission.value).length === 0
  ) {
    formError.value = '未检测到可提交的变更'
    return
  }

  resetFormFailure()
  formSubmitting.value = true
  let resolvedRegion: RegionDto | undefined
  let confirmedAfterNetworkFailure = false

  if (submission.mode === 'create') {
    const request: CreateRegionRequestDto = {
      ...submission.value,
      // parent/level 始终由打开弹窗时的 scope 推导，不信任展示组件回传的上下文。
      parentId: operationScope.id,
    }
    try {
      const response = await regionsApi.management.create(request)
      resolvedRegion = response.data
    }
    catch (error) {
      const failure = getRegionMutationFailure(error)
      if (!failure.unknownResult) {
        applyKnownFormFailure(error)
        return
      }
      if (!canRead.value) {
        formSubmitting.value = false
        return
      }
      resolvedRegion = await reconcileUnknownCreate(operationScope, request)
      if (resolvedRegion === undefined) {
        formError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
        formSubmitting.value = false
        return
      }
      confirmedAfterNetworkFailure = true
    }
  }
  else {
    const request = submission.value
    try {
      const response = await regionsApi.management.update(
        operationTarget!.id,
        request,
      )
      resolvedRegion = response.data
    }
    catch (error) {
      const failure = getRegionMutationFailure(error)
      if (!failure.unknownResult) {
        applyKnownFormFailure(error)
        return
      }
      if (!canRead.value) {
        formSubmitting.value = false
        return
      }
      resolvedRegion = await reconcileUnknownUpdate(
        operationTarget!.id,
        request,
      )
      if (resolvedRegion === undefined) {
        formError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
        formSubmitting.value = false
        return
      }
      confirmedAfterNetworkFailure = true
    }
  }

  await finishRegionMutation({
    confirmedAfterNetworkFailure,
    kind: submission.mode === 'create' ? 'create' : 'update',
    region: resolvedRegion,
    surface: 'form',
  })
}

async function handleStatusSubmit(
  request: RegionStatusChangeRequest,
): Promise<void> {
  const operationTarget = statusTarget.value
  if (
    !canRead.value
    || statusSubmitting.value
    || !statusVisible.value
    || operationTarget === null
    || request.regionId !== operationTarget.id
    || request.action !== statusAction.value
  ) {
    return
  }
  if (
    (request.action === 'enable' && !canEnable.value)
    || (request.action === 'disable' && !canDisable.value)
  ) {
    statusError.value = '当前身份已无权执行该操作，请刷新页面后重试'
    return
  }

  resetStatusFailure()
  statusSubmitting.value = true
  let resolvedRegion: RegionDto | undefined
  let confirmedAfterNetworkFailure = false

  try {
    const response = request.action === 'enable'
      ? await regionsApi.management.enable(request.regionId)
      : await regionsApi.management.disable(request.regionId)
    resolvedRegion = response.data.region
  }
  catch (error) {
    const failure = getRegionMutationFailure(error)
    if (!failure.unknownResult) {
      statusError.value = failure.message
      statusRequestId.value = failure.requestId
      statusSubmitting.value = false
      return
    }
    if (!canRead.value) {
      statusSubmitting.value = false
      return
    }
    resolvedRegion = await reconcileUnknownStatus(
      request.regionId,
      request.action === 'enable',
    )
    if (resolvedRegion === undefined) {
      statusError.value = UNKNOWN_MUTATION_RESULT_MESSAGE
      statusSubmitting.value = false
      return
    }
    confirmedAfterNetworkFailure = true
  }

  await finishRegionMutation({
    confirmedAfterNetworkFailure,
    kind: request.action,
    region: resolvedRegion,
    surface: 'status',
  })
}

function refreshAll(): void {
  void Promise.all([
    loadNavigation(),
    loadRegions(),
  ])
}

function clearMutationContexts(): void {
  formVisible.value = false
  statusVisible.value = false
  formTarget.value = null
  statusTarget.value = null
  formScope.value = createRootRegionScope()
  statusScope.value = createRootRegionScope()
  resetFormFailure()
  resetStatusFailure()
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    navigationAbortController?.abort()
    listAbortController?.abort()
    reconciliationAbortController?.abort()
    navigationRequestVersion += 1
    listRequestVersion += 1
    navigationLoading.value = false
    listLoading.value = false
    if (identityChanged || !nextCanRead) {
      /*
       * authEpoch 是强身份边界。即使新旧身份都可读，也不能让新身份继续看到或提交
       * 旧身份打开的表单；动态撤销 read 时同样立即移除全部 mutation 上下文。
       */
      clearMutationContexts()
    }

    if (!nextCanRead) {
      // 同一用户的权限集合变化不会推进 authEpoch；撤权时仍需立即清除已加载数据，
      // 并依靠 authorized response guard 阻止同一 tick 内到达的旧响应回写。
      navigation.value = []
      rows.value = []
      total.value = 0
      navigationError.value = ''
      listError.value = ''
      navigationRequestId.value = undefined
      listRequestId.value = undefined
      return
    }

    refreshAll()
  },
)

onMounted(() => {
  if (canRead.value) {
    refreshAll()
  }
})

onBeforeUnmount(() => {
  navigationRequestVersion += 1
  listRequestVersion += 1
  navigationAbortController?.abort()
  listAbortController?.abort()
  reconciliationAbortController?.abort()
  queryScheduler.dispose()
})
</script>

<template>
  <div class="region-management-page">
    <FaPageHeader
      title="地区管理"
      description="按国家/地区、省/州和城市三级结构查询地区主数据；搜索与筛选只作用于当前直属层级。"
    >
      <FaButton
        v-if="canRead && canCreate"
        @click="openCreate"
      >
        <FaIcon name="i-lucide:plus" />
        新增{{ targetLevelLabel }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权查看地区"
        description="当前身份缺少 regions:read 权限。"
        class="min-h-64"
      />

      <div
        v-else
        class="gap-5 grid min-w-0 md:grid-cols-[18rem_minmax(0,1fr)]"
      >
        <aside class="min-w-0 hidden md:pr-5 md:border-r md:border-border md:block">
          <RegionScopeTree
            :model-value="scope"
            :nodes="navigationTree"
            :loading="navigationLoading"
            :error="navigationError"
            :request-id="navigationRequestId"
            @retry="loadNavigation"
            @select="selectScope"
          />
        </aside>

        <section class="min-w-0" aria-labelledby="region-list-title">
          <div class="mb-4 flex flex-wrap gap-3 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-meta m-0">
                当前范围
              </p>
              <h2 id="region-list-title" class="qs-type-compact-title mb-0 mt-1 break-words">
                {{ scopePathLabel }}
              </h2>
              <p class="qs-type-meta mb-0 mt-1">
                正在查看直属{{ targetLevelLabel }}
              </p>
            </div>

            <FaButton
              variant="outline"
              class="max-w-full min-h-11 md:hidden"
              aria-controls="region-scope-drawer"
              :aria-expanded="scopeDrawerVisible"
              @click="scopeDrawerVisible = true"
            >
              <FaIcon name="i-lucide:network" />
              <span class="truncate">选择地区范围 · {{ scope.label }}</span>
            </FaButton>
          </div>

          <QsGenericTable
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:search="search"
            v-model:filters="filters"
            v-model:sorting="sorting"
            data-testid="region-table"
            row-key="id"
            :addable="false"
            :columns="columns"
            :data="rows"
            :empty-description="emptyDescription"
            :empty-title="emptyTitle"
            :error="listErrorDisplay"
            :filter-definitions="filterDefinitions"
            :loading="listLoading"
            :page-size-options="[20, 50, 100]"
            :search-placeholder="searchPlaceholder"
            :total="total"
            table-class="min-w-[1260px]"
            @filter-change="handleFilterChange"
            @pagination-change="handlePaginationChange"
            @retry="loadRegions"
            @search="scheduleQueryRefresh"
            @sorting-change="scheduleQueryRefresh"
          >
            <template #cell-name="{ row }">
              <div class="gap-0.5 grid min-w-0">
                <strong class="qs-type-body-medium break-words">
                  {{ row.original.name }}
                </strong>
                <span class="qs-type-meta break-words">
                  {{ row.original.englishName || '暂无英文名' }}
                </span>
              </div>
            </template>

            <template #cell-code="{ row }">
              <code class="qs-type-data-emphasis break-all">{{ row.original.code }}</code>
            </template>

            <template #cell-level="{ row }">
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ regionLevelLabel(row.original.level) }}
              </FaTag>
            </template>

            <template #cell-administrativeType="{ row }">
              <div class="gap-0.5 grid">
                <span>{{ administrativeTypeLabel(row.original.administrativeType) }}</span>
                <code class="qs-type-meta break-all">
                  {{ row.original.administrativeType }}
                </code>
              </div>
            </template>

            <template #cell-enabled="{ row }">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="row.original.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground'"
              >
                {{ ownStatusLabel(row.original.enabled) }}
              </FaTag>
            </template>

            <template #cell-effectiveStatus="{ row }">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="regionDisplayStatus(row.original) === 'EFFECTIVE'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : regionDisplayStatus(row.original) === 'SELF_DISABLED'
                    ? 'border-destructive/30 bg-destructive/5 text-destructive'
                    : 'border-border bg-muted text-muted-foreground'"
              >
                {{ regionDisplayStatusLabel(regionDisplayStatus(row.original)) }}
              </FaTag>
            </template>

            <template #cell-sortOrder="{ row }">
              <span class="qs-type-data tabular-nums">{{ row.original.sortOrder }}</span>
            </template>

            <template #cell-updatedAt="{ row }">
              <DateTimeDisplay :value="row.original.updatedAt" />
            </template>

            <template #actions="{ row: region }">
              <div
                v-if="regionActions(region).hasAny"
                class="flex flex-wrap gap-1 items-center"
              >
                <FaButton
                  v-if="regionActions(region).canEdit"
                  variant="ghost"
                  size="sm"
                  class="min-h-11 w-full md:min-h-8 md:w-auto"
                  :aria-label="`编辑地区 ${region.name}`"
                  @click="openEdit(region)"
                >
                  编辑
                </FaButton>
                <FaButton
                  v-if="regionActions(region).canEnable"
                  variant="ghost"
                  size="sm"
                  class="min-h-11 w-full md:min-h-8 md:w-auto"
                  :aria-label="`启用地区 ${region.name}`"
                  @click="openStatusChange(region, 'enable')"
                >
                  启用
                </FaButton>
                <FaButton
                  v-if="regionActions(region).canDisable"
                  variant="ghost"
                  size="sm"
                  class="text-destructive min-h-11 w-full md:min-h-8 md:w-auto"
                  :aria-label="`停用地区 ${region.name}`"
                  @click="openStatusChange(region, 'disable')"
                >
                  停用
                </FaButton>
              </div>
              <span v-else class="qs-type-meta">仅查看</span>
            </template>

            <template #mobile-row="{ columns: visibleColumns, row: region, rowNumber }">
              <div data-testid="region-card" class="gap-4 grid min-w-0">
                <div class="flex gap-3 min-w-0 items-start justify-between">
                  <div
                    v-if="hasVisibleTableColumn(visibleColumns, 'name')"
                    class="min-w-0"
                  >
                    <strong class="qs-type-body-medium block break-words">
                      {{ region.name }}
                    </strong>
                    <span
                      v-if="region.englishName"
                      class="qs-type-meta mt-0.5 block break-words"
                    >
                      {{ region.englishName }}
                    </span>
                  </div>
                  <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
                </div>

                <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'code')">
                    <dt class="qs-type-compact-label mb-1">
                      Code
                    </dt>
                    <dd class="qs-type-data-emphasis m-0 break-all">
                      {{ region.code }}
                    </dd>
                  </div>
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'level')">
                    <dt class="qs-type-compact-label mb-1">
                      层级
                    </dt>
                    <dd class="qs-type-body m-0">
                      {{ regionLevelLabel(region.level) }}
                    </dd>
                  </div>
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'administrativeType')">
                    <dt class="qs-type-compact-label mb-1">
                      行政类型
                    </dt>
                    <dd class="qs-type-body m-0 break-words">
                      {{ administrativeTypeLabel(region.administrativeType) }}
                    </dd>
                  </div>
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'sortOrder')">
                    <dt class="qs-type-compact-label mb-1">
                      排序
                    </dt>
                    <dd class="qs-type-data m-0 tabular-nums">
                      {{ region.sortOrder }}
                    </dd>
                  </div>
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'enabled')">
                    <dt class="qs-type-compact-label mb-1">
                      自身状态
                    </dt>
                    <dd class="qs-type-body m-0">
                      {{ ownStatusLabel(region.enabled) }}
                    </dd>
                  </div>
                  <div v-if="hasVisibleTableColumn(visibleColumns, 'effectiveStatus')">
                    <dt class="qs-type-compact-label mb-1">
                      有效状态
                    </dt>
                    <dd class="qs-type-body m-0">
                      {{ regionDisplayStatusLabel(regionDisplayStatus(region)) }}
                    </dd>
                  </div>
                  <div
                    v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')"
                    class="col-span-full max-[479px]:col-span-1"
                  >
                    <dt class="qs-type-compact-label mb-1">
                      更新时间
                    </dt>
                    <dd class="m-0">
                      <DateTimeDisplay :value="region.updatedAt" />
                    </dd>
                  </div>
                </dl>
              </div>
            </template>
          </QsGenericTable>
        </section>
      </div>
    </FaPageMain>

    <QsGenericDrawer
      v-model="scopeDrawerVisible"
      title="选择地区范围"
      description="选择后列表仅展示当前范围的直属下级。"
      placement="bottom"
      size="lg"
    >
      <div
        id="region-scope-drawer"
        class="pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <RegionScopeTree
          :model-value="scope"
          :nodes="navigationTree"
          :loading="navigationLoading"
          :error="navigationError"
          :request-id="navigationRequestId"
          @retry="loadNavigation"
          @select="selectScope"
        />
      </div>
    </QsGenericDrawer>

    <RegionFormModal
      v-if="canRead"
      :model-value="formVisible"
      :mode="formMode"
      :parent-id="formScope.id"
      :parent-path="formParentPath"
      :target-level="formTargetLevel"
      :region="formTarget"
      :submitting="formSubmitting"
      :error="formError"
      :request-id="formRequestId"
      :field-errors="formFieldErrors"
      @cancel="cancelForm"
      @submit="handleFormSubmit"
    />

    <RegionStatusChangeModal
      v-if="canRead"
      :model-value="statusVisible"
      :action="statusAction"
      :region="statusTarget"
      :ancestor-path="statusScope.path"
      :submitting="statusSubmitting"
      :error="statusError"
      :request-id="statusRequestId"
      @cancel="cancelStatusChange"
      @submit="handleStatusSubmit"
    />
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  /*
   * QsGenericTable 的骨架位于子组件内部；仅在本业务页关闭其无限 pulse，
   * 不改变共享表格的公共 API 或其他调用方视觉策略。
   */
  .region-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
