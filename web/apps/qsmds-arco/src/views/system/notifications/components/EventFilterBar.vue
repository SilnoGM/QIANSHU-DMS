<script setup lang="ts">
import type { EventTableFilter } from '../event-config.logic'

import { computed } from 'vue'

const keyword = defineModel<string>('keyword', { required: true })
const status = defineModel<EventTableFilter>('status', { required: true })

const STATUS_FILTER_OPTIONS: Array<{ label: string, value: EventTableFilter }> = [
  { label: '全部状态', value: 'ALL' },
  { label: '已配齐', value: 'READY' },
  { label: '部分配置', value: 'PARTIAL' },
  { label: '缺模板', value: 'MISSING_TEMPLATE' },
  { label: '未配置', value: 'UNCONFIGURED' },
  { label: '未接入', value: 'UNIMPLEMENTED' },
  { label: '已停用', value: 'DISABLED' },
  { label: '待确认', value: 'UNKNOWN' },
]

const hasFilter = computed(() => keyword.value.trim().length > 0 || status.value !== 'ALL')

function reset(): void {
  keyword.value = ''
  status.value = 'ALL'
}
</script>

<template>
  <div class="flex flex-wrap gap-2 items-center" data-testid="notification-event-filter-bar">
    <FaInput
      v-model="keyword"
      type="search"
      clearable
      class="max-w-full w-80"
      placeholder="搜索事件或模板 Key"
      aria-label="搜索事件"
    >
      <template #start>
        <FaIcon name="i-lucide:search" />
      </template>
    </FaInput>
    <FaSelect v-model="status" :options="STATUS_FILTER_OPTIONS" class="w-32" aria-label="配置状态筛选" />
    <FaButton v-if="hasFilter" variant="ghost" size="sm" @click="reset">
      清除筛选
    </FaButton>
  </div>
</template>
