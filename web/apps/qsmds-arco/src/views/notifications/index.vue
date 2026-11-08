<script setup lang="ts">
import type { NotificationInboxDetailDto, NotificationInboxItemDto } from '@/api/generated/types.gen'
import type { NotificationInboxDomain, NotificationInboxStatus } from '@/api/modules/notifications'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import { useRoute, useRouter } from 'vue-router'

import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'

defineOptions({ name: 'NotificationCenter' })

const route = useRoute()
const router = useRouter()
const toast = useQsToast()
const store = useAppNotificationStore()

const loading = ref(true)
const error = ref<string | null>(null)
const items = ref<NotificationInboxItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const status = ref<NotificationInboxStatus>('all')
const domain = ref<'all' | NotificationInboxDomain>('all')

const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<NotificationInboxDetailDto | null>(null)

const STATUS_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '未读', value: 'unread' },
  { label: '已归档', value: 'archived' },
]
const DOMAIN_OPTIONS = [
  { label: '全部业务域', value: 'all' },
  { label: '采购', value: 'purchase' },
  { label: '资金', value: 'fund' },
  { label: '发票', value: 'invoice' },
  { label: '对账', value: 'reconciliation' },
  { label: '货件', value: 'shipment' },
]
const DOMAIN_LABELS: Record<string, string> = {
  purchase: '采购',
  fund: '资金',
  invoice: '发票',
  reconciliation: '对账',
  shipment: '货件',
}

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

function domainLabel(value: string | null): string {
  return value === null ? '—' : DOMAIN_LABELS[value] ?? value
}

const columns: QsGenericTableColumn<NotificationInboxItemDto>[] = [
  { accessorKey: 'title', id: 'title', title: '标题', minWidth: 280 },
  { accessorKey: 'domain', id: 'domain', title: '业务域', width: 100 },
  { accessorKey: 'createdAt', id: 'createdAt', title: '时间', width: 170 },
  { accessorKey: 'readAt', id: 'readAt', title: '状态', width: 100 },
]

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = (await notificationsApi.inbox.list({
      status: status.value,
      ...(domain.value === 'all' ? {} : { domain: domain.value }),
      page: page.value,
      pageSize: pageSize.value,
    }, new AbortController().signal)).data
    items.value = result.items
    total.value = result.total
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    loading.value = false
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([load(), store.refreshUnread()])
}

function changeStatus(value: unknown): void {
  if (typeof value !== 'string') {
    return
  }
  status.value = value as NotificationInboxStatus
  page.value = 1
}

function changeDomain(value: unknown): void {
  if (typeof value !== 'string') {
    return
  }
  domain.value = value === 'all' ? 'all' : value as NotificationInboxDomain
  page.value = 1
}

function changePage(next: number): void {
  page.value = next
  void load()
}

function changePageSize(next: number): void {
  pageSize.value = next
  page.value = 1
  void load()
}

async function openDetail(item: NotificationInboxItemDto): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    if (item.readAt === null) {
      await notificationsApi.inbox.read(item.id)
      item.readAt = new Date().toISOString()
      await store.refreshUnread()
    }
    detail.value = (await notificationsApi.inbox.get(item.id, new AbortController().signal)).data
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
    detailOpen.value = false
  }
  finally {
    detailLoading.value = false
  }
}

