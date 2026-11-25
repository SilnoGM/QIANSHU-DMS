<script setup lang="ts">
import type { NotificationEventConfigSummaryDto } from '@/api/generated/types.gen'

import dayjs from 'dayjs'
import { computed, onMounted, ref } from 'vue'

import { useRouter } from 'vue-router'
import notificationsApi from '@/api/modules/notifications'

defineOptions({ name: 'SystemNotificationEvents' })

const router = useRouter()
const events = ref<NotificationEventConfigSummaryDto[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const keyword = ref('')
const domain = ref<string>('ALL')
const method = ref<string>('ALL')
const state = ref<string>('ALL')
let controller: AbortController | null = null

const DOMAIN_LABELS: Record<string, string> = {
  SALES: '销售',
  PURCHASE: '采购',
  SHIPMENT: '货件运输',
  FINANCE: '财务',
  INVOICE: '发票',
  RECONCILIATION: '对账',
  OPERATIONS: '运营',
  SYSTEM: '系统',
}

const DOMAIN_OPTIONS = [
  { label: '全部业务域', value: 'ALL' },
  ...Object.entries(DOMAIN_LABELS).map(([value, label]) => ({ label, value })),
]
const METHOD_OPTIONS = [
  { label: '全部渠道/方式', value: 'ALL' },
  { label: '站内通知', value: 'IN_APP' },
  { label: '企微应用消息', value: 'APP' },
  { label: '企微群机器人', value: 'ROBOT' },
  { label: '未配置企微', value: 'NONE' },
]
const STATE_OPTIONS = [
  { label: '全部状态', value: 'ALL' },
  { label: '已启用', value: 'ENABLED' },
  { label: '未启用', value: 'DISABLED' },
  { label: '未配置', value: 'UNCONFIGURED' },
]

function inAppChannel(event: NotificationEventConfigSummaryDto) {
  return event.channels.find(channel => channel.channel === 'IN_APP')
}

function wecomChannel(event: NotificationEventConfigSummaryDto) {
  return event.channels.find(channel => channel.channel === 'WECOM')
}

function eventState(event: NotificationEventConfigSummaryDto): 'ENABLED' | 'DISABLED' | 'UNCONFIGURED' {
  return event.channels.length === 0
    ? 'UNCONFIGURED'
    : event.channels.some(channel => channel.enabled) ? 'ENABLED' : 'DISABLED'
}

function stateLabel(event: NotificationEventConfigSummaryDto): string {
  return {
    ENABLED: '已启用',
    DISABLED: '未启用',
    UNCONFIGURED: '未配置',
  }[eventState(event)]
}

function stateClass(event: NotificationEventConfigSummaryDto): string {
  return {
    ENABLED: 'border-primary/25 bg-primary/10 text-primary',
    DISABLED: 'border-border bg-muted text-muted-foreground',
    UNCONFIGURED: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  }[eventState(event)]
}

function inAppLabel(event: NotificationEventConfigSummaryDto): string {
  const channel = inAppChannel(event)
  return channel === undefined
    ? '未启用'
    : channel.enabled ? `已启用 · ${channel.messageCount} 条` : '未启用'
}

function wecomLabel(event: NotificationEventConfigSummaryDto): string {
  const channel = wecomChannel(event)
  if (channel === undefined) {
    return '未配置'
  }
  const methodLabel = channel.sendMethod === 'ROBOT' ? '群机器人' : '应用消息'
  return channel.enabled ? `${methodLabel} · ${channel.messageCount} 条` : `${methodLabel} · 未启用`
}

function updatedLabel(event: NotificationEventConfigSummaryDto): string {
  const channel = event.channels[0]
  return channel === undefined ? '—' : `${dayjs(channel.updatedAt).format('YYYY-MM-DD HH:mm')} ${channel.updatedByName ?? ''}`.trim()
}

const filtered = computed(() => {
  const keywordValue = keyword.value.trim().toLowerCase()
  return events.value.filter((event) => {
    const matchesKeyword = keywordValue.length === 0
      || event.label.toLowerCase().includes(keywordValue)
      || event.eventType.toLowerCase().includes(keywordValue)
    return matchesKeyword
      && (domain.value === 'ALL' || event.domain === domain.value)
      && (state.value === 'ALL' || eventState(event) === state.value)
      && (method.value !== 'IN_APP' || inAppChannel(event) !== undefined)
      && (method.value !== 'APP' || wecomChannel(event)?.sendMethod === 'APP')
      && (method.value !== 'ROBOT' || wecomChannel(event)?.sendMethod === 'ROBOT')
      && (method.value !== 'NONE' || wecomChannel(event) === undefined)
  })
})

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    events.value = (await notificationsApi.eventConfigs.list(controller.signal)).data
  }
  catch {
    if (!controller.signal.aborted) {
      error.value = '事件配置加载失败，请稍后重试。'
    }
  }
  finally {
    if (!controller.signal.aborted) {
      loading.value = false
    }
  }
}

