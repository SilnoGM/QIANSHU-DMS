<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { NumberingDetailAction, NumberingLifecycleAction } from './numbering-detail.logic'
import type { NumberingRuleEditorDrawerExpose } from './numbering-editor.logic'
import type { NumberingActionPermissions, NumberingRuleFormModel } from './numbering-management.logic'
import type { NumberingRuleDetailDto, NumberingRulePurposeCountDto } from '@/api/generated/types.gen'
import type { NumberingRuleListItemDto } from '@/api/modules/numbering'
import type { NumberingPurpose } from '@/api/modules/numbering-purpose'

import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import { useMediaQuery } from '@vueuse/core'
import numberingApi from '@/api/modules/numbering'
import { numberingPurposeLabel, parseNumberingPurpose } from '@/api/modules/numbering-purpose'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { withStatusSwitchCounts } from '@/components/business/QsStatusSwitchToolbar/logic'
import { hasVisibleTableColumn } from '../../shared/table-query'

import NumberingLifecycleModal from './numbering-lifecycle-modal.vue'
import {
  buildNumberingTableListQuery,
  canApplyNumberingRuleListResponse,
  formatNumberingRuleStructure,
  getNumberingListFailure,
  isNumberingAbortError,
  numberingResetPolicyLabel,
} from './numbering-list.logic'
import {
  formatNumberingDecimal,
  numberingPeriodStatusLabel,
  numberingRuleStatusLabel,
  resolveNumberingRuleActions,
} from './numbering-management.logic'
import {
  shouldCloseNumberingEditor,
  shouldLoadNumberingIssuances,
} from './numbering-page.logic'
import NumberingPurposeSelectModal from './numbering-purpose-select-modal.vue'
import NumberingRuleDetailDrawer from './numbering-rule-detail-drawer.vue'
import NumberingRuleEditorDrawer from './numbering-rule-editor-drawer.vue'
import { useNumberingMaintenance } from './use-numbering-maintenance'

defineOptions({ name: 'SystemBasicDataNumbering' })

type NumberingRowAction = NumberingDetailAction | 'detail'

interface PendingDetailEditorAction {
  action: Extract<NumberingDetailAction, 'clone' | 'edit'>
  detail: NumberingRuleDetailDto
}

interface PendingRowAction {
  action: NumberingRowAction
  rule: NumberingRuleListItemDto
}

const { auth } = useAppAuth()
const { t } = useI18n()
const appAccountStore = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const purposeView = computed(() => parseNumberingPurpose(route.query.purpose) ?? 'ALL')
const purposeCounts = ref<NumberingRulePurposeCountDto[] | null>(null)
const purposeChoices = [
  { value: 'ALL', label: '全部编码' },
  { value: 'BUSINESS', label: '业务编码' },
  { value: 'SHIPPING_MARK', label: '唛头编码' },
]
const purposeItems = computed(() => purposeCounts.value === null ? purposeChoices : withStatusSwitchCounts(purposeChoices, purposeCounts.value))
const purposeModalVisible = ref(false)
const createNavigationPending = ref(false)
const isNarrow = useMediaQuery('(max-width: 767px)')

const canRead = computed(() => auth('numbering-rules:read'))
const canCreate = computed(() => auth('numbering-rules:create'))
const canUpdate = computed(() => auth('numbering-rules:update'))
const canPublish = computed(() => auth('numbering-rules:publish'))
const canEnable = computed(() => auth('numbering-rules:enable'))
const canDisable = computed(() => auth('numbering-rules:disable'))
const canReadIssuances = computed(() => auth('numbering-rules:read-issuances'))
const permissions = computed<NumberingActionPermissions>(() => ({
  canCreate: canCreate.value,
  canDisable: canDisable.value,
  canEnable: canEnable.value,
  canPublish: canPublish.value,
  canRead: canRead.value,
  canReadIssuances: canReadIssuances.value,
  canUpdate: canUpdate.value,
}))
const rows = ref<NumberingRuleListItemDto[]>([])
const total = ref(0)
const page = ref(Math.max(1, Number(route.query.page) || 1))
const pageSize = ref([20, 50, 100].includes(Number(route.query.pageSize)) ? Number(route.query.pageSize) : 20)
const search = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const filters = ref<QsGenericTableFilterValues>({ status: typeof route.query.status === 'string' ? route.query.status : undefined })
const sorting = ref<TableSortingState>([
  { desc: route.query.sortOrder !== 'asc', id: 'updatedAt' },
])
const listLoading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshQueued = false
let listDisposed = false

