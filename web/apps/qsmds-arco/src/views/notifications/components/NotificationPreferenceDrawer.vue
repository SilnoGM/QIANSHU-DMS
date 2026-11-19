<script setup lang="ts">
import type { PreferenceChannel } from '../preference-view.logic'

import type {
  NotificationPreferenceChannelDto,
  NotificationPreferenceChannelSettingDto,
  NotificationPreferenceEventDto,
} from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import {
  buildPreferenceGroups,
  countMutedChannels,
  enabledPreferenceChannels,
  PREFERENCE_CHANNEL_LABELS,
  PREFERENCE_CHANNEL_ORDER,
  preferenceUnavailableLabel,
  visiblePreferenceCells,
} from '../preference-view.logic'

defineOptions({ name: 'NotificationPreferenceDrawer' })

const props = defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

interface MutedTarget {
  readonly event: NotificationPreferenceEventDto
  readonly channel: PreferenceChannel
  readonly dto: NotificationPreferenceChannelDto
}

const SCOPE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '已关闭', value: 'closed' },
]

const toast = useQsToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const loading = ref(false)
const error = ref<string | null>(null)
const events = ref<NotificationPreferenceEventDto[]>([])
const channelSettings = ref<NotificationPreferenceChannelSettingDto[]>([])
const pendingKeys = ref<ReadonlySet<string>>(new Set())
const keyword = ref('')
const scope = ref<'all' | 'closed'>('all')
const restoringAll = ref(false)
const savedVisible = ref(false)
const assistantBound = ref(true)
let savedTimer: ReturnType<typeof setTimeout> | undefined

const visibleChannels = computed(() => enabledPreferenceChannels(channelSettings.value))
const hiddenChannelLabels = computed(() =>
  PREFERENCE_CHANNEL_ORDER
    .filter(channel => !visibleChannels.value.includes(channel))
    .map(channel => PREFERENCE_CHANNEL_LABELS[channel]),
)
const filtered = computed(() => keyword.value.trim().length > 0 || scope.value !== 'all')
const assistantHint = computed(() => {
  if (!visibleChannels.value.includes('ASSISTANT')) {
    return ''
  }
  return assistantBound.value
    ? '千树小助理需先由管理员完成微信绑定。'
    : '你尚未绑定千树小助理，开启后需管理员完成绑定才会送达。'
})
const groups = computed(() => buildPreferenceGroups(events.value, {
  visibleChannels: visibleChannels.value,
  keyword: keyword.value,
  closedOnly: scope.value === 'closed',
}))
const mutedCount = computed(() => countMutedChannels(events.value, visibleChannels.value))
const mutedTargets = computed<MutedTarget[]>(() => {
  const targets: MutedTarget[] = []
  for (const event of events.value) {
    for (const cell of visiblePreferenceCells(event, visibleChannels.value)) {
      if (cell.dto?.available === true && cell.dto.muted) {
        targets.push({ event, channel: cell.channel, dto: cell.dto })
      }
    }
  }
  return targets
})
const gridClass = computed(() => visibleChannels.value.length >= 2
  ? 'grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]'
  : 'grid-cols-[minmax(0,1fr)_5.5rem]')

function failureMessage(failure: unknown): string {
  return getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
}

function preferenceKey(eventType: string, channel: PreferenceChannel): string {
  return `${eventType}:${channel}`
}

function isPending(eventType: string, channel: PreferenceChannel): boolean {
  return pendingKeys.value.has(preferenceKey(eventType, channel))
}

function markPending(key: string, pending: boolean): void {
  const next = new Set(pendingKeys.value)
  if (pending) {
    next.add(key)
  }
  else {
    next.delete(key)
  }
  pendingKeys.value = next
}

function showSaved(): void {
  savedVisible.value = true
  if (savedTimer !== undefined) {
    clearTimeout(savedTimer)
  }
  savedTimer = setTimeout(() => {
    savedVisible.value = false
  }, 2_000)
}

function changeScope(value: unknown): void {
  if (value === 'all' || value === 'closed') {
    scope.value = value
  }
}

function clearFilters(): void {
  keyword.value = ''
  scope.value = 'all'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const data = (await notificationsApi.preferences.list(new AbortController().signal)).data
    events.value = data.events
    channelSettings.value = data.channels
    assistantBound.value = data.assistantBound
  }
  catch (failure) {
    error.value = failureMessage(failure)
  }
  finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (value) => {
  if (value) {
    void load()
  }
})

onBeforeUnmount(() => {
  if (savedTimer !== undefined) {
    clearTimeout(savedTimer)
  }
})

async function toggle(
  event: NotificationPreferenceEventDto,
  channel: PreferenceChannel,
  value: boolean | undefined,
): Promise<void> {
  if (value === undefined) {
    return
  }
  const dto = event.channels.find(item => item.channel === channel)
  if (dto === undefined || !dto.available) {
    return
  }
  const key = preferenceKey(event.eventType, channel)
  // 只拦截同一个开关的重复提交；其他开关的保存不应互相阻塞。
  if (pendingKeys.value.has(key)) {
    return
  }
  const previous = dto.muted
  // 开关表达「接收」：打开＝不关闭。失败时回滚到操作前的状态。
  dto.muted = !value
  markPending(key, true)
  try {
    await notificationsApi.preferences.update(event.eventType, channel, dto.muted)
    showSaved()
  }
  catch (failure) {
    dto.muted = previous
    toast.error(failureMessage(failure))
  }
  finally {
    markPending(key, false)
  }
}

