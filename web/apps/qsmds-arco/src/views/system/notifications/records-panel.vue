<script setup lang="ts">
import type { NotificationRecordDetailDto, NotificationRecordDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { computed, onMounted, ref, watch } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useAppAuth } from '@/composables/app/auth'

const toast = useQsToast()
const { auth } = useAppAuth()
const canCancel = computed(() => auth('notification-record:manage'))

const loading = ref(true)
const error = ref<string | null>(null)
const rows = ref<NotificationRecordDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('ALL')
const detailOpen = ref(false)
const detail = ref<NotificationRecordDetailDto | null>(null)
const detailLoading = ref(false)

const STATUS_OPTIONS = [
  { label: '全部状态', value: 'ALL' },
  { label: '待发', value: 'PENDING' },
  { label: '完成', value: 'COMPLETED' },
  { label: '部分', value: 'PARTIAL' },
  { label: '失败', value: 'FAILED' },
  { label: '跳过', value: 'SKIPPED' },
  { label: '过期', value: 'EXPIRED' },
  { label: '取消', value: 'CANCELLED' },
]

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待发',
  COMPLETED: '完成',
  PARTIAL: '部分',
  FAILED: '失败',
  SKIPPED: '跳过',
  EXPIRED: '过期',
  CANCELLED: '取消',
}

const columns: QsGenericTableColumn<NotificationRecordDto>[] = [
  { accessorKey: 'eventType', id: 'eventType', title: '事件', minWidth: 220 },
  { accessorKey: 'sourceId', id: 'sourceId', title: '来源', minWidth: 160 },
  { accessorKey: 'priority', id: 'priority', title: '优先级', width: 90 },
  { accessorKey: 'status', id: 'status', title: '状态', width: 100 },
  { accessorKey: 'publishedAt', id: 'publishedAt', title: '发布时间', width: 160 },
  { accessorKey: 'deliveryCounts', id: 'deliveryCounts', title: '交付', minWidth: 160 },
]

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function formatDate(value: string | null): string {
  return value === null ? '—' : dateTimeFormatter.format(new Date(value))
}

function statusClass(status: string): string {
  if (status === 'COMPLETED') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (status === 'FAILED' || status === 'EXPIRED') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  return 'border-border bg-muted text-muted-foreground'
}

function countSummary(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([status, count]) => `${STATUS_LABELS[status] ?? status} ${count}`)
  return parts.length === 0 ? '—' : parts.join(' · ')
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = (await notificationsApi.records.list({
      page: page.value,
      pageSize: pageSize.value,
      ...(statusFilter.value === 'ALL' ? {} : { status: statusFilter.value as NotificationRecordDto['status'] }),
    }, new AbortController().signal)).data
    rows.value = result.items
    total.value = result.total
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    loading.value = false
  }
}

async function openDetail(row: NotificationRecordDto): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = (await notificationsApi.records.get(row.id, new AbortController().signal)).data
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    detailLoading.value = false
  }
}

async function cancel(row: NotificationRecordDto): Promise<void> {
  try {
    const result = (await notificationsApi.records.cancel(row.id)).data
    toast.success(`已取消 ${result.cancelled} 条未发送交付`)
    await load()
    if (detailOpen.value && detail.value?.id === row.id) {
      await openDetail(row)
    }
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

watch([page, pageSize, statusFilter], () => {
  void load()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <FaAlert v-if="error !== null" variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="load">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div class="flex flex-wrap gap-3 items-end">
      <label class="flex flex-col gap-1 min-w-40">
        <span class="qs-type-compact-label">状态</span>
        <FaSelect v-model="statusFilter" :options="STATUS_OPTIONS" />
      </label>
      <FaButton variant="outline" size="sm" :disabled="loading" @click="load">
        刷新
      </FaButton>
    </div>

    <QsGenericTable
      v-model:page="page"
      v-model:page-size="pageSize"
      :columns="columns"
      :data="rows"
      :addable="false"
      :loading="loading"
      :total="total"
      row-key="id"
      data-testid="notification-record-table"
      @pagination-change="load"
    >
      <template #cell-status="{ row }">
        <FaTag variant="outline" :class="statusClass(row.original.status)">
          {{ STATUS_LABELS[row.original.status] ?? row.original.status }}
        </FaTag>
      </template>
      <template #cell-publishedAt="{ row }">
        {{ formatDate(row.original.publishedAt) }}
      </template>
      <template #cell-deliveryCounts="{ row }">
        <span class="qs-type-meta">{{ countSummary(row.original.deliveryCounts) }}</span>
      </template>
      <template #actions="{ row }">
        <div class="flex flex-wrap gap-2">
          <FaButton variant="outline" size="sm" @click="openDetail(row)">
            详情
          </FaButton>
          <FaButton
            v-if="canCancel && row.status === 'PENDING'"
            variant="outline"
            size="sm"
            @click="cancel(row)"
          >
            取消
          </FaButton>
        </div>
      </template>
    </QsGenericTable>

    <FaDrawer v-model="detailOpen" title="通知详情" side="right" :footer="false">
      <div v-if="detailLoading" class="text-muted-foreground flex gap-2 min-h-40 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
        正在加载详情…
      </div>
      <div v-else-if="detail !== null" class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" :class="statusClass(detail.status)">
            {{ STATUS_LABELS[detail.status] ?? detail.status }}
          </FaTag>
          <span class="qs-type-meta text-muted-foreground">{{ detail.eventType }}</span>
        </div>
        <div class="text-sm gap-2 grid">
          <p class="m-0 flex gap-3 justify-between">
            <span class="text-muted-foreground">来源</span>
            <span class="qs-type-data">{{ detail.sourceType }} / {{ detail.sourceId }}</span>
          </p>
          <p class="m-0 flex gap-3 justify-between">
            <span class="text-muted-foreground">模板</span>
            <span class="qs-type-data">{{ detail.templateKey }}</span>
          </p>
          <p class="m-0 flex gap-3 justify-between">
            <span class="text-muted-foreground">发布时间</span>
            <span>{{ formatDate(detail.publishedAt) }}</span>
          </p>
          <p class="m-0 flex gap-3 justify-between">
            <span class="text-muted-foreground">过期时间</span>
            <span>{{ formatDate(detail.expiresAt) }}</span>
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <p class="qs-type-compact-label m-0">
            逐人交付
          </p>
          <div v-for="delivery in detail.deliveries" :key="delivery.id" class="p-3 border border-border rounded-lg">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <span class="qs-type-body-medium">{{ delivery.recipientName ?? delivery.targetName ?? '—' }}</span>
              <FaTag variant="outline" :class="statusClass(delivery.status)">
                {{ STATUS_LABELS[delivery.status] ?? delivery.status }}
              </FaTag>
            </div>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              尝试 {{ delivery.attemptCount }} 次
              <template v-if="delivery.failureCode">
                · {{ delivery.failureCode }}
              </template>
            </p>
            <p v-if="delivery.failureMessage" class="qs-type-meta text-destructive m-0">
              {{ delivery.failureMessage }}
            </p>
          </div>
        </div>

        <FaButton
          v-if="canCancel && detail.status === 'PENDING'"
          variant="outline"
          size="sm"
          @click="cancel({ ...detail })"
        >
          取消未发送交付
        </FaButton>
      </div>
    </FaDrawer>
  </div>
</template>
