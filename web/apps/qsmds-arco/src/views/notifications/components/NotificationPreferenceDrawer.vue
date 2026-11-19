<script setup lang="ts">
import type { PreferenceChannel } from '../preference-view.logic'

import type { NotificationPreferenceEventDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import {
  buildPreferenceGroups,
  countMutedChannels,
  PREFERENCE_CHANNEL_LABELS,
  PREFERENCE_CHANNEL_ORDER,
  preferenceCells,
  preferenceUnavailableLabel,
} from '../preference-view.logic'

defineOptions({ name: 'NotificationPreferenceDrawer' })

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const toast = useQsToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const loading = ref(false)
const error = ref<string | null>(null)
const events = ref<NotificationPreferenceEventDto[]>([])
const pendingKeys = ref<ReadonlySet<string>>(new Set())

const groups = computed(() => buildPreferenceGroups(events.value))
const mutedCount = computed(() => countMutedChannels(events.value))

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

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    events.value = (await notificationsApi.preferences.list(new AbortController().signal)).data.events
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
  }
  catch (failure) {
    dto.muted = previous
    toast.error(failureMessage(failure))
  }
  finally {
    markPending(key, false)
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
      <div v-if="groups.length === 0" class="qs-type-body text-muted-foreground">
        暂无可设置的事件。管理员启用事件模板后会出现在这里。
      </div>

      <div v-else class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-2 items-start justify-between">
          <p class="qs-type-meta text-muted-foreground m-0 max-w-[32rem]">
            开关打开表示接收该渠道提醒；关闭后不会再收到对应事件。千树小助理需先由管理员完成微信绑定。
          </p>
          <span class="qs-type-meta text-muted-foreground shrink-0">
            已关闭 {{ mutedCount }} 项
          </span>
        </div>

        <div class="qs-type-meta text-muted-foreground px-3 pb-2 border-b border-border gap-2 grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center">
          <span>事件</span>
          <span v-for="channel in PREFERENCE_CHANNEL_ORDER" :key="channel" class="text-center">
            {{ PREFERENCE_CHANNEL_LABELS[channel] }}
          </span>
        </div>

        <section v-for="group in groups" :key="group.domain" class="flex flex-col gap-2">
          <h3 class="qs-type-body-medium m-0 flex items-center justify-between">
            <span>{{ group.label }}</span>
            <span class="qs-type-meta text-muted-foreground">{{ group.events.length }} 个事件</span>
          </h3>
          <div class="border border-border rounded-lg overflow-hidden">
            <div
              v-for="event in group.events"
              :key="event.eventType"
              class="px-3 py-2.5 border-b border-border gap-2 grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center last:border-b-0"
            >
              <span class="qs-type-body truncate" :title="event.label">{{ event.label }}</span>
              <div v-for="cell in preferenceCells(event)" :key="cell.channel" class="flex justify-center">
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
      </div>
    </template>
  </QsGenericDrawer>
</template>