async function restoreAll(): Promise<void> {
  const targets = mutedTargets.value
  if (restoringAll.value || targets.length === 0) {
    return
  }
  restoringAll.value = true
  try {
    await Promise.all(
      targets.map(target => notificationsApi.preferences.update(target.event.eventType, target.channel, false)),
    )
    for (const target of targets) {
      target.dto.muted = false
    }
    showSaved()
    toast.success(`已恢复 ${targets.length} 项接收`)
  }
  catch (failure) {
    // 批量中任意一条失败都会重载，确保界面与数据库一致。
    toast.error(failureMessage(failure))
    await load()
  }
  finally {
    restoringAll.value = false
  }
}
</script>

<template>
  <QsGenericDrawer
    v-model="open"
    title="接收设置"
    description="只影响你本人；管理员未启用的事件或渠道不可调整。"
    size="lg"
    :loading="loading"
    :error="error"
  >
    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="load">
        重试
      </FaButton>
    </template>

    <template v-if="error === null">
      <div v-if="events.length === 0" class="qs-type-body text-muted-foreground">
        暂无可设置的事件。管理员启用事件模板后会出现在这里。
      </div>

      <div v-else-if="visibleChannels.length === 0" class="qs-type-body text-muted-foreground">
        当前没有可用的通知渠道。管理员启用渠道后再来设置。
      </div>

      <div v-else class="flex flex-col gap-3">
        <p class="qs-type-meta text-muted-foreground m-0">
          开关打开表示接收该渠道提醒；关闭后不会再收到对应事件。{{ assistantHint }}
        </p>

        <div
          v-if="hiddenChannelLabels.length > 0"
          class="qs-type-meta text-muted-foreground px-3 py-2 border border-border rounded-md bg-muted/40"
        >
          {{ hiddenChannelLabels.join('、') }}渠道当前未启用，相关开关暂不可调整。
        </div>

        <div class="px-1 pb-2 pt-1 bg-background flex flex-col gap-2 top-0 sticky z-10 -mx-1">
          <div class="flex flex-wrap gap-2 items-center">
            <FaInput v-model="keyword" placeholder="搜索事件名称" class="w-full sm:w-56" />
            <FaSelect
              :model-value="scope"
              :options="SCOPE_OPTIONS"
              class="w-28"
              @update:model-value="changeScope"
            />
            <span class="qs-type-meta text-muted-foreground">已关闭 {{ mutedCount }} 项</span>
            <span v-if="savedVisible" class="qs-type-meta text-primary flex gap-1 items-center">
              <FaIcon name="i-lucide:check" aria-hidden="true" />已保存
            </span>
            <FaButton
              class="ml-auto"
              variant="outline"
              size="sm"
              :disabled="mutedCount === 0 || restoringAll"
              :loading="restoringAll"
              @click="restoreAll"
            >
              恢复全部
            </FaButton>
          </div>

          <div
            class="qs-type-meta text-muted-foreground px-3 pb-2 border-b border-border gap-2 grid items-center"
            :class="gridClass"
          >
            <span>事件</span>
            <span
              v-for="channel in visibleChannels"
              :key="channel"
              class="text-center flex flex-col gap-0.5 items-center"
            >
              {{ PREFERENCE_CHANNEL_LABELS[channel] }}
              <span
                v-if="channel === 'ASSISTANT' && !assistantBound"
                class="text-[10px] leading-none px-1 py-0.5 rounded bg-muted"
              >未绑定</span>
            </span>
          </div>
        </div>

        <div v-if="groups.length === 0" class="qs-type-body text-muted-foreground flex flex-col gap-2 items-start">
          <span>{{ filtered ? '没有匹配的事件。' : '暂无可设置的事件。' }}</span>
          <FaButton v-if="filtered" variant="outline" size="sm" @click="clearFilters">
            清空筛选
          </FaButton>
        </div>

        <template v-else>
          <section v-for="group in groups" :key="group.domain" class="flex flex-col gap-2">
            <h3 class="qs-type-body-medium m-0 flex items-center justify-between">
              <span>{{ group.label }}</span>
              <span class="qs-type-meta text-muted-foreground">{{ group.events.length }} 个事件</span>
            </h3>
            <div class="border border-border rounded-lg overflow-hidden">
              <div
                v-for="event in group.events"
                :key="event.eventType"
                class="px-3 py-2.5 border-b border-border gap-2 grid items-center last:border-b-0"
                :class="gridClass"
              >
                <span class="qs-type-body truncate" :title="event.label">{{ event.label }}</span>
                <div v-for="cell in visiblePreferenceCells(event, visibleChannels)" :key="cell.channel" class="flex justify-center">
                  <FaSwitch
                    v-if="cell.dto?.available === true"
                    :model-value="!cell.dto.muted"
                    :disabled="isPending(event.eventType, cell.channel)"
                    :aria-label="`接收${event.label} · ${PREFERENCE_CHANNEL_LABELS[cell.channel]}`"
                    @update:model-value="value => toggle(event, cell.channel, value)"
                  />
                  <span
                    v-else-if="cell.dto !== null"
                    class="qs-type-meta text-muted-foreground text-center"
                    :title="preferenceUnavailableLabel(cell.dto.unavailableReason)"
                  >
                    {{ preferenceUnavailableLabel(cell.dto.unavailableReason) }}
                  </span>
                  <span v-else class="qs-type-meta text-muted-foreground">—</span>
                </div>
              </div>
            </div>
          </section>
        </template>
      </div>
    </template>
  </QsGenericDrawer>
</template>
