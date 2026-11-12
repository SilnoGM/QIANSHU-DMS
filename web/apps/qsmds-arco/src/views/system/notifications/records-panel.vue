<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type { NotificationRecordQueryState } from './records-query'
import type {
  NotificationRecordDto,
  NotificationRecordEventOptionDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import { parseDate } from '@internationalized/date'
import { useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { hasVisibleTableColumn } from '../shared/table-query'
import NotificationRecordCancelModal from './components/NotificationRecordCancelModal.vue'
import NotificationRecordDetailDrawer from './components/NotificationRecordDetailDrawer.vue'
import {
  buildRecordListQuery,
  buildRecordRouteQuery,
  NOTIFICATION_RECORD_PAGE_SIZES,

  parseRecordRouteQuery,
} from './records-query'
import {
  canCancelRecord,
  recordDeliverySummary,
} from './records.logic'
import {
  CHANNEL_OPTIONS,
  NOTIFICATION_STATUS_OPTIONS,
  notificationStatusClass,
  notificationStatusLabel,
  PRIORITY_OPTIONS,
  priorityClass,
  priorityLabel,
  sourceTypeLabel,
} from './records.presentation'
import { TEMPLATE_DOMAIN_OPTIONS } from './template-key-grouping.logic'

defineOptions({ name: 'NotificationRecordsPanel' })

const emit = defineEmits<{
  changed: []
}>()

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const toast = useQsToast()
const isNarrow = useMediaQuery('(max-width: 767px)')

const canManage = computed(() => auth('notification-record:manage'))
const initialState = parseRecordRouteQuery(route.query)
const page = ref(initialState.page)
const pageSize = ref(initialState.pageSize)
const searchKeyword = ref(initialState.keyword)
const filters = ref<QsGenericTableFilterValues>({
  ...(initialState.status === null ? {} : { status: initialState.status }),
  ...(initialState.domain === null ? {} : { domain: initialState.domain }),
  ...(initialState.eventType === null ? {} : { eventType: initialState.eventType }),
  ...(initialState.channel === null ? {} : { channel: initialState.channel }),
  ...(initialState.priority === null ? {} : { priority: initialState.priority }),
})
const dateRange = shallowRef<CalendarDateRangeValue>({
  start: initialState.from === null ? undefined : parseDate(initialState.from),
  end: initialState.to === null ? undefined : parseDate(initialState.to),
})

const rows = ref<NotificationRecordDto[]>([])
const total = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)
const events = ref<NotificationRecordEventOptionDto[]>([])
const optionsError = ref<string | null>(null)

const detailOpen = ref(false)
const detailRecordId = ref<string | null>(null)
const detailDrawerRef = ref<InstanceType<typeof NotificationRecordDetailDrawer> | null>(null)
const cancelOpen = ref(false)
const cancelTarget = ref<NotificationRecordDto | null>(null)
const cancelSubmitting = ref(false)
const cancelError = ref<string | null>(null)
const actionsOpen = ref(false)
const actionTarget = ref<NotificationRecordDto | null>(null)

let listRequestVersion = 0
let listController: AbortController | null = null
let optionsRequestVersion = 0
let optionsController: AbortController | null = null
let queryRefreshPending = false

function filterString(key: string): string | null {
  const value = filters.value[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const queryState = computed<NotificationRecordQueryState>(() => ({
  page: page.value,
  pageSize: pageSize.value,
  status: filterString('status') as NotificationRecordQueryState['status'],
  eventType: filterString('eventType'),
  domain: filterString('domain') as NotificationRecordQueryState['domain'],
  channel: filterString('channel') as NotificationRecordQueryState['channel'],
  priority: filterString('priority') as NotificationRecordQueryState['priority'],
  keyword: searchKeyword.value,
  from: dateRange.value.start?.toString() ?? null,
  to: dateRange.value.end?.toString() ?? null,
}))

function queryKey(state: NotificationRecordQueryState): string {
  return JSON.stringify(buildRecordRouteQuery(state))
}

function applyQueryState(state: NotificationRecordQueryState): void {
  page.value = state.page
  pageSize.value = state.pageSize
  searchKeyword.value = state.keyword
  filters.value = {
    ...(state.status === null ? {} : { status: state.status }),
    ...(state.domain === null ? {} : { domain: state.domain }),
    ...(state.eventType === null ? {} : { eventType: state.eventType }),
    ...(state.channel === null ? {} : { channel: state.channel }),
    ...(state.priority === null ? {} : { priority: state.priority }),
  }
  dateRange.value = {
    start: state.from === null ? undefined : parseDate(state.from),
    end: state.to === null ? undefined : parseDate(state.to),
  }
}

function syncRoute(): void {
  const next = buildRecordRouteQuery(queryState.value)
  const current = buildRecordRouteQuery(parseRecordRouteQuery(route.query))
  if (JSON.stringify(next) === JSON.stringify(current)) {
    return
  }
  void router.replace({ query: next })
}

async function loadOptions(): Promise<void> {
  const version = ++optionsRequestVersion
  optionsController?.abort()
  optionsController = new AbortController()
  try {
    const response = await notificationsApi.records.options(optionsController.signal)
    if (version !== optionsRequestVersion) {
      return
    }
    events.value = response.data.events
    optionsError.value = null
  }
  catch (failure) {
    if (version !== optionsRequestVersion) {
      return
    }
    optionsError.value = getApiClientFailureMessage(failure, '事件筛选选项加载失败')
  }
}

async function loadRecords(): Promise<void> {
  const version = ++listRequestVersion
  listController?.abort()
  listController = new AbortController()
  loading.value = true
  error.value = null
  try {
    const response = await notificationsApi.records.list(
      buildRecordListQuery(queryState.value),
      listController.signal,
    )
    if (version !== listRequestVersion) {
      return
    }
    rows.value = response.data.items
    total.value = response.data.total
    page.value = response.data.page
    pageSize.value = response.data.pageSize
  }
  catch (failure) {
    if (version !== listRequestVersion) {
      return
    }
    error.value = getApiClientFailureMessage(failure, '通知记录加载失败')
  }
  finally {
    if (version === listRequestVersion) {
      loading.value = false
    }
  }
}

/**
 * 搜索、筛选、日期和组件的“清空全部”可能在同一轮更新中连续触发事件；
 * 统一在微任务内合并成一次请求，并确保页码先归一到第一页。
 */
function scheduleQueryRefresh(): void {
  page.value = 1
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    syncRoute()
    void loadRecords()
  })
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  const next = { ...nextFilters }
  const domain = typeof next.domain === 'string' ? next.domain : null
  const eventType = typeof next.eventType === 'string' ? next.eventType : null
  if (domain !== null && eventType !== null) {
    const selectedEvent = events.value.find(event => event.eventType === eventType)
    if (selectedEvent !== undefined && selectedEvent.domain !== domain) {
      delete next.eventType
    }
  }
  filters.value = next
  scheduleQueryRefresh()
}

function handlePaginationChange(pagination: { page: number, pageSize: number }): void {
  page.value = pagination.page
  pageSize.value = pagination.pageSize
  syncRoute()
  void loadRecords()
}

function openDetail(row: NotificationRecordDto): void {
  detailRecordId.value = row.id
  detailOpen.value = true
}

function openRowActions(row: NotificationRecordDto): void {
  actionTarget.value = row
  actionsOpen.value = true
}

function requestCancel(row: NotificationRecordDto): void {
  cancelTarget.value = row
  cancelError.value = null
  cancelOpen.value = true
}

async function confirmCancel(): Promise<void> {
  const target = cancelTarget.value
  if (target === null || cancelSubmitting.value) {
    return
  }
  cancelSubmitting.value = true
  cancelError.value = null
  try {
    const result = (await notificationsApi.records.cancel(target.id)).data
    cancelSubmitting.value = false
    cancelOpen.value = false
    cancelTarget.value = null
    if (result.cancelled === 0) {
      toast.info('没有可取消的待发送交付')
    }
    else {
      toast.success(`已取消 ${result.cancelled} 条未发送交付`)
    }
    await loadRecords()
    if (detailOpen.value && detailRecordId.value === target.id) {
      await detailDrawerRef.value?.reload()
    }
    emit('changed')
  }
  catch (failure) {
    cancelError.value = getApiClientFailureMessage(failure, '取消通知失败')
  }
  finally {
    cancelSubmitting.value = false
  }
}

function openDetailFromActions(): void {
  const target = actionTarget.value
  actionsOpen.value = false
  if (target !== null) {
    openDetail(target)
  }
}

function cancelFromActions(): void {
  const target = actionTarget.value
  actionsOpen.value = false
  if (target !== null) {
    requestCancel(target)
  }
}

const selectedDomain = computed(() => {
  const value = filters.value.domain
  return typeof value === 'string' ? value : null
})

const eventOptions = computed(() => events.value
  .filter(event => selectedDomain.value === null || event.domain === selectedDomain.value)
  .map(event => ({ label: event.label, value: event.eventType })))

const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [
  {
    key: 'status',
    label: '状态',
    options: NOTIFICATION_STATUS_OPTIONS,
  },
  {
    key: 'domain',
    label: '业务域',
    options: TEMPLATE_DOMAIN_OPTIONS.map(option => ({ label: option.label, value: option.value })),
  },
  ...(eventOptions.value.length === 0
    ? []
    : [{
        key: 'eventType',
        label: '事件',
        options: eventOptions.value,
      }]),
  {
    key: 'channel',
    label: '渠道',
    options: [...CHANNEL_OPTIONS],
  },
  {
    key: 'priority',
    label: '优先级',
    options: [...PRIORITY_OPTIONS],
  },
])

