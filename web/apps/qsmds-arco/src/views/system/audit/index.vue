<script setup lang="ts">
import type { AuditEventDto } from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import managementApi from '@/api/modules/management'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { hasVisibleTableColumn } from '../shared/table-query'
import {
  AUDIT_EVENT_TYPES,
  buildAuditEventListQuery,
} from './audit.logic'
import {
  auditMetadataEntries,
  auditOutcomeTagPresentation,
  formatAuditEvent,
  formatAuditOutcome,
  formatAuditTime,
} from './presentation'

defineOptions({ name: 'SystemAuditEvents' })

const { auth } = useAppAuth()
const events = ref<AuditEventDto[]>([])
const loading = ref(false)
const pageError = ref('')
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
let listRequestVersion = 0
let queryRefreshPending = false

const canRead = computed(() => auth('audit:read'))
const columns: QsGenericTableColumn<AuditEventDto>[] = [
  { id: 'occurredAt', accessorKey: 'occurredAt', title: '时间', width: 190 },
  { id: 'eventType', accessorKey: 'eventType', title: '事件', width: 230 },
  { id: 'outcome', accessorKey: 'outcome', title: '结果', width: 90 },
  { id: 'actorDisplayName', accessorKey: 'actorDisplayName', title: '操作者', width: 180 },
  { id: 'target', title: '目标', width: 250 },
  { id: 'requestId', accessorKey: 'requestId', title: '请求 ID', width: 250 },
  { id: 'metadata', accessorKey: 'metadata', title: 'Metadata', width: 320 },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'eventType',
    label: '事件类型',
    options: AUDIT_EVENT_TYPES.map(value => ({
      label: formatAuditEvent(value),
      value,
    })),
  },
  {
    key: 'outcome',
    label: '执行结果',
    options: [
      { label: '成功', value: 'SUCCESS' },
      { label: '失败', value: 'FAILURE' },
    ],
  },
]

function safeErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '审计日志加载失败，请稍后重试'
  }
  const candidate = error as {
    body?: { message?: unknown, requestId?: unknown }
    message?: unknown
    requestId?: unknown
  }
  const message = typeof candidate.body?.message === 'string'
    ? candidate.body.message
    : typeof candidate.message === 'string'
      ? candidate.message
      : '审计日志加载失败，请稍后重试'
  const requestId = typeof candidate.body?.requestId === 'string'
    ? candidate.body.requestId
    : typeof candidate.requestId === 'string'
      ? candidate.requestId
      : undefined
  return requestId === undefined ? message : `${message}（requestId: ${requestId}）`
}

async function loadEvents(page = currentPage.value, size = pageSize.value): Promise<void> {
  if (!canRead.value) {
    return
  }
  const requestVersion = ++listRequestVersion
  loading.value = true
  pageError.value = ''
  try {
    const response = await managementApi.auditEvents.list(buildAuditEventListQuery(
      page,
      size,
      searchKeyword.value,
      filters.value.eventType,
      filters.value.outcome,
    ))
    if (requestVersion !== listRequestVersion) {
      return
    }
    events.value = response.data.items
    currentPage.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (requestVersion !== listRequestVersion) {
      return
    }
    pageError.value = safeErrorMessage(error)
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
    }
  }
}

/**
 * QsGenericTable 会先统一更新 page/pageSize，再只触发一次 paginationChange。
 * 页面只消费该事件负载发起服务端查询，避免叠加监听 model 更新而重复请求。
 */
function handlePaginationChange(pagination: { page: number, pageSize: number }): void {
  void loadEvents(pagination.page, pagination.pageSize)
}

/**
 * 搜索、筛选及组件的“同时清空”动作统一在一个微任务内合并，确保页码归一为 1
 * 后只向服务端发送一次包含全部最新条件的查询。
 */
function scheduleQueryRefresh(): void {
  currentPage.value = 1
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadEvents()
  })
}

function targetLabel(event: AuditEventDto): string {
  if (event.targetType === null && event.targetId === null) {
    return '—'
  }
  return `${event.targetType ?? '—'} / ${event.targetId ?? '—'}`
}

onMounted(loadEvents)
</script>

