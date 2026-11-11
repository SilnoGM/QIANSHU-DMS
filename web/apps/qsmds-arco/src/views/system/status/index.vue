<script setup lang="ts">
import type { SystemStatusLevel } from './status.logic'
import type { SystemStatusGetResponse } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import systemStatusApi from '@/api/modules/system-status'
import { formatDateTime } from '@/components/base/DateTimeDisplay/format'
import { useAppAuth } from '@/composables/app/auth'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import {
  capabilityMark,
  databaseShortLabel,
  diskLevelText,
  diskLevelTone,
  environmentLabel,
  environmentTone,
  formatBytes,
  formatCores,
  formatCount,
  formatDuration,
  formatLoadAverage,
  formatMilliseconds,
  formatPercent,
  formatRate,
  hostMemoryLevelText,
  hostMemoryLevelTone,
  isDeploymentMismatch,
  mediaDriverLabel,
  methodTone,
  overallTone,
  resolveOverallReason,
  serviceShortLabel,
  splitOperation,
  statusCodeLabel,
  statusCodeTone,
  statusTone,
  SYSTEM_STATUS_LABELS,

  versionWithPrefix,
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
const overallToneClass = computed(() =>
  `summary-card--${overallTone(overallStatus.value)}`,
)
const overallValueClass = computed(() => {
  if (overallStatus.value === 'critical') {
    return 'text-destructive'
  }
  if (overallStatus.value === 'warning') {
    return 'text-amber-600'
  }
  if (overallStatus.value === 'ok') {
    return 'text-primary'
  }
  return 'text-muted-foreground'
})
const overallReason = computed(() => resolveOverallReason({
  overallStatus: overallStatus.value,
  checks: checks.value,
  performance: performance.value,
}))
const overallReasonTextClass = computed(() => {
  const tone = overallReason.value.tone
  if (tone === 'danger') {
    return 'text-destructive'
  }
  if (tone === 'warning') {
    return 'text-amber-600'
  }
  if (tone === 'success') {
    return 'text-primary'
  }
  return 'text-muted-foreground'
})
const diskFreePercent = computed(() => resources.value?.disk.freePercent ?? null)
const diskUsedPercent = computed(() =>
  diskFreePercent.value === null ? null : 100 - diskFreePercent.value,
)
const diskLevel = computed(() => diskLevelText(diskFreePercent.value))
const diskLevelToneClass = computed(() =>
  resolveStatusTagToneClass(diskLevelTone(diskFreePercent.value)),
)
const diskProgressClass = computed(() => {
  const tone = diskLevelTone(diskFreePercent.value)
  return tone === 'danger'
    ? 'bg-destructive'
    : tone === 'warning'
      ? 'bg-amber-500'
      : 'bg-primary'
})
const diskSummaryProgressClass = computed(() =>
  diskFreePercent.value !== null && diskFreePercent.value < 10
    ? 'bg-destructive'
    : 'bg-amber-500',
)
const hostMemoryAvailablePercent = computed(() => {
  const available = resources.value?.host.memoryAvailableBytes
  const total = resources.value?.host.memoryTotalBytes
  return available !== undefined
    && total !== undefined
    && total > 0
    ? available / total * 100
    : null
})
const hostMemoryLevel = computed(() =>
  hostMemoryLevelText(hostMemoryAvailablePercent.value),
)
const hostMemoryLevelToneClass = computed(() =>
  resolveStatusTagToneClass(hostMemoryLevelTone(hostMemoryAvailablePercent.value)),
)
const hostMemoryProgressClass = computed(() => {
  const tone = hostMemoryLevelTone(hostMemoryAvailablePercent.value)
  return tone === 'danger'
    ? 'bg-destructive'
    : tone === 'warning'
      ? 'bg-amber-500'
      : 'bg-primary'
})
const containerCpuCollected = computed(() =>
  resources.value?.container.cpuUsageCores !== null
  && resources.value?.container.cpuUsageCores !== undefined,
)
const containerMemoryCollected = computed(() =>
  resources.value?.container.memoryCurrentBytes !== null
  && resources.value?.container.memoryCurrentBytes !== undefined,
)
const networkCollected = computed(() =>
  resources.value?.network.rxBytesPerSecond !== null
  && resources.value?.network.rxBytesPerSecond !== undefined,
)
const performanceErrorRate = computed(() =>
  performance.value?.errorRatePercent ?? null,
)
const performanceErrorToneClass = computed(() =>
  resolveStatusTagToneClass((performanceErrorRate.value ?? 0) > 0 ? 'danger' : 'success'),
)
const performanceErrorCardClass = computed(() =>
  (performanceErrorRate.value ?? 0) > 0
    ? 'border-destructive/30 bg-destructive/5'
    : 'border-border bg-muted/10',
)
const slowestRows = computed(() =>
  (performance.value?.slowest ?? []).map(item => ({
    ...item,
    ...splitOperation(item.operation),
  })),
)
const databaseVersionShort = computed(() =>
  databaseShortLabel(status.value?.services.database.version ?? null),
)

function formatTime(value: string | null | undefined): string {
  return formatDateTime(value ?? null, 'datetime')
}

function checkDotClass(value: SystemStatusLevel): string {
  if (value === 'ok') {
    return 'bg-primary'
  }
  if (value === 'warning') {
    return 'bg-amber-500'
  }
  if (value === 'critical') {
    return 'bg-destructive'
  }
  return 'bg-muted-foreground'
}

function serviceCardClass(value: SystemStatusLevel): string {
  if (value === 'critical') {
    return 'border-destructive/25 bg-destructive/5'
  }
  if (value === 'warning') {
    return 'border-amber-500/25 bg-amber-500/5'
  }
  if (value === 'unknown') {
    return 'border-border bg-muted/20'
  }
  return 'border-primary/20 bg-primary/5'
}

function capabilityClass(value: 'up' | 'down' | 'unknown'): string {
  if (value === 'up') {
    return 'text-primary'
  }
  if (value === 'down') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}

function serviceTitle(check: { key: string }): string {
  if (check.key === 'database') {
    return `数据库 (${databaseVersionShort.value})`
  }
  if (check.key === 'media') {
    return `媒体存储 (${mediaDriverLabel(status.value?.services.media.driver ?? 'unknown')})`
  }
  return '后端进程 (API)'
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
    void loadStatus({}).finally(() => {
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
    void loadStatus({})
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
          size="sm"
          :loading="refreshing"
          :disabled="loading"
          @click="loadStatus({ manual: true })"
        >
          <FaIcon name="i-lucide:refresh-cw" />
          刷新状态
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain>
      <div class="flex flex-col gap-4">
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
            class="text-sm px-4 py-3 border rounded-lg flex gap-2 items-start"
            :class="resolveStatusTagToneClass('warning')"
            role="status"
          >
            <FaIcon name="i-lucide:triangle-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
            <span>数据可能已过期。最后成功更新：{{ lastUpdatedLabel }}。</span>
          </div>

          <div
            v-if="loading && status === null"
            class="gap-3 grid grid-cols-2 xl:grid-cols-4"
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
              class="min-h-64"
            />
            <div class="flex justify-center">
              <FaButton variant="outline" @click="loadStatus({ manual: true })">
                重试
              </FaButton>
            </div>
          </template>

          <template v-else>
            <div class="gap-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              <article
                data-testid="system-status-overall"
                class="summary-card flex flex-col min-h-40"
                :class="overallToneClass"
              >
                <FaIcon name="i-lucide:alarm-clock" aria-hidden="true" class="summary-card__motif" />
                <div class="flex flex-col gap-1.5 h-full relative z-1">
                  <div class="flex gap-2 items-start justify-between">
                    <p class="text-sm text-muted-foreground font-medium m-0">
                      整体状态
                    </p>
                    <span class="mt-1 rounded-full shrink-0 size-2" :class="checkDotClass(overallStatus)" aria-hidden="true" />
                  </div>
                  <p class="text-3xl leading-tight font-semibold m-0 tabular-nums" :class="overallValueClass">
                    {{ overallLabel }}
                  </p>
                  <p class="text-xs leading-5 m-0 mt-auto flex gap-1.5 items-start" :class="overallReasonTextClass">
                    <span class="mt-1.5 rounded-full shrink-0 size-1.5" :class="checkDotClass(overallStatus)" aria-hidden="true" />
                    <span>{{ overallReason.text }}</span>
                  </p>
                </div>
              </article>

              <article class="summary-card summary-card--emerald flex flex-col min-h-40">
                <FaIcon name="i-lucide:shield-check" aria-hidden="true" class="summary-card__motif" />
                <div class="flex flex-col gap-1.5 h-full relative z-1">
                  <p class="text-sm text-muted-foreground font-medium m-0">
                    服务健康
                  </p>
                  <p class="text-3xl text-primary leading-tight font-semibold m-0 tabular-nums">
                    {{ servicesHealthyCount }}/{{ serviceChecks.length }}
                  </p>
                  <p class="text-xs text-muted-foreground m-0">
                    {{ servicesHealthyCount === serviceChecks.length ? '全部在线' : `${serviceChecks.length - servicesHealthyCount} 项异常` }}
                  </p>
                  <div class="mt-auto pt-1 flex flex-wrap gap-x-3 gap-y-1 items-center">
                    <span
                      v-for="check in serviceChecks"
                      :key="check.key"
                      class="text-xs text-muted-foreground inline-flex gap-1.5 items-center"
                    >
                      <span class="rounded-full shrink-0 size-1.5" :class="checkDotClass(check.status)" aria-hidden="true" />
                      {{ serviceShortLabel(check.key) }}
                    </span>
                  </div>
                </div>
              </article>

              <article class="summary-card summary-card--amber flex flex-col min-h-40">
                <FaIcon name="i-lucide:archive" aria-hidden="true" class="summary-card__motif" />
                <div class="flex flex-col gap-1.5 h-full relative z-1">
                  <div class="flex gap-2 items-start justify-between">
                    <p class="text-sm text-muted-foreground font-medium m-0">
                      磁盘可用（媒体盘）
                    </p>
                    <span class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md" :class="diskLevelToneClass">
                      {{ diskLevel }}
                    </span>
                  </div>
                  <p class="text-3xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                    {{ formatPercent(diskFreePercent) }}
                  </p>
                  <div class="mt-1 rounded-full bg-muted h-1.5 w-full overflow-hidden">
                    <div class="rounded-full h-full" :class="diskSummaryProgressClass" :style="{ width: `${diskUsedPercent ?? 0}%` }" />
                  </div>
                  <div class="text-xs text-muted-foreground mt-auto flex flex-wrap gap-2 items-center justify-between">
                    <span>可用 {{ formatBytes(resources?.disk.availableBytes ?? null) }} / 总 {{ formatBytes(resources?.disk.totalBytes ?? null) }}</span>
                    <span>已用 {{ formatPercent(diskUsedPercent) }}</span>
                  </div>
                </div>
              </article>

              <article class="summary-card summary-card--sky flex flex-col min-h-40">
                <FaIcon name="i-lucide:activity" aria-hidden="true" class="summary-card__motif" />
                <div class="flex flex-col gap-1.5 h-full relative z-1">
                  <p class="text-sm text-muted-foreground font-medium m-0">
                    5 分钟请求
                  </p>
                  <p class="text-3xl text-foreground leading-tight font-semibold m-0 tabular-nums">
                    {{ formatCount(performance?.windowRequests ?? null) }}
                    <span class="text-sm text-muted-foreground font-normal ml-1">次</span>
                  </p>
                  <div class="mt-auto pt-1 flex flex-wrap gap-2 items-center">
                    <span class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md" :class="performanceErrorToneClass">
                      5xx {{ formatPercent(performance?.errorRatePercent ?? null) }}
                    </span>
                    <span class="text-xs text-muted-foreground">P95 {{ formatMilliseconds(performance?.p95Ms ?? null) }}</span>
                  </div>
                </div>
              </article>
            </div>

            <section class="p-4 border border-border rounded-xl bg-card shadow-sm" data-testid="system-status-services">
              <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
                <div class="flex gap-2 items-center">
                  <span class="text-primary rounded-lg bg-primary/10 flex size-7 items-center justify-center">
                    <FaIcon name="i-lucide:heart-pulse" class="size-4" aria-hidden="true" />
                  </span>
                  <h2 class="text-base font-semibold m-0">
                    服务健康
                  </h2>
                </div>
                <span class="qs-type-meta text-muted-foreground">后端 · 数据库 · 媒体存储</span>
              </header>

              <div class="gap-3 grid grid-cols-1 xl:grid-cols-3">
                <article
                  v-for="check in serviceChecks"
                  :key="check.key"
                  class="p-3 border rounded-lg"
                  :class="serviceCardClass(check.status)"
                >
                  <div class="flex gap-3 items-start justify-between">
                    <div class="flex gap-2 min-w-0 items-center">
                      <span class="rounded-full shrink-0 size-2" :class="checkDotClass(check.status)" aria-hidden="true" />
                      <p class="text-sm leading-tight font-semibold m-0" :title="serviceTitle(check)">
                        {{ serviceTitle(check) }}
                      </p>
                    </div>
                    <div class="flex shrink-0 gap-2 items-center">
                      <span
                        v-if="check.key === 'database'"
                        class="text-xs text-muted-foreground px-2 py-0.5 rounded-md bg-muted"
                      >
                        {{ formatMilliseconds(status.services.database.latencyMs) }}
                      </span>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="resolveStatusTagToneClass(statusTone(check.status))"
                      >
                        {{ SYSTEM_STATUS_LABELS[check.status] }}
                      </FaTag>
                    </div>
                  </div>

                  <div class="text-xs text-muted-foreground mt-3 flex flex-wrap gap-2 items-center justify-between">
                    <template v-if="check.key === 'backend'">
                      <span>探测状态：{{ check.status === 'ok' ? '请求已到达' : (check.message ?? '探测失败') }}</span>
                      <span class="text-foreground font-medium">{{ check.status === 'ok' ? 'HTTP 200' : '—' }}</span>
                    </template>
                    <template v-else-if="check.key === 'database'">
                      <span>连接池：总计 {{ formatCount(status.services.database.connections) }} / 活跃 {{ formatCount(status.services.database.activeConnections) }}</span>
                      <span>时区 {{ status.services.database.timeZone ?? '—' }}</span>
                    </template>
                    <template v-else>
                      <span class="flex flex-wrap gap-x-2 gap-y-1 items-center">
                        <span>读 <span class="font-semibold" :class="capabilityClass(status.services.media.readStatus)">{{ capabilityMark(status.services.media.readStatus) }}</span></span>
                        <span>写 <span class="font-semibold" :class="capabilityClass(status.services.media.writeStatus)">{{ capabilityMark(status.services.media.writeStatus) }}</span></span>
                        <span>视频校验 <span class="font-semibold" :class="capabilityClass(status.services.media.videoValidatorStatus)">{{ capabilityMark(status.services.media.videoValidatorStatus) }}</span></span>
                      </span>
                      <span>探测于 {{ formatTime(status.services.media.probedAt) }}</span>
                    </template>
                  </div>
                </article>
              </div>
            </section>

            <section v-if="resources" class="p-4 border border-border rounded-xl bg-card shadow-sm" data-testid="system-status-resources">
              <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
                <div class="flex gap-2 items-center">
                  <span class="text-primary rounded-lg bg-primary/10 flex size-7 items-center justify-center">
                    <FaIcon name="i-lucide:server" class="size-4" aria-hidden="true" />
                  </span>
                  <h2 class="text-base font-semibold m-0">
                    资源使用
                  </h2>
                </div>
                <span class="qs-type-meta text-muted-foreground">采样于 {{ formatTime(resources.sampledAt) }} · 宿主与容器分列</span>
              </header>

              <div class="gap-3 grid grid-cols-1 lg:grid-cols-3">
                <article class="p-3 border border-border rounded-lg bg-muted/10 flex flex-col">
                  <div class="flex gap-2 items-start justify-between">
                    <span class="text-sm font-semibold">CPU</span>
                    <span
                      class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md"
                      :class="resolveStatusTagToneClass(containerCpuCollected ? 'success' : 'neutral')"
                    >
                      {{ containerCpuCollected ? '已采集' : '容器未采集' }}
                    </span>
                  </div>
                  <p class="text-2xl font-semibold m-0 mt-2 tabular-nums">
                    {{ resources.host.cpuCount }}
                    <span class="text-xs text-muted-foreground font-normal ml-1">vCPU（宿主）</span>
                  </p>
                  <div class="text-xs mt-3 flex flex-col gap-1.5">
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">容器使用 / 负载</span>
                      <span class="text-right">{{ formatPercent(resources.container.cpuUsagePercentOfHost) }} / {{ formatLoadAverage(resources.host.loadAverage) }}</span>
                    </div>
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">配额上限</span>
                      <span class="text-right">{{ resources.container.cpuQuotaCores === null ? '无配额（共享宿主）' : formatCores(resources.container.cpuQuotaCores) }}</span>
                    </div>
                  </div>
                </article>

                <article class="p-3 border border-border rounded-lg bg-muted/10 flex flex-col">
                  <div class="flex gap-2 items-start justify-between">
                    <span class="text-sm font-semibold">内存（宿主 & 容器）</span>
                    <span class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md" :class="hostMemoryLevelToneClass">
                      {{ hostMemoryLevel }}
                    </span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2 items-end justify-between">
                    <p class="text-2xl font-semibold m-0 tabular-nums">
                      {{ formatBytes(resources.host.memoryAvailableBytes) }}
                      <span class="text-xs text-muted-foreground font-normal ml-1">宿主可用</span>
                    </p>
                    <span class="text-xs text-muted-foreground">总 {{ formatBytes(resources.host.memoryTotalBytes) }}</span>
                  </div>
                  <div class="mt-2 rounded-full bg-muted h-1.5 w-full overflow-hidden">
                    <div class="rounded-full h-full" :class="hostMemoryProgressClass" :style="{ width: `${hostMemoryAvailablePercent ?? 0}%` }" />
                  </div>
                  <div class="text-xs mt-3 flex flex-col gap-1.5">
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">容器内存（当前 / 上限）</span>
                      <span class="text-right">{{ containerMemoryCollected ? `${formatBytes(resources.container.memoryCurrentBytes)} / ${formatBytes(resources.container.memoryLimitBytes)}` : '未采集（—）' }}</span>
                    </div>
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">匿名 / 峰值</span>
                      <span class="text-right">{{ formatBytes(resources.container.memoryAnonBytes) }} / {{ formatBytes(resources.container.memoryPeakBytes) }}</span>
                    </div>
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">OOM Kill / PIDs</span>
                      <span class="text-right">{{ formatCount(resources.container.memoryOomKillCount) }} 次 / {{ formatCount(resources.container.pidCount) }}</span>
                    </div>
                  </div>
                </article>

                <article class="p-3 border border-border rounded-lg bg-muted/10 flex flex-col">
                  <div class="flex gap-2 items-start justify-between">
                    <span class="text-sm font-semibold">磁盘（媒体目录所在盘）</span>
                    <span class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md" :class="diskLevelToneClass">
                      {{ diskLevel }}
                    </span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2 items-end justify-between">
                    <p class="text-2xl font-semibold m-0 tabular-nums">
                      {{ formatPercent(diskFreePercent) }}
                      <span class="text-xs text-muted-foreground font-normal ml-1">可用</span>
                    </p>
                    <span class="text-xs text-muted-foreground">{{ formatBytes(resources.disk.availableBytes) }} / {{ formatBytes(resources.disk.totalBytes) }}</span>
                  </div>
                  <div class="mt-2 rounded-full bg-muted h-1.5 w-full overflow-hidden">
                    <div class="rounded-full h-full" :class="diskProgressClass" :style="{ width: `${diskFreePercent ?? 0}%` }" />
                  </div>
                  <div class="text-xs mt-3 flex flex-col gap-1.5">
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">Inode 已用</span>
                      <span class="text-right">{{ formatPercent(resources.disk.inodeUsedPercent) }}</span>
                    </div>
                    <div class="flex gap-3 items-start justify-between">
                      <span class="text-muted-foreground">告警阈值</span>
                      <span class="text-right">&lt;20% 关注 · &lt;10% 异常</span>
                    </div>
                  </div>
                </article>

                <article class="p-3 border border-border rounded-lg bg-muted/10 flex flex-col lg:col-span-2">
                  <div class="flex gap-2 items-start justify-between">
                    <span class="text-sm font-semibold">网络流量（容器网卡）</span>
                    <span
                      class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md"
                      :class="resolveStatusTagToneClass(networkCollected ? 'success' : 'neutral')"
                    >
                      {{ networkCollected ? '已采集' : '未采集' }}
                    </span>
                  </div>
                  <div class="mt-3 gap-3 grid grid-cols-2">
                    <div>
                      <p class="text-xs text-muted-foreground m-0">
                        接收 (RX)
                      </p>
                      <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                        {{ formatRate(resources.network.rxBytesPerSecond) }}
                      </p>
                    </div>
                    <div class="text-right">
                      <p class="text-xs text-muted-foreground m-0">
                        发送 (TX)
                      </p>
                      <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                        {{ formatRate(resources.network.txBytesPerSecond) }}
                      </p>
                    </div>
                  </div>
                  <p class="text-xs text-muted-foreground m-0 mt-3">
                    容器网卡口径，包含内网与公网；重启容器后计数器清零
                  </p>
                </article>

                <article class="p-3 border border-border rounded-lg bg-muted/10 flex flex-col">
                  <div class="flex flex-wrap gap-2 items-start justify-between">
                    <span class="text-sm font-semibold">数据库体积 ({{ databaseVersionShort }})</span>
                    <span class="text-xs text-muted-foreground">启动于 {{ formatTime(status.services.database.startedAt) }}</span>
                  </div>
                  <div class="mt-3 flex gap-3 items-end justify-between">
                    <p class="text-xs text-muted-foreground m-0">
                      当前活跃连接 {{ formatCount(status.services.database.activeConnections) }} / 总连接 {{ formatCount(status.services.database.connections) }}
                    </p>
                    <div class="text-right">
                      <p class="text-xs text-muted-foreground m-0">
                        已用空间
                      </p>
                      <p class="text-xl font-semibold m-0 tabular-nums">
                        {{ formatBytes(status.services.database.sizeBytes) }}
                      </p>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            <section v-if="performance" class="p-4 border border-border rounded-xl bg-card shadow-sm" data-testid="system-status-performance">
              <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
                <div class="flex gap-2 items-center">
                  <span class="text-primary rounded-lg bg-primary/10 flex size-7 items-center justify-center">
                    <FaIcon name="i-lucide:gauge" class="size-4" aria-hidden="true" />
                  </span>
                  <h2 class="text-base font-semibold m-0">
                    性能与慢请求
                  </h2>
                </div>
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

              <div class="gap-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                <div class="p-3 border border-border rounded-lg bg-muted/10">
                  <p class="text-xs text-muted-foreground m-0">
                    5 分钟请求量
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                    {{ formatCount(performance.windowRequests) }}
                  </p>
                </div>
                <div class="p-3 border rounded-lg relative" :class="performanceErrorCardClass">
                  <span
                    v-if="(performanceErrorRate ?? 0) > 0"
                    class="rounded-full bg-destructive size-1.5 right-2 top-2 absolute"
                    aria-hidden="true"
                  />
                  <p class="text-xs text-muted-foreground m-0">
                    5xx 错误率
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums" :class="(performanceErrorRate ?? 0) > 0 ? 'text-destructive' : ''">
                    {{ formatPercent(performanceErrorRate) }}
                  </p>
                </div>
                <div class="p-3 border border-border rounded-lg bg-muted/10">
                  <p class="text-xs text-muted-foreground m-0">
                    4xx 请求数
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                    {{ formatCount(performance.clientErrors) }}
                  </p>
                </div>
                <div class="p-3 border border-border rounded-lg bg-muted/10">
                  <p class="text-xs text-muted-foreground m-0">
                    P95 耗时
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                    {{ formatMilliseconds(performance.p95Ms) }}
                  </p>
                </div>
                <div class="p-3 border border-border rounded-lg bg-muted/10">
                  <p class="text-xs text-muted-foreground m-0">
                    平均耗时
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                    {{ formatMilliseconds(performance.averageMs) }}
                  </p>
                </div>
                <div class="p-3 border border-border rounded-lg bg-muted/10">
                  <p class="text-xs text-muted-foreground m-0">
                    自启动累计请求
                  </p>
                  <p class="text-xl font-semibold m-0 mt-1 tabular-nums">
                    {{ formatCount(performance.totalRequests) }}
                  </p>
                </div>
              </div>

              <div class="mt-4 overflow-x-auto">
                <div class="mb-2 flex flex-wrap gap-2 items-center justify-between">
                  <h3 class="text-sm font-semibold m-0">
                    慢请求 Top {{ slowestRows.length }}
                  </h3>
                  <span class="qs-type-meta text-muted-foreground">按响应耗时降序排列，高亮 5xx 异常路由</span>
                </div>
                <table class="text-sm min-w-[760px] w-full border-collapse">
                  <thead>
                    <tr class="text-xs text-muted-foreground text-left border-y border-border">
                      <th class="font-medium py-2 pr-3">
                        耗时
                      </th>
                      <th class="font-medium py-2 pr-3">
                        方法
                      </th>
                      <th class="font-medium py-2 pr-3">
                        路由模板 (Route Pattern)
                      </th>
                      <th class="font-medium py-2 pr-3">
                        状态码
                      </th>
                      <th class="font-medium py-2">
                        发生时间
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in slowestRows"
                      :key="`${row.occurredAt}-${row.operation}-${row.durationMs}`"
                      class="border-b border-border/60 last:border-b-0"
                    >
                      <td class="py-2 pr-3 tabular-nums">
                        {{ formatMilliseconds(row.durationMs) }}
                      </td>
                      <td class="py-2 pr-3">
                        <span class="text-xs font-medium px-1.5 py-0.5 border rounded-md" :class="resolveStatusTagToneClass(methodTone(row.method))">
                          {{ row.method }}
                        </span>
                      </td>
                      <td class="text-xs py-2 pr-3 break-all">
                        {{ row.route }}
                      </td>
                      <td class="py-2 pr-3">
                        <span class="text-xs font-medium px-1.5 py-0.5 border rounded-md" :class="resolveStatusTagToneClass(statusCodeTone(row.statusCode))">
                          {{ statusCodeLabel(row.statusCode) }}
                        </span>
                      </td>
                      <td class="text-xs text-muted-foreground py-2">
                        {{ formatTime(row.occurredAt) }}
                      </td>
                    </tr>
                    <tr v-if="slowestRows.length === 0">
                      <td colspan="5" class="text-xs text-muted-foreground py-4 text-center">
                        暂无慢请求样本。
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section v-if="runtime" class="p-4 border border-border rounded-xl bg-card shadow-sm" data-testid="system-status-runtime">
              <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
                <div class="flex gap-2 items-center">
                  <span class="text-primary rounded-lg bg-primary/10 flex size-7 items-center justify-center">
                    <FaIcon name="i-lucide:database" class="size-4" aria-hidden="true" />
                  </span>
                  <h2 class="text-base font-semibold m-0">
                    运行信息
                  </h2>
                </div>
                <span class="qs-type-meta text-muted-foreground">只展示白名单字段，不包含连接串或密钥</span>
              </header>

              <div class="gap-x-6 gap-y-4 grid grid-cols-1 md:grid-cols-3">
                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    Web / Server 版本
                  </p>
                  <div class="mt-1.5 flex flex-wrap gap-2 items-center">
                    <span class="text-xs text-foreground font-medium px-2 py-0.5 rounded-md bg-muted inline-flex items-center">Web {{ versionWithPrefix(webVersion) }}</span>
                    <span class="text-xs text-foreground font-medium px-2 py-0.5 rounded-md bg-muted inline-flex items-center">Server {{ versionWithPrefix(runtime.version) }}</span>
                    <span
                      v-if="deploymentMismatch"
                      class="text-[11px] font-medium px-1.5 py-0.5 border rounded-md"
                      :class="resolveStatusTagToneClass('warning')"
                    >
                      部署不一致
                    </span>
                  </div>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    部署环境 / 来源
                  </p>
                  <div class="mt-1.5 flex flex-wrap gap-2 items-center">
                    <FaTag
                      variant="outline"
                      class="qs-type-status-tag"
                      :class="resolveStatusTagToneClass(environmentBadgeTone)"
                    >
                      {{ environmentBadge }}
                    </FaTag>
                    <span class="text-xs text-muted-foreground font-medium px-2 py-0.5 rounded-md bg-muted inline-flex items-center">{{ runtime.environmentSource }}</span>
                  </div>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    Node / 运行平台
                  </p>
                  <p class="text-sm m-0 mt-1.5">
                    {{ runtime.nodeVersion }} · {{ runtime.platform }}/{{ runtime.arch }}
                  </p>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    进程启动时间
                  </p>
                  <p class="text-sm m-0 mt-1.5">
                    {{ formatTime(runtime.startedAt) }}
                  </p>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    运行时长 (Uptime)
                  </p>
                  <span class="text-xs font-medium mt-1.5 px-2 py-0.5 border rounded-md inline-flex items-center" :class="resolveStatusTagToneClass('success')">
                    {{ formatDuration(runtime.uptimeSeconds) }}
                  </span>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    系统时区 / 助理 Worker
                  </p>
                  <div class="mt-1.5 flex flex-wrap gap-2 items-center">
                    <span
                      class="text-xs font-medium px-2 py-0.5 border rounded-md inline-flex items-center"
                      :class="resolveStatusTagToneClass(runtime.timeZone === 'unknown' ? 'warning' : 'neutral')"
                    >
                      tz: {{ runtime.timeZone }}
                    </span>
                    <span
                      class="text-xs font-medium px-2 py-0.5 border rounded-md inline-flex items-center"
                      :class="resolveStatusTagToneClass(runtime.assistantWorkerEnabled ? 'success' : 'danger')"
                    >
                      Worker {{ runtime.assistantWorkerEnabled ? '已启用' : '已停用' }}
                    </span>
                  </div>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    媒体存储引擎
                  </p>
                  <p class="text-sm m-0 mt-1.5">
                    {{ mediaDriverLabel(runtime.mediaDriver) }} · {{ runtime.mediaStorageEnvironment }} · {{ runtime.mediaDeliveryMode }}
                  </p>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    最新数据库迁移
                  </p>
                  <p class="text-xs m-0 mt-1.5 break-all">
                    {{ runtime.migration ?? '—' }}
                  </p>
                </div>

                <div class="pb-3 border-b border-border/50">
                  <p class="text-xs text-muted-foreground m-0">
                    数据库版本详情
                  </p>
                  <p class="text-xs m-0 mt-1.5 truncate" :title="runtime.databaseVersion ?? ''">
                    {{ runtime.databaseVersion ?? '—' }}
                  </p>
                </div>
              </div>
            </section>
          </template>
        </template>
      </div>
    </FaPageMain>
  </div>
</template>

<style scoped>
.summary-card {
  position: relative;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--summary-accent) 28%, transparent);
  border-radius: 14px;
  background-color: oklch(var(--card));
  background-image: linear-gradient(135deg, color-mix(in oklab, var(--summary-accent) 10%, oklch(var(--card))) 0%, oklch(var(--card)) 72%);
  padding: 1rem;
}

.summary-card--rose {
  --summary-accent: oklch(63.7% 0.237 25.331deg);
}

.summary-card--emerald {
  --summary-accent: oklch(69.6% 0.17 162.48deg);
}

.summary-card--amber {
  --summary-accent: oklch(76.9% 0.188 70.08deg);
}

.summary-card--sky {
  --summary-accent: oklch(62.3% 0.214 259.815deg);
}

.summary-card--neutral {
  --summary-accent: oklch(55% 0.02 260deg);
}

.summary-card__motif {
  position: absolute;
  right: -0.9rem;
  bottom: -1.1rem;
  width: 7rem;
  height: 7rem;
  color: color-mix(in oklab, var(--summary-accent) 18%, oklch(var(--card)));
  transform: rotate(-7deg);
  pointer-events: none;
}
</style>
