<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type {
  CreateMachineViewingDto,
  MachineViewingDto,
  MachineViewingStatusTransitionDto,
  UpdateMachineViewingDto,
} from '@/api/generated/types.gen'
import type { MachineViewingListQuery } from '@/api/modules/machine-viewings'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
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
import {
  formatMachineViewingTime,
  MACHINE_VIEWING_MACHINE_TYPE_OPTIONS,
  MACHINE_VIEWING_SITE_OPTIONS,
} from '@/utils/machine-viewing-schedule'
import { MACHINE_VIEWING_STATUS_OPTIONS, machineViewingStatusMeta } from '@/utils/machine-viewing-status'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import MachineViewingDetailDrawer from './machine-viewing-detail-drawer.vue'
import MachineViewingFeedbackModal from './machine-viewing-feedback-modal.vue'
import MachineViewingFormModal from './machine-viewing-form-modal.vue'

defineOptions({ name: 'QsOperationsMachineViewings' })

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
const items = ref<MachineViewingDto[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

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

const statusAction = ref<'APPOINTED' | 'FEEDBACK_GIVEN' | 'CANCELLED' | null>(null)
const statusRecord = ref<MachineViewingDto | null>(null)
const statusFeedback = ref('')
const statusReason = ref('')
const statusSubmitting = ref(false)
const statusError = ref('')

let controller: AbortController | null = null

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
    key: 'status',
    label: t('machineViewing.column.status'),
    options: MACHINE_VIEWING_STATUS_OPTIONS.map(value => ({
      value,
      label: t(machineViewingStatusMeta(value).labelKey),
    })),
  },
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

// 操作列按「详情 + 更多菜单」的最大集合计算，筛选和权限变化时列宽不会跳动。
const actionColumnWidth = resolveActionColumnWidth([
  { kind: 'text', chars: 2 },
  { kind: 'icon' },
])
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
const statusModalTitle = computed(() => {
  if (statusAction.value === 'CANCELLED') {
    return t('machineViewing.cancel.title')
  }
  if (statusAction.value === 'APPOINTED') {
    return t('machineViewing.appoint.title')
  }
  return t('machineViewing.feedback.formTitle')
})
const statusConfirmLabel = computed(() => {
  if (statusAction.value === 'CANCELLED') {
    return t('machineViewing.cancel.confirm')
  }
  if (statusAction.value === 'APPOINTED') {
    return t('machineViewing.appoint.confirm')
  }
  return t('machineViewing.feedback.save')
})

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
    ...(filterValue('status') === undefined ? {} : { status: filterValue('status') as NonNullable<MachineViewingListQuery['status']> }),
    ...(filterValue('site') === undefined ? {} : { site: filterValue('site') as NonNullable<MachineViewingListQuery['site']> }),
    ...(filterValue('machineType') === undefined ? {} : { machineType: filterValue('machineType') as NonNullable<MachineViewingListQuery['machineType']> }),
    ...(dateFrom === undefined ? {} : { dateFrom }),
    ...(dateTo === undefined ? {} : { dateTo }),
  }
}

/** 查询条件变化后回到第一页；page 已经变化时交给 watch 触发，避免重复请求。 */
function applyFilters(): void {
  if (!enabled.value) {
    return
  }
  if (page.value !== 1) {
    page.value = 1
    return
  }
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
    await load()
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
    await load()
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
  controller = null
  loading.value = false
  items.value = []
  total.value = 0
  open.value = false
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

watch(open, (value) => {
  if (!value) {
    createError.value = ''
    updateError.value = ''
    fieldErrors.value = {}
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
 * 状态、反馈、编辑、取消都只对「待预约/已预约」开放；已反馈只能改反馈，
 * 已取消完全锁定。后端仍会按行锁复核，这里只负责不展示无效入口。
 */
function businessActions(row: MachineViewingDto): ActionMenuItem[][] {
  if (!canUpdate.value) {
    return []
  }
  const items: ActionMenuItem[] = []
  if (row.status === 'PENDING_APPOINTMENT') {
    items.push({
      label: t('machineViewing.action.markAppointed'),
      icon: 'i-lucide:calendar-check',
      handle: () => openStatusAction('APPOINTED', row),
    })
  }
  if (row.status === 'APPOINTED') {
    items.push({
      label: t('machineViewing.action.feedback'),
      icon: 'i-lucide:message-square-text',
      handle: () => openStatusAction('FEEDBACK_GIVEN', row),
    })
  }
  if (row.status === 'FEEDBACK_GIVEN') {
    items.push({
      label: t('machineViewing.action.editFeedback'),
      icon: 'i-lucide:pencil-line',
      handle: () => openStatusAction('FEEDBACK_GIVEN', row),
    })
  }
  if (row.status === 'PENDING_APPOINTMENT' || row.status === 'APPOINTED') {
    items.push({
      label: t('machineViewing.action.edit'),
      icon: 'i-lucide:pencil',
      handle: () => openEdit(row),
    })
    items.push({
      label: t('machineViewing.action.cancel'),
      icon: 'i-lucide:circle-x',
      variant: 'destructive',
      handle: () => openStatusAction('CANCELLED', row),
    })
  }
  return items.length === 0 ? [] : [items]
}

function openStatusAction(action: 'APPOINTED' | 'FEEDBACK_GIVEN' | 'CANCELLED', row: MachineViewingDto): void {
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
      : statusAction.value === 'APPOINTED'
        ? 'machineViewing.action.appointed'
        : 'machineViewing.feedback.saved'
    toast.success(t(successKey))
    // QsGenericModal 在 submitting 期间会拒绝受控关闭；先释放 busy 再清空动作。
    statusSubmitting.value = false
    await nextTick()
    statusAction.value = null
    statusRecord.value = null
    await load()
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
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.appointmentNo}：${t('machineViewing.action.detail')}`"
            @click="openDetail(row)"
          >
            {{ t('machineViewing.action.detail') }}
          </FaButton>
          <FaDropdown v-if="businessActions(row).length > 0" :items="businessActions(row)" align="end">
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
          :name="statusAction === 'CANCELLED' ? 'i-lucide:circle-x' : statusAction === 'APPOINTED' ? 'i-lucide:calendar-check' : 'i-lucide:message-square-text'"
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
        <p v-if="statusAction === 'APPOINTED'" class="qs-type-body text-foreground m-0">
          {{ t('machineViewing.appoint.description') }}
        </p>
        <div v-else-if="statusAction === 'FEEDBACK_GIVEN'">
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
    <MachineViewingFeedbackModal v-model="feedbackOpen" :record="feedbackRecord" />
    <MachineViewingDetailDrawer v-model="detailOpen" :record="detailRecord" />
  </div>
</template>
