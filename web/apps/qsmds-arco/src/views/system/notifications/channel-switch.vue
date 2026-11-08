<script setup lang="ts">
import type { AssistantChannelDto } from '@/api/generated/types.gen'

import { computed, onMounted, ref } from 'vue'

import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useAppAuth } from '@/composables/app/auth'

const toast = useQsToast()
const { auth } = useAppAuth()
const canUpdate = computed(() => auth('assistant-channel:update'))

const channel = ref<AssistantChannelDto | null>(null)
const enabled = ref(false)
const loading = ref(true)
const busy = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    channel.value = (await notificationsApi.assistant.channel.get(new AbortController().signal)).data
    enabled.value = channel.value.enabled
  }
  catch {
    channel.value = null
    enabled.value = false
  }
  finally {
    loading.value = false
  }
}

async function toggle(value: unknown): Promise<void> {
  if (channel.value === null || !canUpdate.value || busy.value) {
    return
  }
  busy.value = true
  try {
    channel.value = (await notificationsApi.assistant.channel.update({
      enabled: Boolean(value),
      expectedVersion: channel.value.version,
    })).data
    enabled.value = channel.value.enabled
    toast.success(channel.value.enabled ? '渠道已启用' : '渠道已停用')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <span class="inline-flex origin-right scale-150">
    <FaSwitch
      :model-value="enabled"
      :disabled="loading || busy || !canUpdate || channel === null"
      aria-label="启用 GeWe 助理渠道"
      @update:model-value="toggle"
    />
  </span>
</template>