<template>
  <div>
    <FaPageHeader description="按发生时间倒序查看认证与权限管理审计。页面只展示契约允许的安全字段。">
      <template #title>
        审计日志
      </template>
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="loadEvents()">
        <FaIcon name="i-mdi:refresh" />
        刷新
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-x"
        title="没有权限"
        description="当前账号不能查看安全审计。"
        class="min-h-64"
      />
      <template v-else>
        <FaAlert
          v-if="pageError"
          variant="destructive"
          icon="i-lucide:circle-alert"
          title="审计日志加载失败"
          class="mb-4"
        >
          <template #description>
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <span>{{ pageError }}</span>
              <FaButton variant="outline" size="sm" @click="loadEvents()">
                重试
              </FaButton>
            </div>
          </template>
        </FaAlert>

        <QsGenericTable
          v-model:page="currentPage"
          v-model:page-size="pageSize"
          v-model:search="searchKeyword"
          v-model:filters="filters"
          data-testid="audit-table"
          row-key="id"
          :columns="columns"
          :data="events"
          :filter-definitions="filterDefinitions"
          :total="total"
          :loading="loading"
          :page-size-options="[20, 50, 100]"
          :addable="false"
          empty-title="暂无审计记录"
          empty-description="当前查询范围内没有可展示的审计事件。"
          search-placeholder="输入完整请求 ID 搜索"
          table-class="min-w-[1520px]"
          :class="loading && events.length ? 'pointer-events-none' : undefined"
          @filter-change="scheduleQueryRefresh"
          @pagination-change="handlePaginationChange"
          @search="scheduleQueryRefresh"
        >
          <template #cell-occurredAt="{ row }">
            <span class="qs-type-data">{{ formatAuditTime(row.original.occurredAt) }}</span>
          </template>
          <template #cell-eventType="{ row }">
            <div class="gap-1 grid">
              <strong class="qs-type-body-medium">{{ formatAuditEvent(row.original.eventType) }}</strong>
              <code class="qs-type-data-emphasis">{{ row.original.eventType }}</code>
            </div>
          </template>
          <template #cell-outcome="{ row }">
            <FaTag
              v-bind="auditOutcomeTagPresentation(row.original.outcome)"
              class="qs-type-status-tag"
            >
              {{ formatAuditOutcome(row.original.outcome) }}
            </FaTag>
          </template>
          <template #cell-actorDisplayName="{ row }">
            <QsPersonDisplay
              v-if="row.original.actorType === 'USER'"
              :display-name="row.original.actorDisplayName ?? ''"
              :avatar-url="row.original.actorAvatarUrl"
              size="md"
            />
            <span v-else class="qs-type-body-medium">—</span>
          </template>
          <template #cell-target="{ row }">
            <code class="qs-type-data-emphasis break-all">{{ targetLabel(row.original) }}</code>
          </template>
          <template #cell-requestId="{ row }">
            <code class="qs-type-data-emphasis break-all">{{ row.original.requestId }}</code>
          </template>
          <template #cell-metadata="{ row }">
            <span v-if="auditMetadataEntries(row.original.metadata).length === 0" class="text-muted-foreground">—</span>
            <div v-else class="flex flex-wrap gap-1.5 min-w-0">
              <FaTag
                v-for="entry in auditMetadataEntries(row.original.metadata)"
                :key="entry.key"
                variant="outline"
                class="h-auto max-w-full whitespace-normal break-all"
              >
                {{ entry.key }}={{ entry.value }}
              </FaTag>
            </div>
          </template>

          <!--
            QsGenericTable 已提供移动卡片外框和加载态；插槽只描述审计业务内容，
            避免再嵌套 FaCard 形成双层边框，同时保留浏览器验收使用的稳定标识。
          -->
          <template #mobile-row="{ columns: visibleColumns, row: event, rowNumber }">
            <div data-testid="audit-card" class="space-y-3">
              <div class="pb-3 flex gap-3 items-start justify-between">
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'eventType')"
                  class="min-w-0"
                >
                  <strong class="qs-type-compact-title block break-words">{{ formatAuditEvent(event.eventType) }}</strong>
                  <code class="qs-type-data-emphasis break-all">{{ event.eventType }}</code>
                </div>
                <div class="flex shrink-0 flex-col gap-1 items-end">
                  <template v-if="hasVisibleTableColumn(visibleColumns, 'outcome')">
                    <FaTag v-bind="auditOutcomeTagPresentation(event.outcome)" class="qs-type-status-tag">
                      {{ formatAuditOutcome(event.outcome) }}
                    </FaTag>
                  </template>
                  <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                </div>
              </div>

              <dl class="qs-type-body m-0 gap-3 grid">
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'occurredAt')"
                  class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start"
                >
                  <dt class="qs-type-compact-label">
                    时间
                  </dt>
                  <dd class="qs-type-data m-0">
                    {{ formatAuditTime(event.occurredAt) }}
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'actorDisplayName')"
                  class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start"
                >
                  <dt class="qs-type-compact-label">
                    操作者
                  </dt>
                  <dd class="qs-type-body-medium m-0">
                    <QsPersonDisplay
                      v-if="event.actorType === 'USER'"
                      :display-name="event.actorDisplayName ?? ''"
                      :avatar-url="event.actorAvatarUrl"
                      size="md"
                    />
                    <span v-else>—</span>
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'target')"
                  class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start"
                >
                  <dt class="qs-type-compact-label">
                    目标
                  </dt>
                  <dd class="qs-type-data-emphasis m-0">
                    <code class="break-all">{{ targetLabel(event) }}</code>
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'requestId')"
                  class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start"
                >
                  <dt class="qs-type-compact-label">
                    请求 ID
                  </dt>
                  <dd class="qs-type-data-emphasis m-0">
                    <code class="break-all">{{ event.requestId }}</code>
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'metadata')"
                  class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start"
                >
                  <dt class="qs-type-compact-label">
                    Metadata
                  </dt>
                  <dd class="qs-type-body m-0 min-w-0">
                    <div v-if="auditMetadataEntries(event.metadata).length > 0" class="flex flex-wrap gap-1.5 min-w-0">
                      <FaTag
                        v-for="entry in auditMetadataEntries(event.metadata)"
                        :key="entry.key"
                        variant="outline"
                        class="h-auto max-w-full whitespace-normal break-all"
                      >
                        {{ entry.key }}={{ entry.value }}
                      </FaTag>
                    </div>
                    <span v-else>—</span>
                  </dd>
                </div>
              </dl>
            </div>
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
  </div>
</template>