async function markUnread(item: NotificationInboxItemDto): Promise<void> {
  try {
    await notificationsApi.inbox.unread(item.id)
    item.readAt = null
    await refreshAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function toggleArchive(item: NotificationInboxItemDto): Promise<void> {
  try {
    if (item.archivedAt === null) {
      await notificationsApi.inbox.archive(item.id)
      toast.success('已归档')
    }
    else {
      await notificationsApi.inbox.unarchive(item.id)
      toast.success('已取消归档')
    }
    detailOpen.value = false
    await refreshAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function readAll(): Promise<void> {
  try {
    const result = (await notificationsApi.inbox.readAll(domain.value === 'all' ? undefined : domain.value)).data
    toast.success(`已标记 ${result.updated} 条为已读`)
    await refreshAll()
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function openFromQuery(): Promise<void> {
  const id = route.query.id
  if (typeof id !== 'string' || id.length === 0) {
    return
  }
  try {
    detailOpen.value = true
    detailLoading.value = true
    detail.value = (await notificationsApi.inbox.get(id, new AbortController().signal)).data
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
    detailOpen.value = false
  }
  finally {
    detailLoading.value = false
  }
}

function openLink(): void {
  const link = detail.value?.linkUrl
  if (!link) {
    return
  }
  detailOpen.value = false
  if (link.startsWith('/')) {
    void router.push(link)
  }
  else {
    window.open(link, '_blank', 'noopener,noreferrer')
  }
}

watch(status, () => void load())
watch(domain, () => void load())
watch(() => route.query.id, () => void openFromQuery())

onMounted(async () => {
  await load()
  await store.refreshUnread()
  await openFromQuery()
})
</script>

<template>
  <FaPageHeader title="通知中心" description="站内通知、业务提醒与已读归档" />
  <FaPageMain>
    <div class="flex flex-wrap gap-2 items-center justify-between">
      <div class="flex flex-wrap gap-3 items-center">
        <label class="qs-type-meta text-muted-foreground flex gap-2 items-center">
          状态
          <FaSelect
            :model-value="status"
            :options="STATUS_OPTIONS"
            class="w-32"
            @update:model-value="changeStatus"
          />
        </label>
        <label class="qs-type-meta text-muted-foreground flex gap-2 items-center">
          业务域
          <FaSelect
            :model-value="domain"
            :options="DOMAIN_OPTIONS"
            class="w-36"
            @update:model-value="changeDomain"
          />
        </label>
      </div>
      <FaButton variant="outline" size="sm" :disabled="store.unreadTotal === 0" @click="readAll">
        全部已读
      </FaButton>
    </div>

    <FaAlert v-if="error !== null" variant="destructive" :title="error" class="mt-4">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="load">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div v-else class="mt-4">
      <QsGenericTable
        :columns="columns"
        :data="items"
        :addable="false"
        :searchable="false"
        :show-column-settings="false"
        :show-pagination="false"
        :show-row-number="false"
        :action-column="{ width: 240, minWidth: 240, align: 'right' }"
        row-key="id"
        :loading="loading"
        data-testid="notification-inbox-table"
      >
        <template #cell-domain="{ row }">
          {{ domainLabel(row.original.domain) }}
        </template>
        <template #cell-createdAt="{ row }">
          {{ formatDate(row.original.createdAt) }}
        </template>
        <template #cell-readAt="{ row }">
          <FaTag v-if="row.original.archivedAt !== null" variant="outline">
            已归档
          </FaTag>
          <FaTag v-else-if="row.original.readAt === null" variant="outline" class="text-destructive">
            未读
          </FaTag>
          <span v-else class="text-muted-foreground">已读</span>
        </template>
        <template #actions="{ row }">
          <div class="flex flex-wrap gap-2">
            <FaButton size="sm" @click="openDetail(row)">
              查看
            </FaButton>
            <FaButton
              v-if="row.readAt !== null && row.archivedAt === null"
              variant="outline"
              size="sm"
              @click="markUnread(row)"
            >
              标记未读
            </FaButton>
            <FaButton variant="outline" size="sm" @click="toggleArchive(row)">
              {{ row.archivedAt === null ? '归档' : '取消归档' }}
            </FaButton>
          </div>
        </template>
      </QsGenericTable>

      <nav v-if="total > 0" class="mt-4 overflow-x-auto" aria-label="通知分页">
        <FaPagination
          :page="page"
          :size="pageSize"
          :total="total"
          :sizes="[20, 50, 100]"
          layout="total, sizes, ->, pager"
          :text-templates="{ total: value => `共 ${value} 条`, sizes: value => `${value} 条/页` }"
          @update:page="changePage"
          @update:size="changePageSize"
        />
      </nav>
    </div>

    <FaDrawer v-model="detailOpen" title="通知详情" side="right" :footer="false">
      <div v-if="detailLoading" class="text-muted-foreground p-4">
        正在加载…
      </div>
      <div v-else-if="detail !== null" class="flex flex-col gap-4">
        <div>
          <h3 class="qs-type-title m-0">
            {{ detail.title }}
          </h3>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            {{ domainLabel(detail.domain) }} · {{ formatDate(detail.createdAt) }}
          </p>
        </div>
        <p class="qs-type-body m-0 whitespace-pre-wrap">
          {{ detail.body }}
        </p>
        <div class="flex flex-wrap gap-2">
          <FaButton v-if="detail.linkUrl" size="sm" @click="openLink">
            打开业务页面
          </FaButton>
          <FaButton variant="outline" size="sm" @click="toggleArchive(detail)">
            {{ detail.archivedAt === null ? '归档' : '取消归档' }}
          </FaButton>
        </div>
      </div>
    </FaDrawer>
  </FaPageMain>
</template>
