<script setup lang="ts">
import type { NotificationInboxItemDto } from '@/api/generated/types.gen'

import { useRouter } from 'vue-router'

import { getApiClientErrorMessage } from '@/api/errors'
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({
  name: 'ToolbarNotificationPanel',
})

const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const toast = useQsToast()
const store = useAppNotificationStore()

const formatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function formatDate(value: string): string {
  return formatter.format(new Date(value))
}

async function handleClick(item: NotificationInboxItemDto): Promise<void> {
  try {
    if (item.readAt === null) {
      await store.markRead(item.id)
    }
    await router.push({ name: 'notificationCenter', query: { id: item.id } })
    emit('close')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

async function handleReadAll(): Promise<void> {
  try {
    await store.readAll()
    toast.success('已全部标记为已读')
  }
  catch (failure) {
    toast.error(getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0]))
  }
}

function handleViewAll(): void {
  emit('close')
  void router.push({ name: 'notificationCenter' })
}

onMounted(() => {
  void store.refreshUnread()
  void store.refreshRecent()
})
</script>

<template>
  <div class="flex flex-col max-h-96 w-80">
    <div class="px-3 py-2 border-b flex items-center justify-between">
      <span class="qs-type-body-medium">站内通知</span>
      <span v-if="store.unreadTotal > 0" class="qs-type-meta text-destructive">{{ store.unreadTotal }} 条未读</span>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div v-if="store.loading" class="text-muted-foreground p-6 flex items-center justify-center">
        正在加载…
      </div>
      <div v-else-if="store.recent.length === 0" class="qs-type-meta text-muted-foreground p-6 text-center">
        暂无通知
      </div>
      <button
        v-for="item in store.recent"
        :key="item.id"
        type="button"
        class="px-3 py-2.5 text-left border-0 bg-transparent flex gap-2 w-full items-start hover:bg-muted"
        @click="handleClick(item)"
      >
        <span
          class="mt-1.5 rounded-full shrink-0 size-1.5"
          :class="item.readAt === null ? 'bg-destructive' : 'bg-transparent'"
        />
        <span class="flex flex-col gap-1 min-w-0">
          <span class="qs-type-body line-clamp-2" :class="{ 'op-60': item.readAt !== null }">{{ item.title }}</span>
          <span class="qs-type-meta text-muted-foreground">{{ formatDate(item.createdAt) }}</span>
        </span>
      </button>
    </div>
    <div class="px-2 py-1 border-t flex items-center justify-between">
      <FaButton variant="ghost" size="sm" :disabled="store.unreadTotal === 0" @click="handleReadAll">
        全部已读
      </FaButton>
      <FaButton variant="ghost" size="sm" @click="handleViewAll">
        查看全部
      </FaButton>
    </div>
  </div>
</template>
