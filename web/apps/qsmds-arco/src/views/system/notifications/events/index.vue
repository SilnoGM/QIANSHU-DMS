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

const DOMAIN_DOT_CLASS: Record<string, string> = {
  SALES: 'bg-sky-500',
  PURCHASE: 'bg-amber-500',
  SHIPMENT: 'bg-teal-500',
  FINANCE: 'bg-rose-500',
  INVOICE: 'bg-violet-500',
  RECONCILIATION: 'bg-indigo-500',
  OPERATIONS: 'bg-orange-500',
  SYSTEM: 'bg-slate-400',
}

type ChannelState = 'ENABLED' | 'DISABLED' | 'UNCONFIGURED'

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

function stateDotClass(event: NotificationEventConfigSummaryDto): string {
  return {
    ENABLED: 'bg-primary',
    DISABLED: 'bg-muted-foreground/40',
    UNCONFIGURED: 'bg-amber-500',
  }[eventState(event)]
}

function channelState(channel: NotificationEventConfigSummaryDto['channels'][number] | undefined): ChannelState {
  if (channel === undefined) {
    return 'UNCONFIGURED'
  }
  return channel.enabled ? 'ENABLED' : 'DISABLED'
}

function channelStateLabel(state: ChannelState): string {
  return {
    ENABLED: '已启用',
    DISABLED: '未启用',
    UNCONFIGURED: '未配置',
  }[state]
}

function channelStateDotClass(state: ChannelState): string {
  return {
    ENABLED: 'bg-emerald-500',
    DISABLED: 'bg-muted-foreground/40',
    UNCONFIGURED: 'bg-amber-500',
  }[state]
}

function channelStateTextClass(state: ChannelState): string {
  return {
    ENABLED: 'text-foreground',
    DISABLED: 'text-muted-foreground',
    UNCONFIGURED: 'text-amber-700 dark:text-amber-400',
  }[state]
}

function inAppDetail(event: NotificationEventConfigSummaryDto): string {
  const channel = inAppChannel(event)
  if (channel === undefined) {
    return '尚未配置渠道'
  }
  return channel.enabled ? `${channel.messageCount} 条消息` : '当前不会发送'
}

function wecomDetail(event: NotificationEventConfigSummaryDto): string {
  const channel = wecomChannel(event)
  if (channel === undefined) {
    return '尚未配置企微'
  }
  const methodLabel = channel.sendMethod === 'ROBOT' ? '群机器人' : '应用消息'
  return channel.enabled ? `${methodLabel} · ${channel.messageCount} 条` : `${methodLabel} · 当前不会发送`
}

function latestChannel(event: NotificationEventConfigSummaryDto): NotificationEventConfigSummaryDto['channels'][number] | undefined {
  return event.channels.reduce<NotificationEventConfigSummaryDto['channels'][number] | undefined>(
    (latest, channel) => latest === undefined || dayjs(channel.updatedAt).isAfter(dayjs(latest.updatedAt))
      ? channel
      : latest,
    undefined,
  )
}

function updatedAtLabel(event: NotificationEventConfigSummaryDto): string {
  const channel = latestChannel(event)
  return channel === undefined ? '—' : dayjs(channel.updatedAt).format('YYYY-MM-DD HH:mm')
}

function updatedByLabel(event: NotificationEventConfigSummaryDto): string {
  return latestChannel(event)?.updatedByName ?? ''
}

const hasFilters = computed(() =>
  keyword.value.trim().length > 0
  || domain.value !== 'ALL'
  || method.value !== 'ALL'
  || state.value !== 'ALL',
)

