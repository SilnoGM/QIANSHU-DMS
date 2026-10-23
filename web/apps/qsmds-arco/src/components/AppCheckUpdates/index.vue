<script setup lang="ts">
import type { ReleaseManifest } from './logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  isAllReleaseAudience,
  isNewerVersion,
  normalizeReleaseManifest,
  parseReleaseNoteItem,
  resolveReleaseSectionAudience,
} from './logic'

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

const SECTION_PRESENTATION: Record<string, { icon: string, tone: string }> = {
  功能新增: { icon: 'i-lucide:sparkles', tone: 'text-primary' },
  功能优化: { icon: 'i-lucide:trending-up', tone: 'text-primary' },
  缺陷修复: { icon: 'i-lucide:wrench', tone: 'text-amber-600 dark:text-amber-300' },
  已知问题: { icon: 'i-lucide:triangle-alert', tone: 'text-amber-600 dark:text-amber-300' },
}
const DEFAULT_SECTION_PRESENTATION = { icon: 'i-lucide:info', tone: 'text-muted-foreground' }

const updateTitle = computed(() => releaseInfo.value === null
  ? t('app.components.checkUpdates.message')
  : t('app.components.checkUpdates.messageWithVersion', { version: releaseInfo.value.version }))
const releaseSections = computed(() => (releaseInfo.value?.sections ?? []).map((section) => {
  const items = section.items.map(parseReleaseNoteItem)
  return {
    title: section.title,
    items,
    audience: resolveReleaseSectionAudience(items),
    presentation: SECTION_PRESENTATION[section.title] ?? DEFAULT_SECTION_PRESENTATION,
  }
}))

function releaseRolesLabel(roles: readonly string[]): string {
  return roles.join('、')
}

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
    size="lg"
    :closable="false"
    :dismiss-on-overlay="false"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:sparkles" class="size-4" aria-hidden="true" />
    </template>

    <template #description>
      <span class="inline-flex flex-wrap gap-x-2 gap-y-1 items-center">
        <span>{{ t('app.components.checkUpdates.currentVersion') }}</span>
        <span class="font-qs-data-mono text-xs text-muted-foreground px-2 py-0.5 rounded-md bg-muted">
          v{{ currentVersion }}
        </span>
        <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-3.5" aria-hidden="true" />
        <span>{{ t('app.components.checkUpdates.latestVersion') }}</span>
        <span class="font-qs-data-mono text-xs text-primary font-semibold px-2 py-0.5 rounded-md bg-primary/10">
          v{{ releaseInfo?.version }}
        </span>
      </span>
    </template>

    <div
      v-if="releaseSections.length > 0"
      class="pe-2 max-h-[min(52vh,30rem)] [scrollbar-gutter:stable] overflow-y-auto space-y-3"
      tabindex="0"
      :aria-label="t('app.components.checkUpdates.contentLabel')"
    >
      <section
        v-for="section in releaseSections"
        :key="section.title"
        class="p-3 border rounded-lg sm:p-4"
        :class="section.title === '已知问题'
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-border/70 bg-muted/20'"
      >
        <div class="mb-2 flex gap-2 items-center">
          <FaIcon
            :name="section.presentation.icon"
            class="shrink-0 size-4"
            :class="section.presentation.tone"
            aria-hidden="true"
          />
          <h3 class="text-sm font-semibold m-0">
            {{ section.title }}
          </h3>
          <FaTag variant="secondary" class="text-xs ms-auto tabular-nums" aria-hidden="true">
            {{ section.items.length }}
          </FaTag>
        </div>

        <p
          v-if="section.audience.commonRoles"
          class="text-xs text-muted-foreground m-0 mb-2"
        >
          {{ t('app.components.checkUpdates.audience', { roles: releaseRolesLabel(section.audience.commonRoles) }) }}
        </p>

        <ul class="m-0 p-0 list-none space-y-2">
          <li
            v-for="(item, index) in section.items"
            :key="`${section.title}-${index}`"
            class="flex gap-2"
          >
            <span class="mt-2 rounded-full bg-primary/70 shrink-0 size-1.5" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-sm text-foreground leading-6 m-0 break-words">
                {{ item.text }}
              </p>
              <p
                v-if="section.audience.showItemRoles && item.roles.length > 0 && !isAllReleaseAudience(item.roles)"
                class="text-xs text-muted-foreground m-0 mt-0.5"
              >
                {{ t('app.components.checkUpdates.audience', { roles: releaseRolesLabel(item.roles) }) }}
              </p>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <p v-else class="text-sm text-muted-foreground m-0">
      {{ t('app.components.checkUpdates.description') }}
    </p>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="closeUpdateNotice"
      >
        {{ t('app.components.checkUpdates.later') }}
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="reloadPage"
      >
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        {{ t('app.components.checkUpdates.refreshNow') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
