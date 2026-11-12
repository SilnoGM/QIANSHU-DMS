<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

import { useAppAuth } from '@/composables/app/auth'

defineOptions({ name: 'SystemNotifications' })

const router = useRouter()
const { auth } = useAppAuth()

const target = computed<string | null>(() => {
  if (auth('notification-record:read')) {
    return 'systemNotificationRecords'
  }
  if (auth(['assistant-channel:read', 'assistant-account:read'])) {
    return 'systemNotificationAssistant'
  }
  if (auth(['notification-template:read', 'notification-policy:read'])) {
    return 'systemNotificationPolicies'
  }
  return null
})

watch(target, (value) => {
  if (value !== null) {
    void router.replace({ name: value })
  }
}, { immediate: true })
</script>

<template>
  <FaPageHeader
    title="通知中心"
    description="统一管理 GeWe 助理、通知策略与通知记录。"
  />
  <FaPageMain>
    <FaEmpty
      v-if="target === null"
      icon="i-lucide:shield-alert"
      title="暂无查看权限"
      description="当前账号没有通知中心的读取权限。"
      class="min-h-64"
    />
    <div v-else class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在打开通知中心…
    </div>
  </FaPageMain>
</template>