const columns: QsGenericTableColumn<NotificationRecordDto>[] = [
  { id: 'notificationNo', accessorKey: 'notificationNo', title: '通知编号', minWidth: 190 },
  { id: 'time', accessorKey: 'publishedAt', title: '时间', width: 180 },
  { id: 'event', accessorKey: 'eventType', title: '事件', minWidth: 210 },
  {
    id: 'channels',
    title: '渠道',
    width: 116,
    accessorFn: row => row.channels.join(','),
  },
  {
    id: 'delivery',
    title: '投递/收件',
    minWidth: 200,
    accessorFn: row => recordDeliverySummary(row).map(item => item.label).join(' · '),
  },
  { id: 'status', accessorKey: 'status', title: '状态', width: 88 },
  {
    id: 'source',
    title: '来源',
    minWidth: 190,
    accessorFn: row => `${sourceTypeLabel(row.sourceType)} ${row.sourceId}`,
  },
  { id: 'requestedByName', accessorKey: 'requestedByName', title: '请求人', width: 140 },
  { id: 'priority', accessorKey: 'priority', title: '优先级', width: 80 },
  { id: 'templateKey', accessorKey: 'templateKey', title: '模板键', minWidth: 160 },
]

const actionColumnWidth = 128
const deliveryToneClass = {
  danger: 'text-destructive',
  normal: 'text-muted-foreground',
  warning: 'text-amber-700 dark:text-amber-300',
} as const

