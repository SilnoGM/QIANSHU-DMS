<script setup lang="ts">
import type { NotificationPreferenceChannelDto, NotificationPreferenceEventDto } from '@/api/generated/types.gen'

import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import {
  buildPreferenceGroups,
  PREFERENCE_CHANNEL_LABELS,
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
const pendingKey = ref<string | null>(null)

const groups = computed(() => buildPreferenceGroups(events.value))

function failureMessage(failure: unknown): string {
  return getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
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
  channel: NotificationPreferenceChannelDto,
  value: boolean | undefined,
): Promise<void> {
  if (value === undefined || !channel.available || pendingKey.value !== null) {
    return
  }
  const key = `${event.eventType}:${channel.channel}`
  const previous = channel.muted
  // 开关表达「接收」：打开＝不关闭。失败时回滚到操作前的状态。
  channel.muted = !value
  pendingKey.value = key
  try {
    await notificationsApi.preferences.update(event.eventType, channel.channel, channel.muted)
  }
  catch (failure) {
    channel.muted = previous
    toast.error(failureMessage(failure))
  }
  finally {
    pendingKey.value = null
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

    <div v-if="!loading && error === null && groups.length === 0" class="qs-type-body text-muted-foreground">
      暂无可设置的事件。管理员启用事件模板后会出现在这里。
    </div>

    <div v-else class="flex flex-col gap-6">
      <p class="qs-type-meta text-muted-foreground m-0">
        开关打开表示接收该渠道提醒；关闭后不会再收到对应事件。千树小助理需先由管理员完成微信绑定。
      </p>
      <section v-for="group in groups" :key="group.domain" class="flex flex-col gap-2">
        <h3 class="qs-type-body-medium m-0">
          {{ group.label }}
        </h3>
        <div class="border border-border rounded-lg divide-border divide-y">
          <div
            v-for="event in group.events"
            :key="event.eventType"
            class="p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span class="qs-type-body">{{ event.label }}</span>
            <div class="flex flex-wrap gap-4">
              <div
                v-for="channel in event.channels"
                :key="channel.channel"
                class="flex flex-col gap-1 min-w-28 items-start"
              >
                <span class="qs-type-meta text-muted-foreground">{{ PREFERENCE_CHANNEL_LABELS[channel.channel] }}</span>
                <FaSwitch
                  v-if="channel.available"
                  :model-value="!channel.muted"
                  :disabled="pendingKey !== null"
                  @update:model-value="value => toggle(event, channel, value)"
                />
                <span v-else class="qs-type-meta text-muted-foreground">
                  {{ preferenceUnavailableLabel(channel.unavailableReason) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </QsGenericDrawer>
</template>