const editorDrawerRef = useTemplateRef<NumberingRuleEditorDrawerExpose>('editorDrawerRef')
const discardConfirmVisible = ref(false)
const mobileActionsVisible = ref(false)
const mobileActionTarget = ref<NumberingRuleListItemDto | null>(null)
const pendingMobileAction = ref<PendingRowAction | null>(null)
const pendingDetailEditorAction = ref<PendingDetailEditorAction | null>(null)

async function reloadNumberingRules(resetPage = false): Promise<void> {
  if (resetPage) {
    page.value = 1
  }
  await loadNumberingRules()
}

const {
  clearDetailContext,
  clearEditorContext,
  clearIssuanceContext,
  clearLifecycleContext,
  clearMaintenanceContexts,
  detail,
  detailActionError,
  detailActionRequestId,
  detailError,
  detailLoading,
  detailRequestId,
  detailVisible,
  editorError,
  editorFieldErrors,
  editorFormModel,
  editorLoading,
  editorMode,
  editorPreview,
  editorPreviewError,
  editorPreviewLoading,
  editorPreviewRequestId,
  editorRequestId,
  editorRule,
  editorSubmitting,
  editorVisible,
  issuanceFilters,
  issuances,
  issuancesError,
  issuancesLoading,
  issuancesPage,
  issuancesPageSize,
  issuancesRequestId,
  issuancesTotal,
  lifecycleAction,
  lifecycleDetail,
  lifecycleError,
  lifecycleRequestId,
  lifecycleSubmitting,
  lifecycleVisible,
  loadDetail,
  loadIssuances,
  loadVersions,
  openDetail,
  openLifecycle,
  openRuleEditor,
  requestPreview,
  submitEditor,
  submitLifecycle,
  updateEditorFormModel,
  versions,
  versionsError,
  versionsLoading,
  versionsPage,
  versionsPageSize,
  versionsRequestId,
  versionsTotal,
} = useNumberingMaintenance(permissions, {
  reloadList: reloadNumberingRules,
})

const editorConfigurationLocked = computed(() => editorMode.value === 'clone')
const editorHasIssuances = computed(() =>
  editorRule.value !== null
  && editorRule.value.statistics.lifetimeUsedCount !== '0')
const mobileDrawerTitle = computed(() => mobileActionTarget.value === null
  ? '编号规则操作'
  : `编号规则操作 · ${mobileActionTarget.value.name}`)

