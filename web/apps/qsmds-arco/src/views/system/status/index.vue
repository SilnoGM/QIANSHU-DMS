<script setup lang="ts">
import type { BrowserEnvironmentInput, HealthProbeResult, StatusEntry } from './status.logic'
import buildSource from 'virtual:qianshu/build-source'
import { getHealth } from '@/api/modules/health'
import {

  buildHealthProbeResult,
  describeBrowserEnvironment,
  describeFrontendBuild,
  describeIdentity,
  formatStatusMoment,

  readFailureRequestId,
  readRequestId,

  toneColor,
} from './status.logic'

defineOptions({
  name: 'SystemStatus',
})

const accountStore = useAppAccountStore()
const { pkg, lastBuildTime } = __SYSTEM_INFO__

const autoRefreshIntervalMs = 60_000
const storageProbeKey = 'qsmds:status:storage-probe'

function collectBrowserEnvironment(): BrowserEnvironmentInput {
  let storageAvailable = false
  try {
    window.localStorage.setItem(storageProbeKey, '1')
    window.localStorage.removeItem(storageProbeKey)
    storageAvailable = true
  }
  catch {
    storageAvailable = false
  }
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    online: navigator.onLine,
    storageAvailable,
  }
}

const probing = ref(false)
const autoRefresh = ref(true)
const browserEnvironment = ref<BrowserEnvironmentInput>(collectBrowserEnvironment())
const health = ref<HealthProbeResult>(buildHealthProbeResult({
  httpStatus: null,
  body: null,
  requestId: null,
  durationMs: null,
  checkedAt: new Date().toISOString(),
  unreachable: true,
}))

