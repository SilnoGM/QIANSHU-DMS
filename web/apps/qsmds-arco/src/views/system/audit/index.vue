<script setup lang="ts">
import type { TableColumn } from '@fantastic-admin/components'
import type { AuditEventDto } from '@/api/generated/types.gen'
import { useMediaQuery } from '@vueuse/core'
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
const isNarrow = useMediaQuery('(max-width: 767px)')

const canRead = computed(() => auth('audit:read'))
const paginationLayout = computed(() => isNarrow.value
  ? 'total, sizes, pager'
  : 'total, sizes, ->, pager, jumper')
/**
 * FaPagination 的双向绑定是分页查询的唯一入口。页容量改变时先把页码
 * 归一为 1，再只发起一次请求，避免同时监听 pageChange/sizeChange 造成重复查询。
 */
const paginationPage = computed({
  get: () => currentPage.value,
  set: (page: number) => {
    if (page === currentPage.value) {
      return
    }
    currentPage.value = page
    void loadEvents(page, pageSize.value)
  },
})
const paginationSize = computed({
  get: () => pageSize.value,
  set: (size: number) => {
    if (size === pageSize.value) {
      return
    }
    pageSize.value = size
    currentPage.value = 1
    void loadEvents(1, size)
  },
})
const columns: TableColumn<AuditEventDto>[] = [
  { accessorKey: 'occurredAt', header: '时间', width: 190 },
  { accessorKey: 'eventType', header: '事件', width: 230 },
  { accessorKey: 'outcome', header: '结果', width: 90 },
  { accessorKey: 'actorUserId', header: '操作者 ID', width: 240 },
  { id: 'target', header: '目标', width: 250 },
  { accessorKey: 'requestId', header: '请求 ID', width: 250 },
  { accessorKey: 'metadata', header: 'Metadata', width: 320 },
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

        <div data-testid="audit-table" class="hidden md:block" :aria-busy="loading">
          <FaTable
            row-key="id"
            :columns="columns"
            :data="events"
            table-class="min-w-[1580px]"
            :class="loading ? 'pointer-events-none opacity-60' : undefined"
          >
            <template #cell-occurredAt="{ row }">
              {{ formatAuditTime(row.original.occurredAt) }}
            </template>
            <template #cell-eventType="{ row }">
              <div class="gap-1 grid">
                <strong>{{ formatAuditEvent(row.original.eventType) }}</strong>
                <code class="text-muted-foreground">{{ row.original.eventType }}</code>
              </div>
            </template>
            <template #cell-outcome="{ row }">
              <FaTag :variant="row.original.outcome === 'SUCCESS' ? 'secondary' : 'destructive'">
                {{ formatAuditOutcome(row.original.outcome) }}
              </FaTag>
            </template>
            <template #cell-actorUserId="{ row }">
              <code class="break-all">{{ row.original.actorUserId || '—' }}</code>
            </template>
            <template #cell-target="{ row }">
              <code class="break-all">{{ targetLabel(row.original) }}</code>
            </template>
            <template #cell-requestId="{ row }">
              <code class="break-all">{{ row.original.requestId }}</code>
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
            <template #empty>
              <div
                v-if="loading"
                class="text-muted-foreground flex-col-center gap-3 min-h-40"
                role="status"
              >
                <FaIcon name="i-svg-spinners:90-ring-with-bg" class="text-primary size-7" />
                <span class="text-sm">正在加载审计日志…</span>
              </div>
              <FaEmpty
                v-else
                icon="i-lucide:scroll-text"
                title="暂无审计记录"
                description="当前查询范围内没有可展示的审计事件。"
                class="min-h-40"
              />
            </template>
          </FaTable>
        </div>

        <div class="gap-3 grid md:hidden" :aria-busy="loading">
          <div
            v-if="loading && events.length === 0"
            class="text-muted-foreground flex-col-center gap-3 min-h-40"
            role="status"
          >
            <FaIcon name="i-svg-spinners:90-ring-with-bg" class="text-primary size-7" />
            <span class="text-sm">正在加载审计日志…</span>
          </div>
          <FaEmpty
            v-else-if="events.length === 0"
            icon="i-lucide:scroll-text"
            title="暂无审计记录"
            description="当前查询范围内没有可展示的审计事件。"
            class="min-h-40"
          />
          <FaCard
            v-for="event in events"
            :key="event.id"
            data-testid="audit-card"
            header-class="pb-3"
            content-class="space-y-3"
            :class="loading ? 'pointer-events-none opacity-60' : undefined"
          >
            <template #header>
              <div class="flex gap-3 items-start justify-between">
                <div class="min-w-0">
                  <strong class="block break-words">{{ formatAuditEvent(event.eventType) }}</strong>
                  <code class="text-xs text-muted-foreground break-all">{{ event.eventType }}</code>
                </div>
                <FaTag :variant="event.outcome === 'SUCCESS' ? 'secondary' : 'destructive'" class="shrink-0">
                  {{ formatAuditOutcome(event.outcome) }}
                </FaTag>
              </div>
            </template>

            <dl class="text-sm m-0 gap-3 grid">
              <div class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
                <dt class="text-muted-foreground">
                  时间
                </dt>
                <dd class="font-medium m-0">
                  {{ formatAuditTime(event.occurredAt) }}
                </dd>
              </div>
              <div class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
                <dt class="text-muted-foreground">
                  操作者 ID
                </dt>
                <dd class="m-0">
                  <code class="break-all">{{ event.actorUserId || '—' }}</code>
                </dd>
              </div>
              <div class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
                <dt class="text-muted-foreground">
                  目标
                </dt>
                <dd class="m-0">
                  <code class="break-all">{{ targetLabel(event) }}</code>
                </dd>
              </div>
              <div class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
                <dt class="text-muted-foreground">
                  请求 ID
                </dt>
                <dd class="m-0">
                  <code class="break-all">{{ event.requestId }}</code>
                </dd>
              </div>
              <div class="gap-2 grid grid-cols-[5.75rem_minmax(0,1fr)] items-start">
                <dt class="text-muted-foreground">
                  Metadata
                </dt>
                <dd class="m-0 min-w-0">
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
          </FaCard>
        </div>

        <div
          v-if="total > 0"
          class="mt-4 overflow-x-auto"
          :class="loading ? 'pointer-events-none opacity-60' : undefined"
        >
          <FaPagination
            v-model:page="paginationPage"
            v-model:size="paginationSize"
            :total="total"
            :sizes="[20, 50, 100]"
            :layout="paginationLayout"
          />
        </div>
      </template>
    </FaPageMain>
  </div>
</template>
