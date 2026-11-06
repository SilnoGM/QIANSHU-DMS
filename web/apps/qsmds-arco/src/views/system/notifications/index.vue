<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useAppAuth } from '@/composables/app/auth'

import AssistantPanel from './assistant-panel.vue'
import OverviewPanel from './overview-panel.vue'
import RecordsPanel from './records-panel.vue'
import RulesPanel from './rules-panel.vue'

defineOptions({ name: 'SystemNotifications' })

const { auth } = useAppAuth()

interface TabItem {
  readonly icon: string
  readonly label: string
  readonly value: 'overview' | 'assistant' | 'rules' | 'records'
}

const tabs = computed<TabItem[]>(() => {
  const items: TabItem[] = []
  if (auth(['notification-record:read'])) {
    items.push({ icon: 'i-lucide:layout-dashboard', label: '概览', value: 'overview' })
  }
  if (auth(['assistant-channel:read', 'assistant-account:read'])) {
    items.push({ icon: 'i-lucide-bot', label: '千树小助理', value: 'assistant' })
  }
  if (auth(['notification-template:read', 'notification-policy:read'])) {
    items.push({ icon: 'i-lucide-list-checks', label: '通知规则', value: 'rules' })
  }
  if (auth(['notification-record:read'])) {
    items.push({ icon: 'i-lucide-send', label: '发送记录', value: 'records' })
  }
  return items
})

const activeTab = ref<TabItem['value']>('overview')

watch(tabs, (items) => {
  if (!items.some(item => item.value === activeTab.value)) {
    activeTab.value = items[0]?.value ?? 'overview'
  }
}, { immediate: true })
</script>

<template>
  <div class="flex flex-col gap-4">
    <FaPageHeader
      title="通知中心"
      description="统一管理千树小助理与站内通知。站外提醒失败不影响业务，关键通知请同时保留系统内入口。"
    />

    <FaPageMain>
      <FaEmpty
        v-if="tabs.length === 0"
        icon="i-lucide:shield-alert"
        title="暂无查看权限"
        description="当前账号没有通知中心的读取权限。"
        class="min-h-64"
      />

      <FaTabs
        v-else
        :model-value="activeTab"
        :list="tabs"
        data-testid="notification-center-tabs"
        class="min-w-0"
        list-class="h-auto w-full gap-1 border border-border/60 bg-muted/60 p-1 md:w-fit"
        content-class="mt-4 min-w-0"
        @update:model-value="activeTab = $event as TabItem['value']"
      >
        <template #overview>
          <OverviewPanel v-if="activeTab === 'overview'" />
        </template>
        <template #assistant>
          <AssistantPanel v-if="activeTab === 'assistant'" />
        </template>
        <template #rules>
          <RulesPanel v-if="activeTab === 'rules'" />
        </template>
        <template #records>
          <RecordsPanel v-if="activeTab === 'records'" />
        </template>
      </FaTabs>
    </FaPageMain>
  </div>
</template>