const mobileDrawerTitle = computed(() => actionTarget.value?.eventLabel ?? '记录操作')

function canCancelRow(row: NotificationRecordDto): boolean {
  return canCancelRecord(row, canManage.value)
}

watch(
  () => route.query,
  () => {
    const next = parseRecordRouteQuery(route.query)
    if (queryKey(next) === queryKey(queryState.value)) {
      return
    }
    applyQueryState(next)
    void loadRecords()
  },
  { deep: true },
)

onMounted(() => {
  syncRoute()
  void loadOptions()
  void loadRecords()
})

onBeforeUnmount(() => {
  listController?.abort()
  optionsController?.abort()
})

defineExpose({ refresh: loadRecords })
</script>

<template>
  <div class="flex flex-col gap-4 min-w-0">
    <FaAlert v-if="optionsError !== null" title="事件筛选暂不可用">
      <template #description>
        {{ optionsError }}
      </template>
    </FaAlert>

    <QsGenericTable
      v-model:page="page"
      v-model:page-size="pageSize"
      v-model:search="searchKeyword"
      v-model:filters="filters"
      data-testid="notification-record-table"
      row-key="id"
      :columns="columns"
      :data="rows"
      :total="total"
      :loading="loading"
      :error="error ?? undefined"
      :addable="false"
      :page-size-options="[...NOTIFICATION_RECORD_PAGE_SIZES]"
      :filter-definitions="filterDefinitions"
      :action-column="{ width: actionColumnWidth }"
      empty-title="暂无通知记录"
      empty-description="当前查询范围内没有可展示的通知记录。"
      search-placeholder="搜索通知编号、记录 ID、来源单号、模板键或收件人"
      table-class="min-w-[1800px]"
      @filter-change="handleFilterChange"
      @pagination-change="handlePaginationChange"
      @retry="loadRecords"
      @search="scheduleQueryRefresh"
    >
      <template #query-leading>
        <QsDateRangeFilter
          v-model="dateRange"
          calendar-label="发布时间"
          placeholder="发布时间"
          @clear="scheduleQueryRefresh"
          @complete="scheduleQueryRefresh"
        />
      </template>

      <template #cell-notificationNo="{ row }">
        <QsCopyableText v-if="row.original.notificationNo !== null" label="通知编号" :text="row.original.notificationNo" />
        <span v-else class="text-muted-foreground">—</span>
      </template>

      <template #cell-time="{ row }">
        <div class="flex flex-col gap-0.5">
          <div class="flex gap-1.5 items-baseline">
            <span class="qs-type-meta text-muted-foreground">请求</span>
            <DateTimeDisplay :value="row.original.publishedAt" />
          </div>
          <div class="flex gap-1.5 items-baseline">
            <span class="qs-type-meta text-muted-foreground">完成</span>
            <DateTimeDisplay :value="row.original.completedAt" />
          </div>
        </div>
      </template>

      <template #cell-event="{ row }">
        <div class="flex flex-col gap-0.5 min-w-0">
          <div class="flex flex-wrap gap-1.5 items-center">
            <strong class="qs-type-body-medium">{{ row.original.eventLabel }}</strong>
            <FaTag
              v-if="row.original.priority === 'HIGH'"
              variant="outline"
              class="qs-type-status-tag"
              :class="priorityClass(row.original.priority)"
            >
              高
            </FaTag>
          </div>
          <code class="qs-type-data-emphasis text-muted-foreground break-all">{{ row.original.eventType }}</code>
        </div>
      </template>

      <template #cell-channels="{ row }">
        <div class="flex flex-wrap gap-1">
          <FaTag
            v-for="channel in row.original.channels"
            :key="channel"
            variant="outline"
            class="qs-type-status-tag"
            :class="channel === 'IN_APP'
              ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
              : 'border-primary/30 bg-primary/10 text-primary'"
          >
            {{ channel === 'IN_APP' ? '站内' : '小助理' }}
          </FaTag>
          <span v-if="row.original.channels.length === 0" class="text-muted-foreground">—</span>
        </div>
      </template>

      <template #cell-delivery="{ row }">
        <div class="flex flex-col gap-0.5">
          <span
            v-for="item in recordDeliverySummary(row.original)"
            :key="item.channel"
            class="qs-type-body"
            :class="deliveryToneClass[item.tone]"
          >
            {{ item.label }}<template v-if="item.detail !== null">（{{ item.detail }}）</template>
          </span>
          <span v-if="recordDeliverySummary(row.original).length === 0" class="text-muted-foreground">—</span>
        </div>
      </template>

      <template #cell-status="{ row }">
        <FaTag
          variant="outline"
          class="qs-type-status-tag"
          :class="notificationStatusClass(row.original.status)"
        >
          {{ notificationStatusLabel(row.original.status) }}
        </FaTag>
      </template>

      <template #cell-source="{ row }">
        <div class="flex flex-col gap-0.5 min-w-0">
          <span class="qs-type-body">{{ sourceTypeLabel(row.original.sourceType) }}</span>
          <QsCopyableText label="来源 ID" :text="row.original.sourceId" />
        </div>
      </template>

      <template #cell-requestedByName="{ row }">
        <div class="flex flex-col gap-0.5 min-w-0">
          <QsPersonDisplay
            v-if="row.original.requestedByName !== null"
            :display-name="row.original.requestedByName"
            size="md"
          />
          <span v-else class="text-muted-foreground">—</span>
        </div>
      </template>

      <template #cell-priority="{ row }">
        <FaTag
          variant="outline"
          class="qs-type-status-tag"
          :class="priorityClass(row.original.priority)"
        >
          {{ priorityLabel(row.original.priority) }}
        </FaTag>
      </template>

      <template #cell-templateKey="{ row }">
        <QsCopyableText label="模板键" :text="row.original.templateKey" />
      </template>

      <template #actions="{ row }">
        <div v-if="!isNarrow" class="flex flex-wrap gap-2">
          <FaButton variant="outline" size="sm" @click.stop="openDetail(row)">
            详情
          </FaButton>
          <FaButton
            v-if="canCancelRow(row)"
            variant="destructive"
            size="sm"
            @click.stop="requestCancel(row)"
          >
            取消
          </FaButton>
        </div>
        <FaButton v-else variant="outline" size="sm" @click.stop="openRowActions(row)">
          操作
        </FaButton>
      </template>

      <template #mobile-row="{ columns: visibleColumns, row, rowNumber }">
        <div data-testid="notification-record-card" class="space-y-3">
          <div class="pb-3 flex gap-3 items-start justify-between">
            <div v-if="hasVisibleTableColumn(visibleColumns, 'event')" class="min-w-0">
              <div class="flex flex-wrap gap-1.5 items-center">
                <strong class="qs-type-compact-title break-words">{{ row.eventLabel }}</strong>
                <FaTag
                  v-if="row.priority === 'HIGH'"
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="priorityClass(row.priority)"
                >
                  高
                </FaTag>
              </div>
              <code class="qs-type-data-emphasis text-muted-foreground break-all">{{ row.eventType }}</code>
            </div>
            <div class="flex shrink-0 flex-col gap-1 items-end">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="notificationStatusClass(row.status)"
              >
                {{ notificationStatusLabel(row.status) }}
              </FaTag>
              <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
            </div>
          </div>

          <dl class="qs-type-body m-0 gap-3 grid">
            <div v-if="hasVisibleTableColumn(visibleColumns, 'notificationNo')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                通知编号
              </dt>
              <dd class="m-0">
                <QsCopyableText v-if="row.notificationNo !== null" label="通知编号" :text="row.notificationNo" />
                <span v-else class="text-muted-foreground">—</span>
              </dd>
            </div>
            <div v-if="hasVisibleTableColumn(visibleColumns, 'time')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                时间
              </dt>
              <dd class="m-0">
                <div class="flex flex-col gap-0.5">
                  <div class="flex gap-1.5 items-baseline">
                    <span class="qs-type-meta text-muted-foreground">请求</span>
                    <DateTimeDisplay :value="row.publishedAt" />
                  </div>
                  <div class="flex gap-1.5 items-baseline">
                    <span class="qs-type-meta text-muted-foreground">完成</span>
                    <DateTimeDisplay :value="row.completedAt" />
                  </div>
                </div>
              </dd>
            </div>
            <div v-if="hasVisibleTableColumn(visibleColumns, 'channels')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                渠道
              </dt>
              <dd class="m-0">
                <div class="flex flex-wrap gap-1">
                  <FaTag
                    v-for="channel in row.channels"
                    :key="channel"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="channel === 'IN_APP'
                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                      : 'border-primary/30 bg-primary/10 text-primary'"
                  >
                    {{ channel === 'IN_APP' ? '站内' : '小助理' }}
                  </FaTag>
                  <span v-if="row.channels.length === 0" class="text-muted-foreground">—</span>
                </div>
              </dd>
            </div>
            <div v-if="hasVisibleTableColumn(visibleColumns, 'delivery')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                投递/收件
              </dt>
              <dd class="m-0">
                <div class="flex flex-col gap-0.5">
                  <span
                    v-for="item in recordDeliverySummary(row)"
                    :key="item.channel"
                    :class="deliveryToneClass[item.tone]"
                  >
                    {{ item.label }}<template v-if="item.detail !== null">（{{ item.detail }}）</template>
                  </span>
                  <span v-if="recordDeliverySummary(row).length === 0" class="text-muted-foreground">—</span>
                </div>
              </dd>
            </div>
            <div v-if="hasVisibleTableColumn(visibleColumns, 'source')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                来源
              </dt>
              <dd class="m-0 min-w-0">
                <div class="flex flex-col gap-0.5">
                  <span>{{ sourceTypeLabel(row.sourceType) }}</span>
                  <QsCopyableText label="来源 ID" :text="row.sourceId" />
                </div>
              </dd>
            </div>
            <div v-if="hasVisibleTableColumn(visibleColumns, 'requestedByName')" class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
              <dt class="qs-type-compact-label">
                请求人
              </dt>
              <dd class="m-0">
                <div class="flex flex-col gap-0.5">
                  <QsPersonDisplay
                    v-if="row.requestedByName !== null"
                    :display-name="row.requestedByName"
                    size="sm"
                  />
                  <span v-else class="text-muted-foreground">—</span>
                </div>
              </dd>
            </div>
          </dl>
        </div>
      </template>
    </QsGenericTable>

    <FaDrawer
      v-model="actionsOpen"
      :title="mobileDrawerTitle"
      side="bottom"
      :footer="false"
      content-class="h-[min(18rem,calc(100dvh-1.5rem))]"
      destroy-on-close
    >
      <div data-testid="notification-record-actions-drawer" class="pb-[max(0.75rem,env(safe-area-inset-bottom))] gap-3 grid">
        <FaButton class="w-full" variant="outline" @click="openDetailFromActions">
          查看详情
        </FaButton>
        <FaButton
          v-if="actionTarget !== null && canCancelRow(actionTarget)"
          class="w-full"
          variant="destructive"
          @click="cancelFromActions"
        >
          取消未发送交付
        </FaButton>
      </div>
    </FaDrawer>

    <NotificationRecordDetailDrawer
      ref="detailDrawerRef"
      v-model="detailOpen"
      :record-id="detailRecordId"
      @cancel="requestCancel"
    />

    <NotificationRecordCancelModal
      v-model="cancelOpen"
      :record="cancelTarget"
      :submitting="cancelSubmitting"
      :error="cancelError"
      @confirm="confirmCancel"
    />
  </div>
</template>
