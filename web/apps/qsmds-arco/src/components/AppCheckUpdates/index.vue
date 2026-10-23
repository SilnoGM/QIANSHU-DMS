<script setup lang="ts">
import type { ReleaseManifest } from './logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { isNewerVersion, normalizeReleaseManifest } from './logic'

defineOptions({
  name: 'AppCheckUpdates',
})

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()

const currentVersion = __SYSTEM_INFO__.pkg.version
const releaseInfo = ref<ReleaseManifest | null>(null)
const updateNoticeVisible = ref(false)
const updateNoticeHandled = ref(false)
const checking = ref(false)
const checkUpdatesInterval = ref(Number.NaN)
let releaseRequest: AbortController | null = null

const updateTitle = computed(() => releaseInfo.value === null
  ? t('app.components.checkUpdates.message')
  : t('app.components.checkUpdates.messageWithVersion', { version: releaseInfo.value.version }))
const versionSummary = computed(() => releaseInfo.value === null
  ? ''
  : t('app.components.checkUpdates.versionSummary', {
      current: currentVersion,
      next: releaseInfo.value.version,
    }))

/**
 * 发布清单是唯一的新版本真相源。它跟随 Web 镜像发布，旧页面也能读取到新版本；
 * 使用 no-store + 10 秒超时，避免像旧的 HEAD 检测那样被固定 Last-Modified 欺骗或在弱网下长期挂起。
 */
async function fetchReleaseManifest(): Promise<ReleaseManifest | null> {
  releaseRequest?.abort()
  const controller = new AbortController()
  releaseRequest = controller
  const timeout = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}release.json`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return null
    }
    return normalizeReleaseManifest(await response.json())
  }
  catch {
    return null
  }
  finally {
    window.clearTimeout(timeout)
    if (releaseRequest === controller) {
      releaseRequest = null
    }
  }
}

async function checkUpdates() {
  if (updateNoticeHandled.value || checking.value) {
    return
  }

  checking.value = true
  try {
    const release = await fetchReleaseManifest()
    if (release === null || !isNewerVersion(release.version, currentVersion)) {
      return
    }
    releaseInfo.value = release
    // handled 是一次性提示锁，用户取消或按 Escape 后也不能在本次会话反复打扰。
    updateNoticeHandled.value = true
    stopInterval()
    updateNoticeVisible.value = true
  }
  finally {
    checking.value = false
  }
}

function startInterval() {
  if (updateNoticeHandled.value) {
    return
  }
  void checkUpdates()
  checkUpdatesInterval.value = window.setInterval(checkUpdates, 60_000)
}

function stopInterval() {
  window.clearInterval(checkUpdatesInterval.value)
  checkUpdatesInterval.value = Number.NaN
}

function handleVisibilitychange() {
  if (document.hidden) {
    stopInterval()
  }
  else {
    startInterval()
  }
}

function closeUpdateNotice() {
  updateNoticeVisible.value = false
}

function reloadPage() {
  location.reload()
}

onMounted(() => {
  if (import.meta.env.PROD && appSettingsStore.settings.app.checkUpdates) {
    startInterval()
    document.addEventListener('visibilitychange', handleVisibilitychange)
  }
})

onUnmounted(() => {
  if (import.meta.env.PROD && appSettingsStore.settings.app.checkUpdates) {
    stopInterval()
    document.removeEventListener('visibilitychange', handleVisibilitychange)
  }
  releaseRequest?.abort()
  releaseRequest = null
})
</script>

<template>
  <QsGenericModal
    v-model="updateNoticeVisible"
    :title="updateTitle"
    size="md"
    :closable="false"
    :dismiss-on-overlay="false"
  >
    <div class="space-y-4">
      <p v-if="versionSummary" class="text-sm text-muted-foreground m-0">
        {{ versionSummary }}
      </p>

      <div
        v-if="releaseInfo && releaseInfo.sections.length > 0"
        class="pe-1 max-h-[50vh] overflow-y-auto space-y-4"
      >
        <section v-for="section in releaseInfo.sections" :key="section.title">
          <h4 class="text-sm font-semibold m-0 mb-2">
            {{ section.title }}
          </h4>
          <ul class="text-sm text-muted-foreground m-0 ps-4 space-y-1.5">
            <li v-for="(item, index) in section.items" :key="`${section.title}-${index}`">
              {{ item }}
            </li>
          </ul>
        </section>
      </div>

      <p v-else class="text-sm text-muted-foreground m-0">
        {{ t('app.components.checkUpdates.description') }}
      </p>
    </div>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="closeUpdateNotice"
      >
        {{ t('app.components.checkUpdates.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="reloadPage"
      >
        {{ t('app.components.checkUpdates.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