function openEvent(eventType: string): void {
  void router.push({ name: 'systemNotificationEventDetail', params: { eventType } })
}

onMounted(load)
</script>

<template>
  <FaPageHeader title="事件配置" description="按事件配置站内与企业微信渠道、发送方式与消息内容。">
    <FaButton variant="outline" :loading="loading" @click="load">
      <FaIcon name="i-mdi:refresh" />
      刷新
    </FaButton>
  </FaPageHeader>

  <FaPageMain main-class="min-w-0">
    <div class="flex flex-col gap-4 min-w-0" data-testid="notification-event-list">
      <div class="flex flex-wrap gap-2 items-center">
        <FaInput
          v-model="keyword"
          type="search"
          clearable
          class="max-w-full w-80"
          placeholder="搜索事件名称或 eventType"
          aria-label="搜索事件"
        >
          <template #start>
            <FaIcon name="i-lucide:search" />
          </template>
        </FaInput>
        <FaSelect v-model="domain" :options="DOMAIN_OPTIONS" class="w-40" aria-label="业务域筛选" />
        <FaSelect v-model="method" :options="METHOD_OPTIONS" class="w-44" aria-label="渠道方式筛选" />
        <FaSelect v-model="state" :options="STATE_OPTIONS" class="w-32" aria-label="配置状态筛选" />
        <span class="text-sm text-muted-foreground ml-auto">共 {{ filtered.length }} 个事件</span>
      </div>

      <FaAlert v-if="error !== null" variant="destructive" role="alert" :title="error" />

      <div v-if="loading && events.length === 0" class="text-muted-foreground flex gap-2 min-h-40 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
        正在加载事件配置…
      </div>

      <div v-else-if="filtered.length === 0" class="border border-border rounded-lg border-dashed flex min-h-40 items-center justify-center">
        <FaEmpty icon="i-lucide:inbox" title="没有匹配的事件" description="调整筛选条件后重试。" />
      </div>

      <div v-else class="border border-border rounded-lg bg-card overflow-x-auto">
        <table class="text-sm w-full">
          <thead class="text-muted-foreground bg-muted/40">
            <tr>
              <th class="font-medium px-4 py-3 text-left">
                事件
              </th>
              <th class="font-medium px-4 py-3 text-left">
                业务域
              </th>
              <th class="font-medium px-4 py-3 text-left">
                站内通知
              </th>
              <th class="font-medium px-4 py-3 text-left">
                企业微信
              </th>
              <th class="font-medium px-4 py-3 text-left">
                状态
              </th>
              <th class="font-medium px-4 py-3 text-left">
                最后更新
              </th>
              <th class="font-medium px-4 py-3 text-right">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="event in filtered"
              :key="event.eventType"
              class="border-t border-border cursor-pointer transition-colors hover:bg-muted/30"
              :data-testid="`notification-event-row-${event.eventType}`"
              @click="openEvent(event.eventType)"
            >
              <td class="px-4 py-3">
                <div class="font-medium">
                  {{ event.label }}
                </div>
                <div class="text-xs text-muted-foreground font-mono">
                  {{ event.eventType }}
                </div>
              </td>
              <td class="px-4 py-3">
                {{ DOMAIN_LABELS[event.domain] ?? event.domain }}
              </td>
              <td class="px-4 py-3">
                {{ inAppLabel(event) }}
              </td>
              <td class="px-4 py-3">
                {{ wecomLabel(event) }}
              </td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-0.5 border rounded-full inline-flex items-center" :class="stateClass(event)">
                  {{ stateLabel(event) }}
                </span>
              </td>
              <td class="text-muted-foreground px-4 py-3">
                {{ updatedLabel(event) }}
              </td>
              <td class="px-4 py-3 text-right">
                <FaButton variant="ghost" size="sm" @click.stop="openEvent(event.eventType)">
                  配置
                </FaButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </FaPageMain>
</template>