async function probeHealth() {
  if (probing.value) {
    return
  }
  probing.value = true
  const checkedAt = new Date().toISOString()
  const startedAt = performance.now()
  try {
    // 503 也作为可读响应收下：Terminus 的指示器明细比单纯的状态码更有排查价值。
    const response = await getHealth(undefined, { acceptUnhealthyResponse: true })
    health.value = buildHealthProbeResult({
      httpStatus: response.status,
      body: response.data,
      requestId: readRequestId(response.headers),
      durationMs: Math.round(performance.now() - startedAt),
      checkedAt,
    })
  }
  catch (error) {
    health.value = buildHealthProbeResult({
      httpStatus: null,
      body: null,
      requestId: readFailureRequestId(error),
      durationMs: Math.round(performance.now() - startedAt),
      checkedAt,
      unreachable: true,
    })
  }
  finally {
    probing.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function startTimer() {
  stopTimer()
  timer = setInterval(() => {
    void probeHealth()
  }, autoRefreshIntervalMs)
}

watch(autoRefresh, (enabled) => {
  if (enabled) {
    startTimer()
    return
  }
  stopTimer()
})

onMounted(() => {
  void probeHealth()
  if (autoRefresh.value) {
    startTimer()
  }
})

onUnmounted(stopTimer)

const frontendEntries = computed<StatusEntry[]>(() => describeFrontendBuild({
  productVersion: pkg.version,
  buildTime: lastBuildTime,
  buildMode: import.meta.env.MODE,
  source: buildSource,
}))

const identityEntries = computed<StatusEntry[]>(() => describeIdentity(accountStore.authContext))
const browserEntries = computed<StatusEntry[]>(() => describeBrowserEnvironment(browserEnvironment.value))

const healthEntries = computed<StatusEntry[]>(() => [
  { label: 'HTTP 状态码', value: health.value.httpStatus === null ? '未获取' : String(health.value.httpStatus) },
  { label: '数据库指示器', value: health.value.databaseLabel },
  { label: '往返耗时', value: health.value.durationMs === null ? '未测量' : `${health.value.durationMs} ms` },
  { label: '请求编号', value: health.value.requestId ?? '未返回', hint: '排查服务端日志时提供该编号' },
  { label: '最近检测', value: formatStatusMoment(health.value.checkedAt) },
])

const unavailableEntries = [
  '服务端版本号：运行时不暴露版本接口，无法与前端版本比对。',
  '服务端进程指标：uptime、内存与 CPU 没有对外接口。',
  '数据库连接池与迁移版本：健康检查只返回数据库可用性。',
  '队列与后台任务：系统里没有队列设施，不存在可展示对象。',
]
</script>

<template>
  <FaPageHeader title="系统状态" description="前端构建信息、当前身份、浏览器环境与服务端健康检查">
    <template #extra>
      <div class="flex gap-3 items-center">
        <label class="text-sm text-muted-foreground flex gap-2 items-center">
          <FaSwitch v-model="autoRefresh" />
          自动刷新（60 秒）
        </label>
        <FaButton :disabled="probing" @click="probeHealth">
          <FaIcon v-if="probing" name="i-lucide:loader-circle" class="animate-spin" />
          <FaIcon v-else name="i-lucide:refresh-cw" />
          立即刷新
        </FaButton>
      </div>
    </template>
  </FaPageHeader>

  <FaPageMain>
    <div class="flex flex-col gap-4">
      <FaCard>
        <div class="flex flex-wrap gap-3 items-center">
          <span class="rounded-full size-3 inline-block" :style="{ backgroundColor: toneColor(health.tone) }" />
          <span class="text-base font-bold">{{ health.label }}</span>
          <span class="text-sm text-muted-foreground">{{ health.detail }}</span>
          <span class="text-sm text-muted-foreground">数据库：{{ health.databaseLabel }}</span>
        </div>
      </FaCard>

      <div class="gap-4 grid lg:grid-cols-2">
        <FaCard>
          <template #header>
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:history" class="text-muted-foreground" />
              <span class="font-bold">服务端健康</span>
            </div>
          </template>
          <ul class="list-none flex flex-col gap-2">
            <li v-for="entry in healthEntries" :key="entry.label" class="text-sm flex flex-wrap gap-x-2 items-baseline">
              <span class="text-muted-foreground">{{ entry.label }}</span>
              <span>{{ entry.value }}</span>
              <span v-if="entry.hint" class="text-xs text-muted-foreground">{{ entry.hint }}</span>
            </li>
          </ul>
        </FaCard>

        <FaCard>
          <template #header>
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:workflow" class="text-muted-foreground" />
              <span class="font-bold">前端构建</span>
            </div>
          </template>
          <ul class="list-none flex flex-col gap-2">
            <li v-for="entry in frontendEntries" :key="entry.label" class="text-sm flex flex-wrap gap-x-2 items-baseline">
              <span class="text-muted-foreground">{{ entry.label }}</span>
              <span>{{ entry.value }}</span>
              <span v-if="entry.hint" class="text-xs text-muted-foreground">{{ entry.hint }}</span>
            </li>
          </ul>
        </FaCard>

        <FaCard>
          <template #header>
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:user-round" class="text-muted-foreground" />
              <span class="font-bold">当前身份</span>
            </div>
          </template>
          <ul class="list-none flex flex-col gap-2">
            <li v-for="entry in identityEntries" :key="entry.label" class="text-sm flex flex-wrap gap-x-2 items-baseline">
              <span class="text-muted-foreground">{{ entry.label }}</span>
              <span>{{ entry.value }}</span>
              <span v-if="entry.hint" class="text-xs text-muted-foreground">{{ entry.hint }}</span>
            </li>
          </ul>
        </FaCard>

        <FaCard>
          <template #header>
            <div class="flex gap-2 items-center">
              <FaIcon name="i-lucide:monitor-smartphone" class="text-muted-foreground" />
              <span class="font-bold">浏览器环境</span>
            </div>
          </template>
          <ul class="list-none flex flex-col gap-2">
            <li v-for="entry in browserEntries" :key="entry.label" class="text-sm flex flex-wrap gap-x-2 items-baseline">
              <span class="text-muted-foreground">{{ entry.label }}</span>
              <span>{{ entry.value }}</span>
            </li>
          </ul>
        </FaCard>
      </div>

      <FaAlert
        icon="i-lucide:info"
        title="未提供的状态项"
        variant="default"
      >
        <template #description>
          <ul class="list-none flex flex-col gap-1">
            <li v-for="item in unavailableEntries" :key="item">
              {{ item }}
            </li>
          </ul>
        </template>
      </FaAlert>
    </div>
  </FaPageMain>
</template>
