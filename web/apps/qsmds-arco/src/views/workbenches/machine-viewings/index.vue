<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingManualNotificationTextDto,
  MachineViewingStatusTransitionDto,
  UpdateMachineViewingDto,
} from '@/api/generated/types.gen'
import type { MachineViewingListQuery, MachineViewingStatusCountsQuery } from '@/api/modules/machine-viewings'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import { getApiClientFailureMessage } from '@/api/errors'
import machineViewingsApi from '@/api/modules/machine-viewings'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import {
  formatMachineViewingTime,
  isMachineViewingDateToday,
  MACHINE_VIEWING_MACHINE_TYPE_OPTIONS,
  MACHINE_VIEWING_SITE_OPTIONS,
} from '@/utils/machine-viewing-schedule'
import { MACHINE_VIEWING_STATUS_OPTIONS, machineViewingStatusMeta } from '@/utils/machine-viewing-status'
import { serverNowEpochMs } from '@/utils/server-clock'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import MachineViewingDetailDrawer from './machine-viewing-detail-drawer.vue'
import MachineViewingFeedbackModal from './machine-viewing-feedback-modal.vue'
import MachineViewingFormModal from './machine-viewing-form-modal.vue'

defineOptions({ name: 'QsPurchaseTransportMachineViewings' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()

const enabled = computed(() => auth('machine-viewings:read'))
const canCreate = computed(() => enabled.value && auth('machine-viewings:create'))
const canUpdate = computed(() => enabled.value && auth('machine-viewings:update'))
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const dateRange = shallowRef<CalendarDateRangeValue>({ start: undefined, end: undefined })
const statusView = ref<'ALL' | MachineViewingDto['status']>('ALL')
const items = ref<MachineViewingDto[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const statusCounts = ref<Partial<Record<string, number>>>({})
const countsLoaded = ref(false)
const countsError = ref('')

const open = ref(false)
const editingRecord = ref<MachineViewingDto | null>(null)
const createKey = ref('')
const creating = ref(false)
const updating = ref(false)
const createError = ref('')
const updateError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const feedbackOpen = ref(false)
const feedbackRecord = ref<MachineViewingDto | null>(null)
const detailOpen = ref(false)
const detailRecord = ref<MachineViewingDto | null>(null)

const statusAction = ref<'FEEDBACK_GIVEN' | 'CANCELLED' | null>(null)
const statusRecord = ref<MachineViewingDto | null>(null)
const statusFeedback = ref('')
const statusReason = ref('')
const statusSubmitting = ref(false)
const statusError = ref('')

const manualOpen = ref(false)
const manualRecord = ref<MachineViewingDto | null>(null)
const manualText = ref<MachineViewingManualNotificationTextDto | null>(null)
const manualLoading = ref(false)
const manualCopying = ref(false)
const manualError = ref('')
const manualDisplayText = computed(() => {
  if (manualText.value === null) {
    return ''
  }
  return [manualText.value.title, manualText.value.body]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n\n')
})

let controller: AbortController | null = null
let countsController: AbortController | null = null

const columns = computed<QsGenericTableColumn<MachineViewingDto>[]>(() => [
  {
    id: 'appointmentNo',
    accessorKey: 'appointmentNo',
    title: t('machineViewing.column.appointmentNo'),
    width: 168,
    minWidth: 168,
    fixed: 'left',
    copyable: true,
    copyMode: 'text',
    cellClass: 'qs-type-data-emphasis',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  {
    id: 'appointmentTime',
    accessorFn: row => formatMachineViewingTime(t, row),
    title: t('machineViewing.column.appointmentTime'),
    minWidth: 168,
    cellClass: 'qs-type-data-emphasis',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  {
    id: 'status',
    accessorFn: row => t(machineViewingStatusMeta(row.status).labelKey),
    title: t('machineViewing.column.status'),
    minWidth: 104,
  },
  { id: 'customerName', accessorKey: 'customerName', title: t('machineViewing.column.customerName'), minWidth: 132 },
  {
    id: 'customerPhone',
    accessorFn: row => row.customerPhone ?? t('machineViewing.noPhone'),
    title: t('machineViewing.column.customerPhone'),
    minWidth: 148,
    cellClass: 'qs-type-data',
  },
  {
    id: 'site',
    accessorFn: row => t(`machineViewing.site.${row.site}`),
    title: t('machineViewing.column.site'),
    minWidth: 116,
  },
  {
    id: 'machineType',
    accessorFn: row => t(`machineViewing.machineType.${row.machineType}`),
    title: t('machineViewing.column.machineType'),
    minWidth: 116,
  },
  { id: 'contactPerson', accessorKey: 'contactPerson', title: t('machineViewing.column.contactPerson'), minWidth: 120 },
  {
    id: 'feedback',
    accessorFn: row => row.feedback ?? '',
    title: t('machineViewing.column.feedback'),
    width: 112,
    minWidth: 112,
    align: 'center',
  },
  {
    id: 'submitted',
    accessorFn: row => `${row.createdBy.name} ${row.createdAt}`,
    title: t('machineViewing.column.submitted'),
    minWidth: 176,
  },
])

const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [
  {
    key: 'site',
    label: t('machineViewing.column.site'),
    options: MACHINE_VIEWING_SITE_OPTIONS.map(value => ({ value, label: t(`machineViewing.site.${value}`) })),
  },
  {
    key: 'machineType',
    label: t('machineViewing.column.machineType'),
    options: MACHINE_VIEWING_MACHINE_TYPE_OPTIONS.map(value => ({ value, label: t(`machineViewing.machineType.${value}`) })),
  },
])

/** 状态切换的数量只在首次成功加载后展示，避免请求失败时把 0 当成真实数量。 */
const statusTabs = computed<QsStatusSwitchItem[]>(() => [
  {
    value: 'ALL',
    label: t('machineViewing.filters.allStatuses'),
    ...(countsLoaded.value ? { count: statusCounts.value.ALL ?? 0 } : {}),
  },
  ...MACHINE_VIEWING_STATUS_OPTIONS.map(value => ({
    value,
    label: t(machineViewingStatusMeta(value).labelKey),
    ...(countsLoaded.value ? { count: statusCounts.value[value] ?? 0 } : {}),
  })),
])

// 操作列最多两个直显按钮，按「两个 4 字按钮 + 更多图标」计算最大宽度。
const actionColumnWidth = Math.max(
  resolveActionColumnWidth([
    { kind: 'text', chars: 2 },
    { kind: 'icon' },
  ]),
  resolveActionColumnWidth([
    { kind: 'text', chars: 4 },
    { kind: 'text', chars: 4 },
    { kind: 'icon' },
  ]),
)
const formSubmitting = computed(() => creating.value || updating.value)
const formError = computed(() => editingRecord.value === null ? createError.value : updateError.value)
const statusModalOpen = computed({
  get: () => statusAction.value !== null,
  set: (value: boolean) => {
    if (!value && !statusSubmitting.value) {
      statusAction.value = null
      statusRecord.value = null
    }
  },
})
const statusModalTitle = computed(() => statusAction.value === 'CANCELLED'
  ? t('machineViewing.cancel.title')
  : t('machineViewing.feedback.formTitle'))
const statusConfirmLabel = computed(() => statusAction.value === 'CANCELLED'
  ? t('machineViewing.cancel.confirm')
  : t('machineViewing.feedback.save'))

function filterValue(key: string): string | undefined {
  const value = filters.value[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function listQuery(): MachineViewingListQuery {
  const dateFrom = dateRange.value.start?.toString()
  const dateTo = dateRange.value.end?.toString()
  return {
    page: page.value,
    pageSize: pageSize.value,
    ...(keyword.value.trim() === '' ? {} : { keyword: keyword.value.trim() }),
    ...(statusView.value === 'ALL' ? {} : { status: statusView.value }),
    ...(filterValue('site') === undefined ? {} : { site: filterValue('site') as NonNullable<MachineViewingListQuery['site']> }),
    ...(filterValue('machineType') === undefined ? {} : { machineType: filterValue('machineType') as NonNullable<MachineViewingListQuery['machineType']> }),
    ...(dateFrom === undefined ? {} : { dateFrom }),
    ...(dateTo === undefined ? {} : { dateTo }),
  }
}

/** 状态计数不带状态与分页，其余筛选与列表完全一致。 */
function statusCountsQuery(): MachineViewingStatusCountsQuery {
  const { page: _page, pageSize: _pageSize, status: _status, ...query } = listQuery()
  return query
}

/** 查询条件变化后回到第一页并同时刷新状态数量。 */
function applyFilters(): void {
  if (!enabled.value) {
    return
  }
  void loadStatusCounts()
  if (page.value !== 1) {
    page.value = 1
    return
  }
  void load()
}

function selectStatusView(value: string): void {
  if (value !== 'ALL' && !(MACHINE_VIEWING_STATUS_OPTIONS as readonly string[]).includes(value)) {
    return
  }
  statusView.value = value as 'ALL' | MachineViewingDto['status']
  page.value = 1
  void load()
}

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  try {
    const response = await machineViewingsApi.list(listQuery(), request.signal)
    if (!request.signal.aborted && controller === request) {
      items.value = response.data.items
      total.value = response.data.total
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      loadError.value = getApiClientFailureMessage(failure, t('machineViewing.loadFailed'))
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

async function loadStatusCounts(): Promise<void> {
  countsController?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  countsController = request
  countsError.value = ''
  try {
    const response = await machineViewingsApi.statusCounts(statusCountsQuery(), request.signal)
    if (!request.signal.aborted && countsController === request) {
      statusCounts.value = Object.fromEntries(
        response.data.statuses.map(item => [item.value, item.count]),
      )
      countsLoaded.value = true
    }
  }
  catch (failure) {
    if (!request.signal.aborted && countsController === request) {
      countsError.value = getApiClientFailureMessage(failure, t('machineViewing.statusCountsFailed'))
    }
  }
  finally {
    if (countsController === request) {
      countsController = null
    }
  }
}

function openCreate(): void {
  if (!canCreate.value) {
    return
  }
  editingRecord.value = null
  createKey.value = crypto.randomUUID()
  creating.value = false
  updating.value = false
  createError.value = ''
  updateError.value = ''
  fieldErrors.value = {}
  open.value = true
}

function openEdit(row: MachineViewingDto): void {
  if (!canUpdate.value) {
    return
  }
  editingRecord.value = row
  creating.value = false
  updating.value = false
  createError.value = ''
  updateError.value = ''
  fieldErrors.value = {}
  open.value = true
}

/** 服务端返回的逐字段错误取首条，交给弹窗挂到对应控件上。 */
function readFieldErrors(failure: unknown): Record<string, string> {
  const body = (failure as { body?: { fieldErrors?: Record<string, string[]> } } | null)?.body
  return Object.fromEntries(
    Object.entries(body?.fieldErrors ?? {}).map(([field, messages]) => [field, messages[0] ?? '']),
  )
}

function unknownResult(failure: unknown): boolean {
  const candidate = failure as { kind?: string, status?: number } | null
  return candidate?.kind === 'network'
    || candidate?.status === undefined
    || candidate.status >= 500
}

async function submitForm(payload: CreateMachineViewingDto | UpdateMachineViewingDto): Promise<void> {
  if (creating.value || updating.value) {
    return
  }
  const record = editingRecord.value
  if (record === null) {
    await submitCreate(payload as CreateMachineViewingDto)
    return
  }
  updating.value = true
  updateError.value = ''
  fieldErrors.value = {}
  const request = new AbortController()
  try {
    await machineViewingsApi.update(record.id, payload as UpdateMachineViewingDto, request.signal)
    toast.success(t('machineViewing.edit.saved'))
    // QsGenericModal 在 submitting 期间会拒绝受控关闭并回写 true；先释放 busy 再关。
    updating.value = false
    await nextTick()
    open.value = false
    await Promise.all([load(), loadStatusCounts()])
  }
  catch (failure) {
    updateError.value = getApiClientFailureMessage(failure, t('machineViewing.edit.saveFailed'))
    fieldErrors.value = readFieldErrors(failure)
  }
  finally {
    updating.value = false
  }
}

async function submitCreate(payload: CreateMachineViewingDto): Promise<void> {
  if (creating.value) {
    return
  }
  creating.value = true
  createError.value = ''
  fieldErrors.value = {}
  const request = new AbortController()
  try {
    await machineViewingsApi.create(payload, createKey.value, request.signal)
    toast.success(t('machineViewing.created'))
    // QsGenericModal 在 submitting 期间会拒绝受控关闭并回写 true；先释放 busy 再关。
    creating.value = false
    await nextTick()
    open.value = false
    page.value = 1
    await Promise.all([load(), loadStatusCounts()])
  }
  catch (failure) {
    createError.value = getApiClientFailureMessage(failure, t('machineViewing.saveFailed'))
    fieldErrors.value = readFieldErrors(failure)
    // 结果未知时保留同一把钥匙供人工重试；已知失败换新钥匙，改完内容可立即重提。
    if (!unknownResult(failure)) {
      createKey.value = crypto.randomUUID()
    }
  }
  finally {
    creating.value = false
  }
}

watch(() => account.authEpoch, () => {
  controller?.abort()
  countsController?.abort()
  controller = null
  countsController = null
  loading.value = false
  items.value = []
  total.value = 0
  statusCounts.value = {}
  countsLoaded.value = false
  countsError.value = ''
  statusView.value = 'ALL'
  open.value = false
  manualOpen.value = false
  keyword.value = ''
  filters.value = {}
  dateRange.value = { start: undefined, end: undefined }
  page.value = 1
})

watch([enabled, page, pageSize, () => account.authEpoch], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch([enabled, () => account.authEpoch], () => {
  if (enabled.value) {
    void loadStatusCounts()
  }
}, { immediate: true })

watch(open, (value) => {
  if (!value) {
    createError.value = ''
    updateError.value = ''
    fieldErrors.value = {}
  }
})

watch(manualOpen, (value) => {
  if (!value) {
    manualRecord.value = null
    manualText.value = null
    manualError.value = ''
  }
})

function openFeedback(row: MachineViewingDto): void {
  feedbackRecord.value = row
  feedbackOpen.value = true
}

function openDetail(row: MachineViewingDto): void {
  detailRecord.value = row
  detailOpen.value = true
}

/**
 * 行操作按状态给出有序动作；前两个直接显示，其余收进更多。
 *
 * 排序原则：先把当前状态最常做的业务动作放前面，详情永远最后。
 * - 今天待预约：手动标记、取消预约、编辑预约、查看详情
 * - 未来待预约：编辑预约、取消预约、查看详情
 * - 已预约：填写反馈、取消预约、编辑预约、查看详情
 * - 已反馈：修改反馈、查看详情
 * - 已取消：查看详情
 */
function rowActions(row: MachineViewingDto): ActionMenuItem[] {
  const actions: ActionMenuItem[] = []
  if (canUpdate.value) {
    if (row.status === 'PENDING_APPOINTMENT') {
      if (isTodayRow(row)) {
        actions.push({
          label: t('machineViewing.action.markManuallyShort'),
          icon: 'i-lucide:clipboard-check',
          handle: () => openManualNotification(row),
        })
      }
      actions.push({
        label: t('machineViewing.action.cancel'),
        icon: 'i-lucide:circle-x',
        variant: 'destructive',
        handle: () => openStatusAction('CANCELLED', row),
      })
      actions.push({
        label: t('machineViewing.action.edit'),
        icon: 'i-lucide:pencil',
        handle: () => openEdit(row),
      })
    }
    else if (row.status === 'APPOINTED') {
      actions.push({
        label: t('machineViewing.action.feedback'),
        icon: 'i-lucide:message-square-text',
        handle: () => openStatusAction('FEEDBACK_GIVEN', row),
      })
      actions.push({
        label: t('machineViewing.action.cancel'),
        icon: 'i-lucide:circle-x',
        variant: 'destructive',
        handle: () => openStatusAction('CANCELLED', row),
      })
      actions.push({
        label: t('machineViewing.action.edit'),
        icon: 'i-lucide:pencil',
        handle: () => openEdit(row),
      })
    }
    else if (row.status === 'FEEDBACK_GIVEN') {
      actions.push({
        label: t('machineViewing.action.editFeedback'),
        icon: 'i-lucide:pencil-line',
        handle: () => openStatusAction('FEEDBACK_GIVEN', row),
      })
    }
  }
  actions.push({
    label: t('machineViewing.action.detail'),
    icon: 'i-lucide:eye',
    handle: () => openDetail(row),
  })
  return actions
}

function directRowActions(row: MachineViewingDto): ActionMenuItem[] {
  return rowActions(row).slice(0, 2)
}

function overflowRowActions(row: MachineViewingDto): ActionMenuItem[][] {
  const actions = rowActions(row).slice(2)
  return actions.length === 0 ? [] : [actions]
}

function isTodayRow(row: MachineViewingDto): boolean {
  return isMachineViewingDateToday(row.appointmentDate, serverNowEpochMs())
}

function openManualNotification(row: MachineViewingDto): void {
  if (!canUpdate.value || row.status !== 'PENDING_APPOINTMENT' || !isTodayRow(row)) {
    return
  }
  manualRecord.value = row
  manualText.value = null
  manualError.value = ''
  manualLoading.value = false
  manualCopying.value = false
  manualOpen.value = true
  void loadManualText()
}

async function loadManualText(): Promise<void> {
  if (manualRecord.value === null || manualLoading.value) {
    return
  }
  manualLoading.value = true
  manualError.value = ''
  try {
    const response = await machineViewingsApi.manualNotificationText(
      manualRecord.value.id,
      new AbortController().signal,
    )
    manualText.value = response.data
  }
  catch (failure) {
    manualError.value = getApiClientFailureMessage(failure, t('machineViewing.manual.textFailed'))
  }
  finally {
    manualLoading.value = false
  }
}

async function copyAndMarkManual(): Promise<void> {
  if (manualRecord.value === null || manualText.value === null || manualCopying.value) {
    return
  }
  manualCopying.value = true
  manualError.value = ''
  try {
    if (!navigator.clipboard?.writeText) {
      manualError.value = t('machineViewing.manual.copyFailed')
      return
    }
    try {
      await navigator.clipboard.writeText(manualDisplayText.value)
    }
    catch {
      manualError.value = t('machineViewing.manual.copyFailed')
      return
    }
    await machineViewingsApi.markManuallyNotified(
      manualRecord.value.id,
      new AbortController().signal,
    )
    toast.success(t('machineViewing.manual.saved'))
    // QsGenericModal 在 submitting 期间会拒绝受控关闭；先释放 busy 再关闭。
    manualCopying.value = false
    await nextTick()
    manualOpen.value = false
    manualRecord.value = null
    await Promise.all([load(), loadStatusCounts()])
  }
  catch (failure) {
    manualError.value = getApiClientFailureMessage(failure, t('machineViewing.action.failed'))
  }
  finally {
    manualCopying.value = false
  }
}

function openStatusAction(action: 'FEEDBACK_GIVEN' | 'CANCELLED', row: MachineViewingDto): void {
  if (!canUpdate.value || statusSubmitting.value) {
    return
  }
  statusAction.value = action
  statusRecord.value = row
  statusFeedback.value = action === 'FEEDBACK_GIVEN' ? row.feedback ?? '' : ''
  statusReason.value = ''
  statusError.value = ''
}

async function submitStatusAction(): Promise<void> {
  if (statusAction.value === null || statusRecord.value === null || statusSubmitting.value) {
    return
  }
  const feedback = statusFeedback.value.trim()
  const reason = statusReason.value.trim()
  if (statusAction.value === 'FEEDBACK_GIVEN' && feedback === '') {
    statusError.value = t('machineViewing.feedback.required')
    return
  }
  const payload: MachineViewingStatusTransitionDto = {
    status: statusAction.value,
    ...(statusAction.value === 'FEEDBACK_GIVEN' ? { feedback } : {}),
    ...(statusAction.value === 'CANCELLED' && reason !== '' ? { cancelReason: reason } : {}),
  }
  statusSubmitting.value = true
  statusError.value = ''
  try {
    await machineViewingsApi.transitionStatus(statusRecord.value.id, payload, new AbortController().signal)
    const successKey = statusAction.value === 'CANCELLED'
      ? 'machineViewing.action.cancelled'
      : 'machineViewing.feedback.saved'
    toast.success(t(successKey))
    // QsGenericModal 在 submitting 期间会拒绝受控关闭；先释放 busy 再清空动作。
    statusSubmitting.value = false
    await nextTick()
    statusAction.value = null
    statusRecord.value = null
    await Promise.all([load(), loadStatusCounts()])
  }
  catch (failure) {
    statusError.value = getApiClientFailureMessage(failure, t('machineViewing.action.failed'))
  }
  finally {
    statusSubmitting.value = false
  }
}
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('machineViewing.title')" :description="t('machineViewing.description')">
      <FaButton v-if="canCreate" @click="openCreate">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        {{ t('machineViewing.create') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsStatusSwitchToolbar
        :model-value="statusView"
        :items="statusTabs"
        :aria-label="t('machineViewing.filters.statusView')"
        class="mb-4"
        @update:model-value="selectStatusView"
      />
      <FaAlert
        v-if="countsError"
        variant="destructive"
        :title="t('machineViewing.statusCountsFailed')"
        class="mb-4"
        role="alert"
      >
        <template #description>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{{ countsError }}</span>
            <FaButton variant="outline" size="sm" class="shrink-0 min-h-11 sm:min-h-8" @click="loadStatusCounts">
              {{ t('machineViewing.retry') }}
            </FaButton>
          </div>
        </template>
      </FaAlert>
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        v-model:filters="filters"
        row-key="id"
        :columns="columns"
        :data="items"
        :total="total"
        :loading="loading"
        :error="loadError || undefined"
        :addable="false"
        :page-size-options="[20, 50, 100]"
        :filter-definitions="filterDefinitions"
        :search-placeholder="t('machineViewing.filters.keywordPlaceholder')"
        :empty-title="t('machineViewing.empty')"
        :empty-description="t('machineViewing.emptyDescription')"
        :action-column="{ width: actionColumnWidth, minWidth: actionColumnWidth, fixed: 'right' }"
        table-class="w-max min-w-full"
        :aria-label="t('machineViewing.title')"
        @search="applyFilters"
        @filter-change="applyFilters"
        @pagination-change="load"
        @retry="load"
      >
        <template #query-leading>
          <QsDateRangeFilter
            v-model="dateRange"
            :calendar-label="t('machineViewing.filters.appointmentDate')"
            :placeholder="t('machineViewing.filters.appointmentDate')"
            @complete="applyFilters"
            @clear="applyFilters"
          />
        </template>
        <template #cell-status="{ row }">
          <span
            class="qs-type-tag px-2 py-0.5 border rounded-md whitespace-nowrap"
            :class="resolveStatusTagToneClass(machineViewingStatusMeta(row.original.status).tone)"
          >
            {{ t(machineViewingStatusMeta(row.original.status).labelKey) }}
          </span>
        </template>
        <template #cell-submitted="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.createdBy.name" size="sm" :avatar-url="row.original.createdBy.avatarUrl" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-feedback="{ row }">
          <FaButton
            v-if="row.original.feedback"
            variant="link"
            size="sm"
            class="px-0 min-h-11 sm:min-h-8"
            @click="openFeedback(row.original)"
          >
            {{ t('machineViewing.feedback.view') }}
          </FaButton>
          <span v-else class="text-muted-foreground">
            {{ t('machineViewing.feedback.none') }}
          </span>
        </template>
        <template #mobile-row="{ row }">
          <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
            <div class="qs-type-data-emphasis">
              {{ row.appointmentNo }}
            </div>
            <div class="flex gap-3 items-baseline justify-between">
              <span class="qs-type-data">{{ formatMachineViewingTime(t, row) }}</span>
              <span
                class="qs-type-tag px-2 py-0.5 border rounded-md whitespace-nowrap"
                :class="resolveStatusTagToneClass(machineViewingStatusMeta(row.status).tone)"
              >
                {{ t(machineViewingStatusMeta(row.status).labelKey) }}
              </span>
            </div>
            <dl class="space-y-2">
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.customerName') }}
                </dt>
                <dd>{{ row.customerName }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.customerPhone') }}
                </dt>
                <dd class="qs-type-data">
                  {{ row.customerPhone ?? t('machineViewing.noPhone') }}
                </dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.site') }}
                </dt>
                <dd>{{ t(`machineViewing.site.${row.site}`) }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.machineType') }}
                </dt>
                <dd>{{ t(`machineViewing.machineType.${row.machineType}`) }}</dd>
              </div>
              <div class="flex gap-3 items-baseline">
                <dt class="qs-type-meta text-muted-foreground shrink-0">
                  {{ t('machineViewing.column.contactPerson') }}
                </dt>
                <dd>{{ row.contactPerson }}</dd>
              </div>
            </dl>
            <div class="qs-type-meta text-muted-foreground pt-3 border-t border-border flex gap-2 items-center justify-between">
              <QsPersonDisplay :display-name="row.createdBy.name" size="sm" :avatar-url="row.createdBy.avatarUrl" />
              <DateTimeDisplay :value="row.createdAt" />
            </div>
            <div class="pt-3 border-t border-border flex gap-2 items-center justify-between">
              <span class="qs-type-meta text-muted-foreground">
                {{ t('machineViewing.column.feedback') }}
              </span>
              <FaButton
                v-if="row.feedback"
                variant="link"
                size="sm"
                class="px-0 min-h-11"
                @click="openFeedback(row)"
              >
                {{ t('machineViewing.feedback.view') }}
              </FaButton>
              <span v-else class="qs-type-meta text-muted-foreground">
                {{ t('machineViewing.feedback.none') }}
              </span>
            </div>
          </div>
        </template>
        <template #actions="{ row }">
          <FaButton
            v-for="action in directRowActions(row)"
            :key="action.label"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :class="action.variant === 'destructive' ? 'text-destructive' : undefined"
            :aria-label="`${row.appointmentNo}：${action.label}`"
            @click="action.handle()"
          >
            {{ action.label }}
          </FaButton>
          <FaDropdown v-if="overflowRowActions(row).length > 0" :items="overflowRowActions(row)" align="end">
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
              :aria-label="`${row.appointmentNo}：${t('machineViewing.action.more')}`"
            >
              <FaIcon name="i-lucide:ellipsis-vertical" class="size-4" aria-hidden="true" />
            </FaButton>
          </FaDropdown>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <MachineViewingFormModal
      v-model="open"
      :record="editingRecord"
      :submitting="formSubmitting"
      :error="formError || null"
      :field-errors="fieldErrors"
      @submit="submitForm"
    />
    <QsGenericModal
      v-model="statusModalOpen"
      :title="statusModalTitle"
      size="md"
      :submitting="statusSubmitting"
    >
      <template #header-leading>
        <FaIcon
          :name="statusAction === 'CANCELLED' ? 'i-lucide:circle-x' : 'i-lucide:message-square-text'"
          class="size-5"
          :class="statusAction === 'CANCELLED' ? 'text-destructive' : 'text-primary'"
          aria-hidden="true"
        />
      </template>
      <div class="min-w-0 space-y-4">
        <FaAlert
          v-if="statusError"
          variant="destructive"
          :title="t('machineViewing.action.failed')"
          :description="statusError"
          role="alert"
        />
        <p v-if="statusRecord" class="qs-type-meta text-muted-foreground m-0">
          {{ statusRecord.appointmentNo }} · {{ formatMachineViewingTime(t, statusRecord) }}
        </p>
        <div v-if="statusAction === 'FEEDBACK_GIVEN'">
          <label for="machine-viewing-status-feedback" class="text-sm font-medium">
            {{ t('machineViewing.feedback.content') }} <span class="text-destructive" aria-hidden="true">*</span>
          </label>
          <FaTextarea
            id="machine-viewing-status-feedback"
            v-model="statusFeedback"
            class="mt-2"
            :rows="4"
            :maxlength="500"
            :disabled="statusSubmitting"
            :placeholder="t('machineViewing.feedback.placeholder')"
          />
        </div>
        <div v-else>
          <label for="machine-viewing-cancel-reason" class="text-sm font-medium">
            {{ t('machineViewing.cancel.reason') }}
          </label>
          <FaTextarea
            id="machine-viewing-cancel-reason"
            v-model="statusReason"
            class="mt-2"
            :rows="3"
            :maxlength="500"
            :disabled="statusSubmitting"
            :placeholder="t('machineViewing.cancel.reasonPlaceholder')"
          />
        </div>
      </div>
      <template #footer>
        <FaButton variant="outline" class="w-full sm:w-auto" :disabled="statusSubmitting" @click="statusModalOpen = false">
          {{ t('machineViewing.form.cancel') }}
        </FaButton>
        <FaButton
          :variant="statusAction === 'CANCELLED' ? 'destructive' : 'default'"
          class="w-full sm:w-auto"
          :loading="statusSubmitting"
          :disabled="statusSubmitting"
          @click="submitStatusAction"
        >
          {{ statusConfirmLabel }}
        </FaButton>
      </template>
    </QsGenericModal>
    <QsGenericModal
      v-model="manualOpen"
      :title="t('machineViewing.manual.title')"
      size="lg"
      :submitting="manualCopying"
    >
      <template #header-leading>
        <FaIcon name="i-lucide:clipboard-check" class="text-primary size-5" aria-hidden="true" />
      </template>
      <div class="min-w-0 space-y-4">
        <FaAlert
          v-if="manualError"
          variant="destructive"
          :title="t('machineViewing.action.failed')"
          :description="manualError"
          role="alert"
        />
        <p v-if="manualRecord" class="qs-type-meta text-muted-foreground m-0">
          {{ manualRecord.appointmentNo }} · {{ formatMachineViewingTime(t, manualRecord) }} ·
          {{ manualRecord.customerName }}
        </p>
        <div v-if="manualLoading" class="qs-type-body text-muted-foreground py-8 text-center">
          {{ t('machineViewing.manual.loading') }}
        </div>
        <template v-else-if="manualText">
          <div>
            <div class="qs-type-meta text-muted-foreground">
              {{ t('machineViewing.manual.content') }}
            </div>
            <pre class="qs-type-body text-foreground m-0 mt-2 p-4 border border-border rounded-lg bg-muted/20 whitespace-pre-wrap break-words">{{ manualDisplayText }}</pre>
          </div>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('machineViewing.manual.hint') }}
          </p>
        </template>
        <div v-else class="space-y-3">
          <p class="qs-type-body text-muted-foreground m-0">
            {{ t('machineViewing.manual.empty') }}
          </p>
          <FaButton variant="outline" :disabled="manualLoading" @click="loadManualText">
            {{ t('machineViewing.retry') }}
          </FaButton>
        </div>
      </div>
      <template #footer>
        <FaButton variant="outline" class="w-full sm:w-auto" :disabled="manualCopying" @click="manualOpen = false">
          {{ t('machineViewing.form.cancel') }}
        </FaButton>
        <FaButton
          class="w-full sm:w-auto"
          :loading="manualCopying"
          :disabled="manualLoading || manualCopying || manualText === null"
          @click="copyAndMarkManual"
        >
          {{ t('machineViewing.manual.copyAndMark') }}
        </FaButton>
      </template>
    </QsGenericModal>
    <MachineViewingFeedbackModal v-model="feedbackOpen" :record="feedbackRecord" />
    <MachineViewingDetailDrawer v-model="detailOpen" :record="detailRecord" />
  </div>
</template>