const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`)

const columns: QsGenericTableColumn<NumberingRuleListItemDto>[] = [
  {
    accessorFn: item => item.name,
    id: 'rule',
    minWidth: 220,
    title: '编号规则',
  },
  {
    accessorFn: item => numberingPurposeLabel(item.purpose),
    id: 'purpose',
    minWidth: 120,
    title: '用途分类',
  },
  {
    accessorFn: item => formatNumberingRuleStructure(item.displayVersion.config),
    id: 'structure',
    minWidth: 340,
    title: '编号结构',
  },
  {
    accessorKey: 'status',
    id: 'status',
    title: '状态',
    width: 100,
  },
  {
    id: 'revision',
    title: '版本',
    width: 130,
  },
  {
    accessorFn: item => item.statistics.capacity,
    align: 'right',
    id: 'capacity',
    minWidth: 150,
    title: '容量',
  },
  {
    accessorFn: item => item.statistics.usedCount,
    align: 'right',
    id: 'usedCount',
    minWidth: 140,
    title: '已使用',
  },
  {
    accessorFn: item => item.statistics.remainingCount,
    align: 'right',
    id: 'remainingCount',
    minWidth: 140,
    title: '剩余',
  },
  {
    accessorFn: item => item.statistics.nextNumberPreview,
    id: 'nextNumber',
    minWidth: 230,
    title: '下一编号',
  },
  {
    accessorKey: 'updatedAt',
    enableMultiSort: false,
    id: 'updatedAt',
    minWidth: 190,
    sortable: true,
    title: '更新时间',
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '规则状态',
    options: [
      { label: '草稿', value: 'DRAFT' },
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' },
    ],
  },
]

interface NumberingActionMenuItem {
  handle: () => void
  label: string
  variant?: 'default' | 'destructive'
}

function ruleActions(rule: NumberingRuleListItemDto) {
  return resolveNumberingRuleActions(rule, permissions.value)
}

function closeMobileActions(): void {
  pendingMobileAction.value = null
  mobileActionsVisible.value = false
}

function openMobileActions(rule: NumberingRuleListItemDto): void {
  mobileActionTarget.value = rule
  mobileActionsVisible.value = true
}

function performRuleAction(
  rule: NumberingRuleListItemDto,
  action: NumberingRowAction,
): void {
  if (action === 'detail') {
    openDetail(rule)
    return
  }
  if (action === 'edit' || action === 'clone') {
    openRuleEditor(rule, action)
    return
  }
  openLifecycle(rule, action)
}

function requestRuleAction(
  rule: NumberingRuleListItemDto,
  action: NumberingRowAction,
): void {
  if (mobileActionsVisible.value) {
    pendingMobileAction.value = { action, rule }
    mobileActionsVisible.value = false
    return
  }
  performRuleAction(rule, action)
}

async function handleMobileActionsClosed(): Promise<void> {
  mobileActionTarget.value = null
  const pending = pendingMobileAction.value
  pendingMobileAction.value = null
  if (pending !== null && permissions.value.canRead) {
    // 等待底部 Drawer 完成自身焦点恢复，再打开下一层业务上下文。
    await nextTick()
    await nextTick()
    performRuleAction(pending.rule, pending.action)
  }
}

function handleDetailDrawerAction(
  action: NumberingDetailAction,
  selected: NumberingRuleDetailDto,
): void {
  if (action === 'edit' || action === 'clone') {
    pendingDetailEditorAction.value = { action, detail: selected }
    detailVisible.value = false
    return
  }
  openLifecycle(selected, action)
}

async function handleDetailClosed(): Promise<void> {
  const pending = pendingDetailEditorAction.value
  pendingDetailEditorAction.value = null
  clearDetailContext()
  if (pending !== null) {
    // QsGenericDrawer 在 closed 后的 nextTick 恢复 opener；随后再打开 editor。
    await nextTick()
    await nextTick()
    openRuleEditor(pending.detail, pending.action)
  }
}

function moreActionItems(rule: NumberingRuleListItemDto): NumberingActionMenuItem[][] {
  const actions = ruleActions(rule)
  const items: NumberingActionMenuItem[] = []
  if (actions.canClone) {
    items.push({
      handle: () => requestRuleAction(rule, 'clone'),
      label: '克隆',
    })
  }
  if (actions.canPublish) {
    items.push({
      handle: () => requestRuleAction(rule, 'publish'),
      label: '发布',
    })
  }
  if (actions.canEnable) {
    items.push({
      handle: () => requestRuleAction(rule, 'enable'),
      label: '启用',
    })
  }
  if (actions.canDisable) {
    items.push({
      handle: () => requestRuleAction(rule, 'disable'),
      label: '停用',
      variant: 'destructive',
    })
  }
  return [items]
}

function hasMoreAction(rule: NumberingRuleListItemDto): boolean {
  const actions = ruleActions(rule)
  return actions.canClone
    || actions.canPublish
    || actions.canEnable
    || actions.canDisable
}

function canRunLifecycleAction(
  action: NumberingLifecycleAction,
  currentPermissions: NumberingActionPermissions,
): boolean {
  return action === 'publish'
    ? currentPermissions.canPublish
    : action === 'enable'
      ? currentPermissions.canEnable
      : currentPermissions.canDisable
}

async function handleEditorSubmit(model: NumberingRuleFormModel): Promise<void> {
  if (!await submitEditor(model)) {
    return
  }
  // 先解除 composable 的提交锁，再让 Drawer 消费一次性 dirty bypass。
  await nextTick()
  editorDrawerRef.value?.closeWithoutDirtyGuard()
}

function requestDiscardConfirmation(): void {
  discardConfirmVisible.value = true
}

function handleEditorClosed(): void {
  if (!editorVisible.value) {
    clearEditorContext()
  }
}

async function discardEditorChanges(): Promise<void> {
  discardConfirmVisible.value = false
  /*
   * “放弃修改”是用户已经确认的业务动作，不能依赖 Modal 的退出动画回调。
   * 减少动画环境下同一个 Modal 重复打开时，closed 可能因动画状态去重而不再触发；
   * 先提交 Modal 的关闭状态，再用 Drawer 的一次性 bypass 确定性完成退出。
   */
  await nextTick()
  editorDrawerRef.value?.closeWithoutDirtyGuard()
}

function closeEditorForPermissionChange(): void {
  discardConfirmVisible.value = false
  editorDrawerRef.value?.closeForAuthorityLoss()
  clearEditorContext()
}

function handleLifecycleClosed(): void {
  if (!lifecycleVisible.value) {
    clearLifecycleContext()
  }
}

function listResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyNumberingRuleListResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: listRequestVersion,
    requestVersion,
  })
}

async function loadNumberingRules(): Promise<void> {
  if (listDisposed || !canRead.value) {
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
    const response = await numberingApi.rules.list(
      buildNumberingTableListQuery({
        filters: filters.value,
        page: page.value,
        pageSize: pageSize.value,
        purpose: purposeView.value,
        search: search.value,
        sorting: sorting.value,
      }),
      controller.signal,
    )
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    rows.value = response.data.items
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
    purposeCounts.value = response.data.purposeCounts
  }
  catch (error) {
    if (
      isNumberingAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getNumberingListFailure(error)
    purposeCounts.value = null
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      listLoading.value = false
    }
  }
}

/**
 * QsGenericTable 清除查询条件时会在同一轮更新多个 v-model；合并到一个微任务，
 * 避免同一份最终查询状态产生重复 GET。
 */
function scheduleQueryRefresh(): void {
  page.value = 1
  if (queryRefreshQueued) {
    return
  }
  queryRefreshQueued = true
  queueMicrotask(() => {
    queryRefreshQueued = false
    void loadNumberingRules()
  })
}

function handlePaginationChange(): void {
  void loadNumberingRules()
}

function clearListContext(): void {
  purposeCounts.value = null
  purposeModalVisible.value = false
  rows.value = []
  total.value = 0
  listError.value = ''
  listRequestId.value = undefined
  listLoading.value = false
}

function statusClass(item: NumberingRuleListItemDto): string {
  if (item.status === 'ENABLED') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (item.status === 'DRAFT') {
    return 'border-warning/30 bg-warning/10 text-warning'
  }
  return 'border-border bg-muted text-muted-foreground'
}

function revisionText(revision: number | null): string {
  return revision === null ? '—' : `R${revision}`
}

function statisticsPeriodLabel(item: NumberingRuleListItemDto): string {
  return item.statistics.periodKey === 'ALL'
    ? '全生命周期'
    : item.statistics.periodKey
}

function nextNumberText(item: NumberingRuleListItemDto): string {
  if (item.statistics.periodStatus === 'EXHAUSTED') {
    return '容量已用尽'
  }
  return item.statistics.nextNumberPreview ?? '暂不可预览'
}

function nextNumberMeta(item: NumberingRuleListItemDto): string {
  if (item.statistics.periodStatus === 'EXHAUSTED') {
    return numberingPeriodStatusLabel(item.statistics.periodStatus)
  }
  const previewKind = item.statistics.nextNumberDeterministic
    ? '确定下一编号'
    : '随机预览'
  return item.statistics.nextSequenceValue === null
    ? previewKind
    : `${previewKind} · 序列 ${item.statistics.nextSequenceValue}`
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listAbortController?.abort()
    listRequestVersion += 1

    if (identityChanged || !nextCanRead) {
      clearListContext()
    }
    if (!nextCanRead) {
      return
    }

    page.value = 1
    void loadNumberingRules()
  },
)

watch(
  () => ({
    authEpoch: appAccountStore.authEpoch,
    canCreate: canCreate.value,
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canPublish: canPublish.value,
    canRead: canRead.value,
    canReadIssuances: canReadIssuances.value,
    canUpdate: canUpdate.value,
  }),
  (next, previous) => {
    const identityChanged = next.authEpoch !== previous.authEpoch
    const nextPermissions: NumberingActionPermissions = next

    if (identityChanged || !next.canRead) {
      closeMobileActions()
      pendingDetailEditorAction.value = null
      discardConfirmVisible.value = false
      if (editorVisible.value) {
        editorDrawerRef.value?.closeForAuthorityLoss()
      }
      clearMaintenanceContexts()
      return
    }

    if (
      editorVisible.value
      && shouldCloseNumberingEditor(editorMode.value, nextPermissions)
    ) {
      closeEditorForPermissionChange()
      void reloadNumberingRules(false)
    }
    if (!shouldLoadNumberingIssuances(nextPermissions)) {
      clearIssuanceContext()
    }
    if (
      lifecycleVisible.value
      && !canRunLifecycleAction(lifecycleAction.value, nextPermissions)
    ) {
      clearLifecycleContext()
      void reloadNumberingRules(false)
    }
    // 移动端操作面板不保留旧权限快照，权限变化后要求用户重新选择。
    closeMobileActions()
  },
)

// 取消新增时恢复进入前的条件；成功返回仅携带用途，避免旧筛选隐藏新草稿。
function listContextQuery() {
  return {
    purpose: purposeView.value,
    page: String(page.value),
    pageSize: String(pageSize.value),
    keyword: search.value || undefined,
    status: typeof filters.value.status === 'string' ? filters.value.status : undefined,
    sortOrder: sorting.value[0]?.desc === false ? 'asc' : 'desc',
  }
}
async function switchPurpose(value: string): Promise<void> {
  if (!canRead.value || value === purposeView.value) {
    return
  }
  await router.replace({ query: { ...listContextQuery(), purpose: parseNumberingPurpose(value) ?? 'ALL', page: '1' } })
}
async function startCreate(purpose: NumberingPurpose): Promise<void> {
  if (!canRead.value || !canCreate.value || createNavigationPending.value) {
    return
  }
  createNavigationPending.value = true
  try {
    const returnTo = router.resolve({ name: 'systemBasicDataNumbering', query: listContextQuery() }).fullPath
    await router.push({ name: 'systemBasicDataNumberingCreate', query: { purpose, returnTo } })
    purposeModalVisible.value = false
  }
  finally { createNavigationPending.value = false }
}
watch(() => route.query.purpose, () => {
  purposeCounts.value = null
  scheduleQueryRefresh()
})

onMounted(() => {
  if (canRead.value) {
    void loadNumberingRules()
  }
})

onBeforeUnmount(() => {
  listDisposed = true
  listRequestVersion += 1
  listAbortController?.abort()
  clearMaintenanceContexts()
})
</script>

<template>
  <div class="numbering-management-page min-w-0">
    <FaPageHeader
      description="集中查看后续业务域的编号结构、规则状态、版本与当前周期容量；所有时间均按 Asia/Shanghai 展示。"
      default-class="max-w-full flex flex-wrap gap-3 items-center justify-end"
    >
      <template #title>
        <h1 class="m-0">
          编号管理
        </h1>
      </template>

      <FaButton
        v-if="auth('purchase-shipping-marks:read')"
        data-testid="shipping-mark-bindings-entry"
        variant="outline"
        @click="router.push({ name: 'systemBasicDataShippingMarkBindings' })"
      >
        <FaIcon name="i-lucide:link" />
        {{ t('shippingMarkBinding.entryLabel') }}
      </FaButton>
      <FaButton
        v-if="canRead && canCreate"
        data-testid="numbering-create-rule"
        class="min-h-11 md:min-h-9"
        @click="purposeModalVisible = true"
      >
        <FaIcon name="i-lucide:plus" />
        新建规则
      </FaButton>
    </FaPageHeader>

    <NumberingPurposeSelectModal v-if="canRead && canCreate" v-model="purposeModalVisible" :loading="createNavigationPending" @confirm="startCreate" />

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权查看编号规则"
        description="当前身份缺少 numbering-rules:read 权限。"
        class="min-h-64"
      />

      <section v-else class="min-w-0" aria-label="编号规则列表与容量统计">
        <QsStatusSwitchToolbar
          :model-value="purposeView"
          :items="purposeItems"
          class="numbering-purpose-toolbar mb-4"
          @update:model-value="switchPurpose"
        />

        <div class="mb-4 flex flex-wrap gap-3 items-baseline justify-between">
          <p class="qs-type-description m-0 max-w-3xl">
            容量、已使用与剩余量均为精确整数；下一编号可能是确定值或随机预览。
          </p>
          <p class="qs-type-meta m-0 shrink-0">
            统计时区 · <code>Asia/Shanghai</code>
          </p>
        </div>

        <QsGenericTable
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:search="search"
          v-model:filters="filters"
          v-model:sorting="sorting"
          data-testid="numbering-rule-table"
          row-key="id"
          :addable="false"
          :action-column="{ align: 'right', title: '操作', width: 220 }"
          :columns="columns"
          :data="rows"
          empty-title="暂无编号规则"
          empty-description="当前还没有可展示的编号规则。"
          :error="listErrorDisplay"
          :filter-definitions="filterDefinitions"
          :loading="listLoading"
          :page-size-options="[20, 50, 100]"
          search-placeholder="搜索规则名称或 Rule Code"
          :total="total"
          table-class="min-w-[1740px]"
          @filter-change="scheduleQueryRefresh"
          @pagination-change="handlePaginationChange"
          @retry="loadNumberingRules"
          @search="scheduleQueryRefresh"
          @sorting-change="scheduleQueryRefresh"
        >
          <template #cell-rule="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <strong class="qs-type-body-medium break-words">
                {{ row.original.name }}
              </strong>
              <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
                {{ row.original.ruleCode }}
              </code>
              <span class="qs-type-meta break-words line-clamp-2">
                {{ row.original.description || '暂无说明' }}
              </span>
            </div>
          </template>

          <template #cell-structure="{ row }">
            <div class="gap-1 grid min-w-0">
              <code class="qs-type-data-mono whitespace-normal [overflow-wrap:anywhere]">
                {{ formatNumberingRuleStructure(row.original.displayVersion.config) }}
              </code>
              <span class="qs-type-meta break-words">
                {{ numberingResetPolicyLabel(row.original.displayVersion.config.resetPolicy) }}
                · {{ row.original.displayVersion.config.timezone }}
                · 最长 {{ row.original.displayVersion.config.maxOutputLength }} 位
              </span>
            </div>
          </template>

          <template #cell-status="{ row }">
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="statusClass(row.original)"
            >
              {{ numberingRuleStatusLabel(row.original.status) }}
            </FaTag>
          </template>

          <template #cell-revision="{ row }">
            <div class="gap-0.5 grid tabular-nums">
              <span class="qs-type-data">生效 {{ revisionText(row.original.activeRevision) }}</span>
              <span class="qs-type-meta">草稿 {{ revisionText(row.original.draftRevision) }}</span>
            </div>
          </template>

          <template #cell-capacity="{ row }">
            <div class="text-right gap-0.5 grid">
              <code class="qs-type-data-emphasis tabular-nums">
                {{ formatNumberingDecimal(row.original.statistics.capacity) }}
              </code>
              <span class="qs-type-meta">{{ statisticsPeriodLabel(row.original) }}</span>
            </div>
          </template>

          <template #cell-usedCount="{ row }">
            <code class="qs-type-data tabular-nums">
              {{ formatNumberingDecimal(row.original.statistics.usedCount) }}
            </code>
          </template>

          <template #cell-remainingCount="{ row }">
            <code class="qs-type-data-emphasis tabular-nums">
              {{ formatNumberingDecimal(row.original.statistics.remainingCount) }}
            </code>
          </template>

          <template #cell-nextNumber="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <code class="qs-type-data-emphasis whitespace-normal [overflow-wrap:anywhere]">
                {{ nextNumberText(row.original) }}
              </code>
              <span class="qs-type-meta break-words">
                {{ nextNumberMeta(row.original) }}
              </span>
            </div>
          </template>

          <template #cell-updatedAt="{ row }">
            <DateTimeDisplay
              :value="row.original.updatedAt"
              time-zone="Asia/Shanghai"
            />
          </template>

          <template #actions="{ row: item }">
            <FaButton
              v-if="isNarrow"
              class="min-h-11 w-full"
              variant="outline"
              size="sm"
              :aria-label="`编号规则操作 · ${item.name}`"
              @click="openMobileActions(item)"
            >
              操作
            </FaButton>
            <div v-else class="flex gap-1 items-center justify-end">
              <FaButton
                variant="ghost"
                size="sm"
                :aria-label="`查看详情 · ${item.name}`"
                @click="requestRuleAction(item, 'detail')"
              >
                查看详情
              </FaButton>
              <FaButton
                v-if="ruleActions(item).canEdit"
                variant="ghost"
                size="sm"
                :aria-label="`编辑 · ${item.name}`"
                @click="requestRuleAction(item, 'edit')"
              >
                编辑
              </FaButton>
              <FaDropdown
                v-if="hasMoreAction(item)"
                :items="moreActionItems(item)"
                align="end"
              >
                <FaButton
                  variant="ghost"
                  size="sm"
                  :aria-label="`更多操作 · ${item.name}`"
                >
                  更多
                  <FaIcon name="i-lucide:chevron-down" />
                </FaButton>
              </FaDropdown>
            </div>
          </template>

          <template #mobile-row="{ columns: visibleColumns, row: item, rowNumber }">
            <div data-testid="numbering-mobile-row" class="gap-4 grid min-w-0">
              <div class="flex gap-3 min-w-0 items-start justify-between">
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'rule')"
                  class="min-w-0"
                >
                  <strong class="qs-type-body-medium block break-words">
                    {{ item.name }}
                  </strong>
                  <code class="qs-type-data-emphasis block [overflow-wrap:anywhere]">
                    {{ item.ruleCode }}
                  </code>
                  <span v-if="item.description" class="qs-type-meta mt-1 block break-words">
                    {{ item.description }}
                  </span>
                </div>
                <div class="flex shrink-0 flex-col gap-1 items-end">
                  <FaTag
                    v-if="hasVisibleTableColumn(visibleColumns, 'status')"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="statusClass(item)"
                  >
                    {{ numberingRuleStatusLabel(item.status) }}
                  </FaTag>
                  <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                </div>
              </div>

              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'structure')"
                class="min-w-0"
              >
                <p class="qs-type-compact-label mb-1 mt-0">
                  编号结构
                </p>
                <code class="qs-type-data-mono block whitespace-normal [overflow-wrap:anywhere]">
                  {{ formatNumberingRuleStructure(item.displayVersion.config) }}
                </code>
                <span class="qs-type-meta mt-1 block break-words">
                  {{ numberingResetPolicyLabel(item.displayVersion.config.resetPolicy) }}
                  · {{ item.displayVersion.config.timezone }}
                  · 最长 {{ item.displayVersion.config.maxOutputLength }} 位
                </span>
              </div>

              <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-3 max-[390px]:grid-cols-1">
                <div v-if="hasVisibleTableColumn(visibleColumns, 'purpose')">
                  <dt class="qs-type-compact-label mb-1">
                    用途分类
                  </dt>
                  <dd class="qs-type-body m-0">
                    {{ numberingPurposeLabel(item.purpose) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'revision')">
                  <dt class="qs-type-compact-label mb-1">
                    版本
                  </dt>
                  <dd class="qs-type-data m-0 tabular-nums">
                    生效 {{ revisionText(item.activeRevision) }}
                    · 草稿 {{ revisionText(item.draftRevision) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'capacity')">
                  <dt class="qs-type-compact-label mb-1">
                    容量
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.capacity) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'usedCount')">
                  <dt class="qs-type-compact-label mb-1">
                    已使用
                  </dt>
                  <dd class="qs-type-data m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.usedCount) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'remainingCount')">
                  <dt class="qs-type-compact-label mb-1">
                    剩余
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.remainingCount) }}
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'nextNumber')"
                  class="col-span-2 min-w-0 max-[390px]:col-span-1"
                >
                  <dt class="qs-type-compact-label mb-1">
                    下一编号
                  </dt>
                  <dd class="m-0 min-w-0">
                    <code class="qs-type-data-emphasis block whitespace-normal [overflow-wrap:anywhere]">
                      {{ nextNumberText(item) }}
                    </code>
                    <span class="qs-type-meta mt-1 block break-words">
                      {{ nextNumberMeta(item) }} · {{ statisticsPeriodLabel(item) }}
                    </span>
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')"
                  class="col-span-full max-[390px]:col-span-1"
                >
                  <dt class="qs-type-compact-label mb-1">
                    更新时间
                  </dt>
                  <dd class="m-0">
                    <DateTimeDisplay
                      :value="item.updatedAt"
                      time-zone="Asia/Shanghai"
                    />
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
      content-class="h-[min(31rem,calc(100dvh-1.5rem))]"
      destroy-on-close
      @closed="handleMobileActionsClosed"
    >
      <div
        v-if="mobileActionTarget"
        data-testid="numbering-actions-drawer"
        class="pb-[max(0.75rem,env(safe-area-inset-bottom))] gap-3 grid"
      >
        <FaButton
          class="min-h-11 w-full"
          variant="outline"
          @click="requestRuleAction(mobileActionTarget, 'detail')"
        >
          查看详情
        </FaButton>
        <FaButton
          v-if="ruleActions(mobileActionTarget).canEdit"
          class="min-h-11 w-full"
          variant="outline"
          @click="requestRuleAction(mobileActionTarget, 'edit')"
        >
          编辑
        </FaButton>
        <FaButton
          v-if="ruleActions(mobileActionTarget).canClone"
          class="min-h-11 w-full"
          variant="outline"
          @click="requestRuleAction(mobileActionTarget, 'clone')"
        >
          克隆
        </FaButton>
        <FaButton
          v-if="ruleActions(mobileActionTarget).canPublish"
          class="min-h-11 w-full"
          @click="requestRuleAction(mobileActionTarget, 'publish')"
        >
          发布
        </FaButton>
        <FaButton
          v-if="ruleActions(mobileActionTarget).canEnable"
          class="min-h-11 w-full"
          @click="requestRuleAction(mobileActionTarget, 'enable')"
        >
          启用
        </FaButton>
        <FaButton
          v-if="ruleActions(mobileActionTarget).canDisable"
          class="min-h-11 w-full"
          variant="destructive"
          @click="requestRuleAction(mobileActionTarget, 'disable')"
        >
          停用
        </FaButton>
      </div>
    </FaDrawer>

    <NumberingRuleEditorDrawer
      ref="editorDrawerRef"
      v-model="editorVisible"
      :mode="editorMode"
      :form-model="editorFormModel"
      :configuration-locked="editorConfigurationLocked"
      :has-issuances="editorHasIssuances"
      :loading="editorLoading"
      :error="editorError"
      :field-errors="editorFieldErrors"
      :request-id="editorRequestId"
      :preview="editorPreview"
      :preview-loading="editorPreviewLoading"
      :preview-error="editorPreviewError"
      :preview-request-id="editorPreviewRequestId"
      :submitting="editorSubmitting"
      @update:form-model="updateEditorFormModel"
      @preview="requestPreview"
      @submit="handleEditorSubmit"
      @close-request="requestDiscardConfirmation"
      @closed="handleEditorClosed"
    />

    <NumberingRuleDetailDrawer
      v-model="detailVisible"
      :detail="detail"
      :detail-loading="detailLoading"
      :detail-error="detailError"
      :detail-request-id="detailRequestId ?? undefined"
      :versions="versions"
      :versions-loading="versionsLoading"
      :versions-error="versionsError"
      :versions-request-id="versionsRequestId ?? undefined"
      :versions-page="versionsPage"
      :versions-page-size="versionsPageSize"
      :versions-total="versionsTotal"
      :issuances="issuances"
      :issuances-loading="issuancesLoading"
      :issuances-error="issuancesError"
      :issuances-request-id="issuancesRequestId ?? undefined"
      :issuances-page="issuancesPage"
      :issuances-page-size="issuancesPageSize"
      :issuances-total="issuancesTotal"
      :issuance-filters="issuanceFilters"
      :permissions="permissions"
      :action-error="detailActionError"
      :action-request-id="detailActionRequestId ?? undefined"
      @reload-detail="loadDetail"
      @load-versions="loadVersions"
      @load-issuances="loadIssuances"
      @action="handleDetailDrawerAction"
      @closed="handleDetailClosed"
    />

    <NumberingLifecycleModal
      v-model="lifecycleVisible"
      :action="lifecycleAction"
      :detail="lifecycleDetail"
      :submitting="lifecycleSubmitting"
      :error-message="lifecycleError"
      :request-id="lifecycleRequestId ?? undefined"
      @confirm="submitLifecycle"
      @closed="handleLifecycleClosed"
    />

    <QsGenericModal
      v-model="discardConfirmVisible"
      title="放弃未保存修改？"
      description="当前编号规则表单仍有未保存内容。"
      size="sm"
      data-testid="numbering-discard-confirm"
    >
      <FaAlert
        icon="i-lucide:triangle-alert"
        title="修改不会被保留"
        description="放弃后，当前表单及尚未完成的预览请求会被清理。"
      />

      <template #footer>
        <FaButton
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          variant="outline"
          @click="discardConfirmVisible = false"
        >
          继续编辑
        </FaButton>
        <FaButton
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          variant="destructive"
          @click="discardEditorChanges"
        >
          放弃修改
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
/* 用途切换与列表共用面板；仅在当前页移除独立外框并对齐内容左沿。 */
.numbering-purpose-toolbar {
  padding-inline: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  .numbering-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
