<script setup lang="ts">
import type { SystemStatusGetResponse } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import systemStatusApi from '@/api/modules/system-status'
import { formatDateTime } from '@/components/base/DateTimeDisplay/format'
import { useAppAuth } from '@/composables/app/auth'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import {
  capabilityLabel,
  capacityLevelLabel,
  environmentLabel,
  environmentTone,
  findCheckStatus,
  formatBytes,
  formatCores,
  formatCount,
  formatDuration,
  formatLoadAverage,
  formatMilliseconds,
  formatPercent,
  formatRate,
  isDeploymentMismatch,
  mediaDriverLabel,
  statusTone,
  SYSTEM_STATUS_LABELS,
} from './status.logic'

defineOptions({ name: 'SystemStatus' })

const POLL_INTERVAL_MS = 30_000
const FAILURE_RETRY_MS = 60_000

const { auth } = useAppAuth()
const canRead = computed(() => auth('system-status:read'))

const status = ref<SystemStatusGetResponse | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)
const lastUpdatedAt = ref<Date | null>(null)
const nowTick = ref(Date.now())
const webVersion = ref<string | null>(null)

let requestVersion = 0
let controller: AbortController | null = null
let pollTimer: number | undefined

const checks = computed(() => status.value?.checks ?? [])
const serviceChecks = computed(() =>
  checks.value.filter(check => check.category === 'service'),
)
const servicesHealthyCount = computed(() =>
  serviceChecks.value.filter(check => check.status === 'ok').length,
)
const resources = computed(() => status.value?.resources ?? null)
const performance = computed(() => status.value?.performance ?? null)
const runtime = computed(() => status.value?.runtime ?? null)
const overallStatus = computed(() => status.value?.overallStatus ?? 'unknown')
const overallLabel = computed(() => SYSTEM_STATUS_LABELS[overallStatus.value])
const environment = computed(() => runtime.value?.environment ?? 'unknown')
const environmentBadge = computed(() => environmentLabel(environment.value))
const environmentBadgeTone = computed(() => environmentTone(environment.value))
const deploymentMismatch = computed(() =>
  runtime.value !== null
  && isDeploymentMismatch(webVersion.value, runtime.value.version),
)
const lastUpdatedLabel = computed(() =>
  lastUpdatedAt.value === null
    ? '—'
    : formatDateTime(lastUpdatedAt.value, 'datetime'),
)
const isStale = computed(() =>
  status.value !== null
  && lastUpdatedAt.value !== null
  && nowTick.value - lastUpdatedAt.value.getTime() >= POLL_INTERVAL_MS * 2,
)
const memoryPercent = computed(() => {
  const current = resources.value?.container.memoryCurrentBytes
  const limit = resources.value?.container.memoryLimitBytes
  return current !== null
    && current !== undefined
    && limit !== null
    && limit !== undefined
    && limit > 0
    ? current / limit * 100
    : null
})
const diskFreePercent = computed(() => resources.value?.disk.freePercent ?? null)

function formatTime(value: string | null | undefined): string {
  return formatDateTime(value ?? null, 'datetime')
}

async function loadStatus(options: { manual?: boolean } = {}): Promise<void> {
  if (!canRead.value) {
    return
  }
  const version = ++requestVersion
  controller?.abort()
  controller = new AbortController()
  const manual = options.manual === true
  if (manual) {
    refreshing.value = true
  }
  if (status.value === null) {
    loading.value = true
  }
  error.value = null

  try {
    const response = await systemStatusApi.get(controller.signal)
    if (version !== requestVersion) {
      return
    }
    status.value = response.data
    lastUpdatedAt.value = new Date()
    nowTick.value = Date.now()
  }
  catch (failure) {
    if (version !== requestVersion || controller?.signal.aborted === true) {
      return
    }
    // 保留上一次成功数据；页面用“数据可能已过期”提示，不把旧数据伪装成实时值。
    error.value = getApiClientFailureMessage(failure, '系统状态加载失败')
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      refreshing.value = false
    }
  }
}

async function loadWebVersion(): Promise<void> {
  try {
    const response = await fetch('/release.json', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Release manifest unavailable')
    }
    const payload: unknown = await response.json()
    const version = typeof payload === 'object' && payload !== null
      ? Reflect.get(payload, 'version')
      : null
    webVersion.value = typeof version === 'string' && version.trim() !== ''
      ? version
      : null
  }
  catch {
    // 版本清单不可读时退回构建期版本，页面仍能显示服务端真实版本。
    webVersion.value = __SYSTEM_INFO__.pkg.version
  }
}

