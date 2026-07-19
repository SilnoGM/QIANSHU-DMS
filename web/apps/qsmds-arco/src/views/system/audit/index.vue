<script setup lang="ts">
import type { AuditEventDto } from '@/api/generated/types.gen'
import managementApi from '@/api/modules/management'
import {
  auditMetadataEntries,
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

const canRead = computed(() => auth('audit:read'))
const columns = [
  { title: '时间', dataIndex: 'occurredAt', slotName: 'time', width: 190 },
  { title: '事件', dataIndex: 'eventType', slotName: 'event', width: 230 },
  { title: '结果', dataIndex: 'outcome', slotName: 'outcome', width: 90 },
  { title: '操作者 ID', dataIndex: 'actorUserId', slotName: 'actor', width: 240 },
  { title: '目标', slotName: 'target', width: 250 },
  { title: '请求 ID', dataIndex: 'requestId', slotName: 'requestId', width: 250 },
  { title: 'Metadata', dataIndex: 'metadata', slotName: 'metadata', width: 320 },
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
  if (loading.value || !canRead.value) {
    return
  }
  loading.value = true
  pageError.value = ''
  try {
    // 审计查询契约首期只允许 page/pageSize，页面不得臆造事件、用户或时间筛选。
    const response = await managementApi.auditEvents.list({ page, pageSize: size })
    events.value = response.data.items
    currentPage.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    pageError.value = safeErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

function changePage(page: number): void {
  void loadEvents(page, pageSize.value)
}

function changePageSize(size: number): void {
  void loadEvents(1, size)
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
      <AButton v-if="canRead" :loading="loading" @click="loadEvents()">
        <template #icon>
          <FaIcon name="i-mdi:refresh" />
        </template>
        刷新
      </AButton>
    </FaPageHeader>

    <FaPageMain>
      <AResult v-if="!canRead" status="403" title="没有权限" subtitle="当前账号不能查看安全审计。" />
      <template v-else>
        <AAlert v-if="pageError" type="error" class="mb-4">
          {{ pageError }}
          <AButton type="text" size="small" @click="loadEvents()">
            重试
          </AButton>
        </AAlert>

        <div class="desktop-list">
          <ATable
            row-key="id"
            :columns="columns"
            :data="events"
            :loading="loading"
            :pagination="false"
            :scroll="{ x: 1580 }"
          >
            <template #time="{ record }">
              {{ formatAuditTime(record.occurredAt) }}
            </template>
            <template #event="{ record }">
              <div class="event-cell">
                <strong>{{ formatAuditEvent(record.eventType) }}</strong>
                <code>{{ record.eventType }}</code>
              </div>
            </template>
            <template #outcome="{ record }">
              <ATag :color="record.outcome === 'SUCCESS' ? 'green' : 'red'">
                {{ formatAuditOutcome(record.outcome) }}
              </ATag>
            </template>
            <template #actor="{ record }">
              <code>{{ record.actorUserId || '—' }}</code>
            </template>
            <template #target="{ record }">
              <code>{{ targetLabel(record) }}</code>
            </template>
            <template #requestId="{ record }">
              <code>{{ record.requestId }}</code>
            </template>
            <template #metadata="{ record }">
              <span v-if="auditMetadataEntries(record.metadata).length === 0" class="secondary-text">—</span>
              <div v-else class="metadata-list">
                <ATag v-for="entry in auditMetadataEntries(record.metadata)" :key="entry.key" bordered>
                  {{ entry.key }}={{ entry.value }}
                </ATag>
              </div>
            </template>
          </ATable>
        </div>

        <div class="mobile-list" :aria-busy="loading">
          <AEmpty v-if="!loading && events.length === 0" description="暂无审计记录" />
          <ACard v-for="event in events" :key="event.id" class="audit-card" :bordered="true">
            <template #title>
              {{ formatAuditEvent(event.eventType) }}
            </template>
            <template #extra>
              <ATag :color="event.outcome === 'SUCCESS' ? 'green' : 'red'">
                {{ formatAuditOutcome(event.outcome) }}
              </ATag>
            </template>

            <div class="card-fields">
              <div><span>时间</span><strong>{{ formatAuditTime(event.occurredAt) }}</strong></div>
              <div><span>事件码</span><code>{{ event.eventType }}</code></div>
              <div><span>操作者 ID</span><code>{{ event.actorUserId || '—' }}</code></div>
              <div><span>目标</span><code>{{ targetLabel(event) }}</code></div>
              <div><span>请求 ID</span><code>{{ event.requestId }}</code></div>
              <div>
                <span>Metadata</span>
                <div v-if="auditMetadataEntries(event.metadata).length > 0" class="metadata-list">
                  <ATag v-for="entry in auditMetadataEntries(event.metadata)" :key="entry.key" bordered>
                    {{ entry.key }}={{ entry.value }}
                  </ATag>
                </div>
                <strong v-else>—</strong>
              </div>
            </div>
          </ACard>
        </div>

        <div v-if="total > 0" class="pagination-wrap">
          <APagination
            :current="currentPage"
            :page-size="pageSize"
            :total="total"
            :page-size-options="[20, 50, 100]"
            show-total
            show-page-size
            :disabled="loading"
            @change="changePage"
            @page-size-change="changePageSize"
          />
        </div>
      </template>
    </FaPageMain>
  </div>
</template>

<style scoped>
.event-cell {
  display: grid;
  gap: 3px;
}

.event-cell code,
.secondary-text {
  color: var(--color-text-3);
}

.metadata-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.metadata-list :deep(.arco-tag) {
  max-width: 100%;
  height: auto;
  overflow-wrap: anywhere;
  white-space: normal;
}

.mobile-list {
  display: none;
}

.card-fields {
  display: grid;
  gap: 11px;
}

.card-fields > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.card-fields > div > span {
  color: var(--color-text-3);
}

.card-fields code {
  overflow-wrap: anywhere;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 2px;
  margin-top: 18px;
  overflow-x: auto;
}

@media (width <= 767px) {
  .desktop-list {
    display: none;
  }

  .mobile-list {
    display: grid;
    gap: 12px;
  }

  .pagination-wrap {
    justify-content: flex-start;
  }
}
</style>
