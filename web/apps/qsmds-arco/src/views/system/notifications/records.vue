<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppAuth } from '@/composables/app/auth'
import OverviewPanel from './overview-panel.vue'
import RecordsPanel from './records-panel.vue'

defineOptions({ name: 'SystemNotificationRecords' })

const { auth } = useAppAuth()
const canRead = computed(() => auth('notification-record:read'))
const overviewRef = ref<InstanceType<typeof OverviewPanel> | null>(null)
const recordsRef = ref<InstanceType<typeof RecordsPanel> | null>(null)
const refreshing = ref(false)

async function refreshAll(): Promise<void> {
  if (refreshing.value) {
    return
  }
  refreshing.value = true
  try {
    await Promise.all([
      overviewRef.value?.refresh(),
      recordsRef.value?.refresh(),
    ])
  }
  finally {
    refreshing.value = false
  }
}

async function refreshOverview(): Promise<void> {
  await overviewRef.value?.refresh()
}
</script>

<template>
  <FaPageHeader
    title="通知记录"
    description="按发布时间倒序查看全渠道通知、投递结果与失败原因。"
  >
    <FaButton v-if="canRead" variant="outline" :loading="refreshing" @click="refreshAll">
      <FaIcon name="i-mdi:refresh" />
      刷新
    </FaButton>
  </FaPageHeader>
  <FaPageMain main-class="min-w-0">
    <FaEmpty
      v-if="!canRead"
      icon="i-lucide:shield-x"
      title="没有权限"
      description="当前账号不能查看通知记录。"
      class="min-h-64"
    />
    <div v-else class="flex flex-col gap-4 min-w-0">
      <OverviewPanel ref="overviewRef" />
      <RecordsPanel ref="recordsRef" @changed="refreshOverview" />
    </div>
  </FaPageMain>
</template>