function clearFilters(): void {
  keyword.value = ''
  domain.value = 'ALL'
  method.value = 'ALL'
  state.value = 'ALL'
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
      <div class="p-3 border border-border rounded-xl bg-card flex flex-wrap gap-2 items-center">
        <FaInput
          v-model="keyword"
          type="search"
          clearable
          class="max-w-full w-72"
          placeholder="搜索事件名称或事件编码"
          aria-label="搜索事件"
        >
          <template #start>
            <FaIcon name="i-lucide:search" />
          </template>
        </FaInput>
        <FaSelect v-model="domain" :options="DOMAIN_OPTIONS" class="w-36" aria-label="业务域筛选" />
        <FaSelect v-model="method" :options="METHOD_OPTIONS" class="w-44" aria-label="渠道方式筛选" />
        <FaSelect v-model="state" :options="STATE_OPTIONS" class="w-32" aria-label="配置状态筛选" />
        <div class="ml-auto flex gap-2 items-center">
          <span class="text-xs text-muted-foreground whitespace-nowrap">
            共 <span class="text-foreground font-medium tabular-nums">{{ filtered.length }}</span> 个事件
          </span>
          <FaButton v-if="hasFilters" variant="ghost" size="sm" @click="clearFilters">
            <FaIcon name="i-lucide:x" />
            清除筛选
          </FaButton>
        </div>
      </div>

      <FaAlert v-if="error !== null" variant="destructive" role="alert" :title="error" />

      <div v-if="loading && events.length === 0" class="text-muted-foreground border border-border rounded-xl border-dashed flex gap-2 min-h-48 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
        正在加载事件配置…
      </div>

      <div v-else-if="filtered.length === 0" class="border border-border rounded-xl border-dashed flex flex-col gap-3 min-h-48 items-center justify-center">
        <FaEmpty icon="i-lucide:inbox" title="没有匹配的事件" description="调整筛选条件后重试。" />
        <FaButton v-if="hasFilters" variant="outline" size="sm" @click="clearFilters">
          清除筛选
        </FaButton>
      </div>

      <div v-else class="border border-border rounded-xl bg-card overflow-x-auto">
        <table class="text-sm min-w-[1040px] w-full table-fixed">
          <colgroup>
            <col class="w-[24%]">
            <col class="w-[10%]">
            <col class="w-[12%]">
            <col class="w-[19%]">
            <col class="w-[11%]">
            <col class="w-[15%]">
            <col class="w-[9%]">
          </colgroup>
          <thead class="text-muted-foreground border-b border-border bg-muted/40">
            <tr>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                事件
              </th>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                业务域
              </th>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                站内通知
              </th>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                企业微信
              </th>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                状态
              </th>
              <th class="text-xs font-medium px-4 py-3 text-left whitespace-nowrap">
                最后更新
              </th>
              <th class="text-xs font-medium px-4 py-3 text-right whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-border/70 divide-y">
            <tr
              v-for="event in filtered"
              :key="event.eventType"
              class="group cursor-pointer transition-colors hover:bg-muted/30"
              :data-testid="`notification-event-row-${event.eventType}`"
              @click="openEvent(event.eventType)"
            >
              <td class="px-4 py-3">
                <div class="text-sm font-medium truncate" :title="event.label">
                  {{ event.label }}
                </div>
                <div class="text-[11px] text-muted-foreground font-mono mt-0.5 truncate" :title="event.eventType">
                  {{ event.eventType }}
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="text-xs inline-flex gap-1.5 whitespace-nowrap items-center">
                  <span class="rounded-full shrink-0 size-1.5" :class="DOMAIN_DOT_CLASS[event.domain] ?? 'bg-slate-400'" />
                  {{ DOMAIN_LABELS[event.domain] ?? event.domain }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5 whitespace-nowrap items-center">
                  <span class="rounded-full shrink-0 size-1.5" :class="channelStateDotClass(channelState(inAppChannel(event)))" />
                  <span class="text-xs" :class="channelStateTextClass(channelState(inAppChannel(event)))">
                    {{ channelStateLabel(channelState(inAppChannel(event))) }}
                  </span>
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5 truncate" :title="inAppDetail(event)">
                  {{ inAppDetail(event) }}
                </div>
              </td>
              <td class="px-4 py-3">
                <div class="flex gap-1.5 whitespace-nowrap items-center">
                  <span class="rounded-full shrink-0 size-1.5" :class="channelStateDotClass(channelState(wecomChannel(event)))" />
                  <span class="text-xs" :class="channelStateTextClass(channelState(wecomChannel(event)))">
                    {{ channelStateLabel(channelState(wecomChannel(event))) }}
                  </span>
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5 truncate" :title="wecomDetail(event)">
                  {{ wecomDetail(event) }}
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="text-xs px-2 py-0.5 border rounded-full inline-flex gap-1.5 whitespace-nowrap items-center" :class="stateClass(event)">
                  <span class="rounded-full size-1.5" :class="stateDotClass(event)" />
                  {{ stateLabel(event) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="text-xs whitespace-nowrap tabular-nums">
                  {{ updatedAtLabel(event) }}
                </div>
                <div class="text-[11px] text-muted-foreground mt-0.5 truncate" :title="updatedByLabel(event)">
                  {{ updatedByLabel(event) || '—' }}
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  type="button"
                  class="text-sm text-primary font-medium inline-flex gap-0.5 whitespace-nowrap items-center hover:underline"
                  @click.stop="openEvent(event.eventType)"
                >
                  配置
                  <FaIcon name="i-lucide:chevron-right" class="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </FaPageMain>
</template>