function scheduleNextPoll(delay = POLL_INTERVAL_MS): void {
  if (pollTimer !== undefined) {
    window.clearTimeout(pollTimer)
  }
  pollTimer = window.setTimeout(() => {
    nowTick.value = Date.now()
    if (document.visibilityState !== 'visible') {
      scheduleNextPoll()
      return
    }
    void loadStatus({ }).finally(() => {
      scheduleNextPoll(error.value === null ? POLL_INTERVAL_MS : FAILURE_RETRY_MS)
    })
  }, delay)
}

function startPolling(): void {
  scheduleNextPoll()
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearTimeout(pollTimer)
    pollTimer = undefined
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return
  }
  const lastUpdated = lastUpdatedAt.value?.getTime() ?? 0
  if (Date.now() - lastUpdated >= POLL_INTERVAL_MS) {
    void loadStatus({ })
  }
  scheduleNextPoll()
}

onMounted(() => {
  void loadWebVersion()
  void loadStatus()
  startPolling()
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  controller?.abort()
  stopPolling()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div data-testid="system-status-page" class="flex flex-col min-h-0">
    <FaPageHeader
      title="系统状态"
      description="查看服务健康、资源水位、性能与运行信息；数据为采样快照，不是历史监控。"
    >
      <div class="flex flex-wrap gap-2 items-center">
        <FaTag
          variant="outline"
          class="qs-type-status-tag"
          :class="resolveStatusTagToneClass(environmentBadgeTone)"
          :title="runtime?.environmentSource === 'APP_ENV' ? '环境来源：APP_ENV' : '环境来源：媒体存储环境或未配置'"
        >
          {{ environmentBadge }}
        </FaTag>
        <span class="qs-type-meta text-muted-foreground">更新于 {{ lastUpdatedLabel }}</span>
        <FaButton
          v-if="canRead"
          data-testid="system-status-refresh"
          variant="outline"
          :loading="refreshing"
          :disabled="loading"
          @click="loadStatus({ manual: true })"
        >
          <FaIcon name="i-lucide:refresh-cw" />
          刷新
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-x"
        title="没有权限"
        description="当前账号不能查看系统状态。"
        class="min-h-64"
      />

      <template v-else>
        <FaAlert
          v-if="error"
          data-testid="system-status-error"
          variant="destructive"
          icon="i-lucide:circle-alert"
          title="系统状态加载失败"
          :description="error"
        />

        <div
          v-if="status !== null && isStale"
          data-testid="system-status-stale"
          class="text-sm mt-3 px-4 py-3 border rounded-lg flex gap-2 items-start"
          :class="resolveStatusTagToneClass('warning')"
          role="status"
        >
          <FaIcon name="i-lucide:triangle-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
          <span>数据可能已过期。最后成功更新：{{ lastUpdatedLabel }}。</span>
        </div>

        <div
          v-if="loading && status === null"
          class="mt-4 gap-3 grid grid-cols-2 xl:grid-cols-4"
          aria-hidden="true"
        >
          <div
            v-for="index in 4"
            :key="index"
            class="p-4 border border-border rounded-xl bg-muted/30 gap-2 grid"
          >
            <div class="rounded bg-muted h-4 w-24 animate-pulse" />
            <div class="rounded bg-muted h-8 w-16 animate-pulse" />
            <div class="rounded bg-muted h-3 w-28 animate-pulse" />
          </div>
        </div>

        <template v-else-if="status === null">
          <FaEmpty
            data-testid="system-status-empty"
            icon="i-lucide:activity"
            title="暂时无法获取系统状态"
            description="请稍后重试；若持续失败，请检查后端 /api/health 是否可访问。"
            class="mt-4 min-h-64"
          />
          <div class="mt-3 flex justify-center">
            <FaButton variant="outline" @click="loadStatus({ manual: true })">
              重试
            </FaButton>
          </div>
        </template>

        <template v-else>
          <div class="mt-4 gap-3 grid grid-cols-2 xl:grid-cols-4" :aria-busy="refreshing">
            <article class="metric-card metric-card--emerald p-4 border border-border rounded-xl bg-card min-w-0">
              <FaIcon name="i-lucide:activity" aria-hidden="true" class="metric-card__motif" />
              <div class="metric-card__content flex flex-col gap-1">
                <p class="text-sm text-muted-foreground font-medium m-0">
                  整体状态
                </p>
                <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                  {{ overallLabel }}
                </p>
                <p class="text-xs text-muted-foreground m-0">
                  生成于 {{ formatTime(status.generatedAt) }}
                </p>
              </div>
            </article>

            <article class="metric-card metric-card--sky p-4 border border-border rounded-xl bg-card min-w-0">
              <FaIcon name="i-lucide:server" aria-hidden="true" class="metric-card__motif" />
              <div class="metric-card__content flex flex-col gap-1">
                <p class="text-sm text-muted-foreground font-medium m-0">
                  服务健康
                </p>
                <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                  {{ servicesHealthyCount }}/{{ serviceChecks.length }}
                </p>
                <p class="text-xs text-muted-foreground m-0">
                  后端 · 数据库 · 媒体存储
                </p>
              </div>
            </article>

            <article class="metric-card metric-card--amber p-4 border border-border rounded-xl bg-card min-w-0">
              <FaIcon name="i-lucide:hard-drive" aria-hidden="true" class="metric-card__motif" />
              <div class="metric-card__content flex flex-col gap-1">
                <p class="text-sm text-muted-foreground font-medium m-0">
                  磁盘可用
                </p>
                <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                  {{ formatPercent(diskFreePercent) }}
                </p>
                <p class="text-xs text-muted-foreground m-0">
                  可用 {{ formatBytes(resources?.disk.availableBytes ?? null) }} / {{ formatBytes(resources?.disk.totalBytes ?? null) }}
                </p>
              </div>
            </article>

            <article class="metric-card metric-card--violet p-4 border border-border rounded-xl bg-card min-w-0">
              <FaIcon name="i-lucide:gauge" aria-hidden="true" class="metric-card__motif" />
              <div class="metric-card__content flex flex-col gap-1">
                <p class="text-sm text-muted-foreground font-medium m-0">
                  5 分钟请求
                </p>
                <p class="text-2xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                  {{ formatCount(performance?.windowRequests ?? null) }}
                </p>
                <p class="text-xs text-muted-foreground m-0">
                  5xx {{ formatPercent(performance?.errorRatePercent ?? null) }} · P95 {{ formatMilliseconds(performance?.p95Ms ?? null) }}
                </p>
              </div>
            </article>
          </div>

          <section class="mt-4 p-4 border border-border rounded-xl bg-card" data-testid="system-status-services">
            <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
              <h2 class="text-base font-semibold m-0">
                服务健康
              </h2>
              <span class="qs-type-meta text-muted-foreground">后端 · 数据库 · 媒体存储</span>
            </header>
            <div class="flex flex-col gap-2">
              <div
                v-for="check in serviceChecks"
                :key="check.key"
                class="pb-2 border-b border-border/60 flex flex-wrap gap-x-3 gap-y-1 items-center last:pb-0 last:border-b-0"
              >
                <span class="text-sm font-medium min-w-20">{{ check.label }}</span>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="resolveStatusTagToneClass(statusTone(check.status))"
                >
                  {{ SYSTEM_STATUS_LABELS[check.status] }}
                </FaTag>
                <span v-if="check.message" class="text-xs text-muted-foreground">{{ check.message }}</span>
                <span v-else-if="check.key === 'database'" class="text-xs text-muted-foreground">
                  延迟 {{ formatMilliseconds(status.services.database.latencyMs) }}
                </span>
                <span v-else-if="check.key === 'media'" class="text-xs text-muted-foreground">
                  探测于 {{ formatTime(status.services.media.probedAt) }}
                </span>
                <span v-else class="text-xs text-muted-foreground">请求已到达</span>

                <span
                  v-if="check.key === 'database' && status.services.database.version"
                  class="qs-type-meta text-muted-foreground"
                >
                  {{ status.services.database.version }} · {{ status.services.database.timeZone ?? '—' }}
                  · 连接 {{ formatCount(status.services.database.connections) }}（活跃 {{ formatCount(status.services.database.activeConnections) }}）
                </span>
                <span
                  v-if="check.key === 'media'"
                  class="qs-type-meta text-muted-foreground"
                >
                  {{ mediaDriverLabel(status.services.media.driver) }}
                  · 读 {{ capabilityLabel(status.services.media.readStatus) }}
                  · 写 {{ capabilityLabel(status.services.media.writeStatus) }}
                  · 视频校验 {{ capabilityLabel(status.services.media.videoValidatorStatus) }}
                  · 容量 {{ formatPercent(status.services.media.capacityFreePercent) }}（{{ capacityLevelLabel(status.services.media.capacityLevel) }}）
                </span>
              </div>
            </div>
          </section>

          <section v-if="resources" class="mt-4 p-4 border border-border rounded-xl bg-card" data-testid="system-status-resources">
            <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
              <h2 class="text-base font-semibold m-0">
                资源使用
              </h2>
              <span class="qs-type-meta text-muted-foreground">采样于 {{ formatTime(resources.sampledAt) }} · 宿主与容器分列</span>
            </header>
            <div class="gap-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <article class="p-3 border border-border rounded-lg bg-muted/20">
                <div class="flex gap-2 items-center justify-between">
                  <span class="text-sm font-medium">CPU</span>
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="resolveStatusTagToneClass(statusTone(findCheckStatus(checks, 'cpu')))"
                  >
                    {{ SYSTEM_STATUS_LABELS[findCheckStatus(checks, 'cpu')] }}
                  </FaTag>
                </div>
                <p class="text-xl font-semibold m-0 mt-2 tabular-nums">
                  {{ formatPercent(resources.host.cpuUsagePercent) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  宿主 {{ resources.host.cpuCount }} vCPU · 负载 {{ formatLoadAverage(resources.host.loadAverage) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  容器 {{ formatPercent(resources.container.cpuUsagePercentOfHost) }} · {{ formatCores(resources.container.cpuUsageCores) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  上限：{{ resources.container.cpuQuotaCores === null ? '无配额（共享宿主）' : `${resources.container.cpuQuotaCores.toFixed(2)} 核` }}
                </p>
              </article>

              <article class="p-3 border border-border rounded-lg bg-muted/20">
                <div class="flex gap-2 items-center justify-between">
                  <span class="text-sm font-medium">内存（容器）</span>
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="resolveStatusTagToneClass(statusTone(findCheckStatus(checks, 'memory')))"
                  >
                    {{ SYSTEM_STATUS_LABELS[findCheckStatus(checks, 'memory')] }}
                  </FaTag>
                </div>
                <p class="text-xl font-semibold m-0 mt-2 tabular-nums">
                  {{ formatPercent(memoryPercent) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  {{ formatBytes(resources.container.memoryCurrentBytes) }} / {{ formatBytes(resources.container.memoryLimitBytes) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  匿名 {{ formatBytes(resources.container.memoryAnonBytes) }} · 峰值 {{ formatBytes(resources.container.memoryPeakBytes) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  OOM Kill {{ formatCount(resources.container.memoryOomKillCount) }} 次 · PIDs {{ formatCount(resources.container.pidCount) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  宿主可用 {{ formatBytes(resources.host.memoryAvailableBytes) }} / {{ formatBytes(resources.host.memoryTotalBytes) }}
                </p>
              </article>

              <article class="p-3 border border-border rounded-lg bg-muted/20">
                <div class="flex gap-2 items-center justify-between">
                  <span class="text-sm font-medium">磁盘（媒体目录所在盘）</span>
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="resolveStatusTagToneClass(statusTone(findCheckStatus(checks, 'disk')))"
                  >
                    {{ SYSTEM_STATUS_LABELS[findCheckStatus(checks, 'disk')] }}
                  </FaTag>
                </div>
                <p class="text-xl font-semibold m-0 mt-2 tabular-nums">
                  {{ formatPercent(resources.disk.freePercent) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  可用 {{ formatBytes(resources.disk.availableBytes) }} / 总 {{ formatBytes(resources.disk.totalBytes) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  空闲 {{ formatBytes(resources.disk.freeBytes) }} · inode 已用 {{ formatPercent(resources.disk.inodeUsedPercent) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  阈值：可用低于 20% 关注、低于 10% 异常
                </p>
              </article>

              <article class="p-3 border border-border rounded-lg bg-muted/20">
                <span class="text-sm font-medium">网络（容器）</span>
                <p class="text-xl font-semibold m-0 mt-2 tabular-nums">
                  收 {{ formatRate(resources.network.rxBytesPerSecond) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  发 {{ formatRate(resources.network.txBytesPerSecond) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  容器网卡口径，包含内网与公网；重启容器后计数器清零
                </p>
              </article>

              <article class="p-3 border border-border rounded-lg bg-muted/20">
                <span class="text-sm font-medium">数据库</span>
                <p class="text-xl font-semibold m-0 mt-2 tabular-nums">
                  {{ formatBytes(status.services.database.sizeBytes) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  连接 {{ formatCount(status.services.database.connections) }} · 活跃 {{ formatCount(status.services.database.activeConnections) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  启动于 {{ formatTime(status.services.database.startedAt) }}
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  {{ status.services.database.version ?? '—' }} · {{ status.services.database.timeZone ?? '—' }}
                </p>
              </article>
            </div>
          </section>

          <section v-if="performance" class="mt-4 p-4 border border-border rounded-xl bg-card" data-testid="system-status-performance">
            <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
              <h2 class="text-base font-semibold m-0">
                性能
              </h2>
              <span class="qs-type-meta text-muted-foreground">
                近 {{ Math.round(performance.windowSeconds / 60) }} 分钟 · 自本次进程启动
              </span>
            </header>

            <div
              v-if="performance.insufficientData"
              class="text-xs mb-3 px-3 py-2 border rounded-lg"
              :class="resolveStatusTagToneClass('warning')"
              role="status"
            >
              近 {{ Math.round(performance.windowSeconds / 60) }} 分钟样本不足（{{ performance.windowRequests }} 条），错误率与 P95 仅供参考。
            </div>

            <div class="gap-3 grid grid-cols-2 xl:grid-cols-4">
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  5 分钟请求量
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatCount(performance.windowRequests) }}
                </p>
              </div>
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  5xx 错误率
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatPercent(performance.errorRatePercent) }}
                </p>
              </div>
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  4xx 请求
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatCount(performance.clientErrors) }}
                </p>
              </div>
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  P95 耗时
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatMilliseconds(performance.p95Ms) }}
                </p>
              </div>
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  平均耗时
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatMilliseconds(performance.averageMs) }}
                </p>
              </div>
              <div class="p-3 border border-border rounded-lg bg-muted/20">
                <p class="qs-type-meta text-muted-foreground m-0">
                  自启动累计
                </p>
                <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                  {{ formatCount(performance.totalRequests) }}
                </p>
              </div>
            </div>

            <div class="mt-4">
              <h3 class="text-sm font-medium m-0">
                慢请求 Top {{ performance.slowest.length }}
              </h3>
              <p v-if="performance.slowest.length === 0" class="qs-type-meta text-muted-foreground m-0 mt-1">
                暂无慢请求样本。
              </p>
              <ul v-else class="m-0 mt-2 p-0 list-none flex flex-col gap-1">
                <li
                  v-for="item in performance.slowest"
                  :key="`${item.occurredAt}-${item.operation}-${item.durationMs}`"
                  class="text-xs pb-1 border-b border-border/60 flex flex-wrap gap-x-3 gap-y-1 items-center last:pb-0 last:border-b-0"
                >
                  <span class="font-medium tabular-nums">{{ formatMilliseconds(item.durationMs) }}</span>
                  <span>{{ item.operation }}</span>
                  <span class="text-muted-foreground">{{ item.statusCode }}</span>
                  <span class="text-muted-foreground">{{ formatTime(item.occurredAt) }}</span>
                </li>
              </ul>
            </div>
          </section>

          <section v-if="runtime" class="mt-4 p-4 border border-border rounded-xl bg-card" data-testid="system-status-runtime">
            <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
              <h2 class="text-base font-semibold m-0">
                运行信息
              </h2>
              <span class="qs-type-meta text-muted-foreground">只展示白名单字段，不包含连接串或密钥</span>
            </header>
            <div class="gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  Web 版本
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ webVersion ?? '—' }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  Server 版本
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.version }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  部署环境
                </p>
                <p class="text-sm m-0 mt-1 flex flex-wrap gap-2 items-center">
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="resolveStatusTagToneClass(environmentBadgeTone)"
                  >
                    {{ environmentBadge }}
                  </FaTag>
                  <FaTag
                    v-if="deploymentMismatch"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="resolveStatusTagToneClass('warning')"
                  >
                    部署不一致
                  </FaTag>
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  Node / 平台
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.nodeVersion }} · {{ runtime.platform }}/{{ runtime.arch }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  时区
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.timeZone }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  媒体存储
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ mediaDriverLabel(runtime.mediaDriver) }} · {{ runtime.mediaStorageEnvironment }} · {{ runtime.mediaDeliveryMode }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  助理 Worker
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.assistantWorkerEnabled ? '启用' : '停用' }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  启动时间
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ formatTime(runtime.startedAt) }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  运行时长
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ formatDuration(runtime.uptimeSeconds) }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  数据库迁移
                </p>
                <p class="text-sm m-0 mt-1 break-all">
                  {{ runtime.migration ?? '—' }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  数据库版本 / 时区
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.databaseVersion ?? '—' }} · {{ runtime.databaseTimeZone ?? '—' }}
                </p>
              </div>
              <div>
                <p class="qs-type-meta text-muted-foreground m-0">
                  环境来源
                </p>
                <p class="text-sm m-0 mt-1">
                  {{ runtime.environmentSource }}
                </p>
              </div>
            </div>
          </section>
        </template>
      </template>
    </FaPageMain>
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
