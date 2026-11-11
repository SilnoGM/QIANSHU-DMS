<script setup lang="ts">
import type { NotificationOverviewDto } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { formatNotificationDateTime } from './template-key-grouping.logic'

defineOptions({ name: 'NotificationOverviewPanel' })

const loading = ref(true)
const error = ref<string | null>(null)
const overview = ref<NotificationOverviewDto | null>(null)
let requestVersion = 0
let controller: AbortController | null = null

const metrics = computed(() => {
  const counts = overview.value?.last24Hours ?? {}
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const oldestPendingAt = typeof overview.value?.queue.oldestNextAttemptAt === 'string'
    ? overview.value.queue.oldestNextAttemptAt
    : null
  return {
    total,
    completed: counts.COMPLETED ?? 0,
    attention: (counts.FAILED ?? 0) + (counts.PARTIAL ?? 0) + (counts.EXPIRED ?? 0),
    pending: Number(overview.value?.queue.pending ?? 0),
    oldestPendingLabel: formatNotificationDateTime(oldestPendingAt),
  }
})

async function refresh(): Promise<void> {
  const version = ++requestVersion
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = null
  try {
    const response = await notificationsApi.overview.get(controller.signal)
    if (version !== requestVersion) {
      return
    }
    overview.value = response.data
  }
  catch (failure) {
    if (version !== requestVersion) {
      return
    }
    error.value = getApiClientFailureMessage(failure, '通知概览加载失败')
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
    }
  }
}

onMounted(() => {
  void refresh()
})

onBeforeUnmount(() => {
  controller?.abort()
})

defineExpose({ refresh })
</script>

<template>
  <div data-testid="notification-record-overview" class="flex flex-col gap-3">
    <FaAlert v-if="error !== null" variant="destructive" :title="error">
      <template #actions>
        <FaButton variant="outline" size="sm" @click="refresh">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <div
      v-if="overview !== null"
      class="gap-3 grid grid-cols-2 xl:grid-cols-4"
      :class="loading ? 'opacity-60' : undefined"
      :aria-busy="loading"
    >
      <article class="metric-card metric-card--sky p-4 border border-border rounded-xl bg-card min-w-0">
        <FaIcon name="i-lucide:send" aria-hidden="true" class="metric-card__motif" />
        <div class="metric-card__content flex flex-col gap-1 min-w-0">
          <p class="text-sm text-muted-foreground font-medium m-0">
            24h 发送
          </p>
          <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
            {{ metrics.total }}
          </p>
          <p class="text-xs text-muted-foreground m-0">
            近 24 小时全量
          </p>
        </div>
      </article>

      <article class="metric-card metric-card--emerald p-4 border border-border rounded-xl bg-card min-w-0">
        <FaIcon name="i-lucide:circle-check-big" aria-hidden="true" class="metric-card__motif" />
        <div class="metric-card__content flex flex-col gap-1 min-w-0">
          <p class="text-sm text-muted-foreground font-medium m-0">
            24h 完成
          </p>
          <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
            {{ metrics.completed }}
          </p>
          <p class="text-xs text-muted-foreground m-0">
            完成不代表已读
          </p>
        </div>
      </article>

      <article class="metric-card metric-card--amber p-4 border border-border rounded-xl bg-card min-w-0">
        <FaIcon name="i-lucide:triangle-alert" aria-hidden="true" class="metric-card__motif" />
        <div class="metric-card__content flex flex-col gap-1 min-w-0">
          <p class="text-sm text-muted-foreground font-medium m-0">
            24h 需关注
          </p>
          <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
            {{ metrics.attention }}
          </p>
          <p class="text-xs text-muted-foreground m-0">
            失败 · 部分 · 过期
          </p>
        </div>
      </article>

      <article class="metric-card metric-card--violet p-4 border border-border rounded-xl bg-card min-w-0">
        <FaIcon name="i-lucide:clock-3" aria-hidden="true" class="metric-card__motif" />
        <div class="metric-card__content flex flex-col gap-1 min-w-0">
          <p class="text-sm text-muted-foreground font-medium m-0">
            待发队列
          </p>
          <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
            {{ metrics.pending }}
          </p>
          <p class="text-xs text-muted-foreground m-0">
            最老计划 {{ metrics.oldestPendingLabel }}
          </p>
        </div>
      </article>
    </div>

    <div v-else-if="loading" class="gap-3 grid grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      <div v-for="index in 4" :key="index" class="p-4 border border-border rounded-xl bg-muted/30 gap-2 grid">
        <div class="rounded bg-muted h-4 w-24 animate-pulse" />
        <div class="rounded bg-muted h-8 w-12 animate-pulse" />
        <div class="rounded bg-muted h-3 w-28 animate-pulse" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.metric-card {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
}

.metric-card__motif {
  position: absolute;
  right: -0.75rem;
  bottom: -1rem;
  z-index: 0;
  width: 6.5rem;
  height: 6.5rem;
  pointer-events: none;
  transform: rotate(-8deg);
}

.metric-card__content {
  position: relative;
  z-index: 1;
}

.metric-card--sky .metric-card__motif {
  color: color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, oklch(var(--card)));
}

.metric-card--emerald .metric-card__motif {
  color: color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, oklch(var(--card)));
}

.metric-card--amber .metric-card__motif {
  color: color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, oklch(var(--card)));
}

.metric-card--violet .metric-card__motif {
  color: color-mix(in oklab, oklch(64% 0.18 292deg) 14%, oklch(var(--card)));
}

.metric-card--sky {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.metric-card--emerald {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.metric-card--amber {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.metric-card--violet {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(64% 0.18 292deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(64% 0.18 292deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}
</style>
