<script setup lang="ts">
import type { NotificationOverviewDto } from '@/api/generated/types.gen'

import { onMounted, ref } from 'vue'
import { getApiClientErrorMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'

const loading = ref(true)
const error = ref<string | null>(null)
const overview = ref<NotificationOverviewDto | null>(null)

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function formatDate(value: string | null): string {
  if (value === null) {
    return '—'
  }
  return dateTimeFormatter.format(new Date(value))
}

function formatCount(value: number | undefined): number {
  return value ?? 0
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    overview.value = (await notificationsApi.overview.get(new AbortController().signal)).data
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <FaAlert v-if="error !== null" variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="load">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div v-else-if="loading" class="text-muted-foreground flex gap-2 min-h-48 items-center justify-center">
      <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
      正在加载通知中心概览…
    </div>

    <template v-else-if="overview !== null">
      <div class="gap-4 grid lg:grid-cols-3">
        <div class="p-4 border border-border rounded-lg bg-background">
          <p class="qs-type-compact-label text-muted-foreground">
            千树小助理
          </p>
          <div class="mt-2 flex gap-2 items-center">
            <FaTag
              variant="outline"
              :class="overview.channelEnabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-muted text-muted-foreground'"
            >
              {{ overview.channelEnabled ? '已启用' : '已停用' }}
            </FaTag>
            <FaTag v-if="overview.tokenConfigured" variant="outline" class="text-foreground border-border bg-background">
              Token 已配置
            </FaTag>
            <FaTag v-else variant="outline" class="text-destructive border-destructive/30 bg-destructive/10">
              Token 未配置
            </FaTag>
          </div>
          <p class="qs-type-meta text-muted-foreground mt-2">
            {{ overview.accountName ?? '未创建公司号' }} · {{ overview.accountStatus ?? '—' }}
          </p>
          <p class="qs-type-meta text-muted-foreground">
            最后在线：{{ formatDate(overview.lastOnlineAt) }}
          </p>
        </div>

        <div class="p-4 border border-border rounded-lg bg-background lg:col-span-2">
          <p class="qs-type-compact-label text-muted-foreground">
            近 24 小时
          </p>
          <div class="mt-3 gap-3 grid grid-cols-3 sm:grid-cols-7">
            <div v-for="(label, key) in { PENDING: '待发', COMPLETED: '完成', PARTIAL: '部分', FAILED: '失败', SKIPPED: '跳过', EXPIRED: '过期', CANCELLED: '取消' }" :key="key">
              <p class="qs-type-data-emphasis">
                {{ formatCount(overview.last24Hours[key]) }}
              </p>
              <p class="qs-type-meta text-muted-foreground">
                {{ label }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="gap-4 grid lg:grid-cols-2">
        <div class="p-4 border border-border rounded-lg bg-background">
          <p class="qs-type-compact-label text-muted-foreground">
            队列
          </p>
          <p class="qs-type-body mt-2">
            待发 <span class="qs-type-data-emphasis">{{ formatCount(Number(overview.queue.pending ?? 0)) }}</span> 条
          </p>
          <p class="qs-type-meta text-muted-foreground">
            最老计划时间：{{ formatDate(typeof overview.queue.oldestNextAttemptAt === 'string' ? overview.queue.oldestNextAttemptAt : null) }}
          </p>
        </div>
        <div class="p-4 border border-border rounded-lg bg-background">
          <p class="qs-type-compact-label text-muted-foreground">
            说明
          </p>
          <p class="qs-type-meta text-muted-foreground mt-2">
            状态「完成」表示本渠道所有交付均已被 GeWe 接受，不代表员工已阅读。站内通知的已读/归档在阶段 3 接入。
          </p>
        </div>
      </div>

      <FaButton variant="outline" size="sm" @click="load">
        刷新
      </FaButton>
    </template>
  </div>
</template>
