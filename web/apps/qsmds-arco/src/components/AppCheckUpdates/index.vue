<script setup lang="ts">
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({
  name: 'AppCheckUpdates',
})

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()

const updateNoticeVisible = ref(false)
const updateNoticeHandled = ref(false)
const lastVersionTag = ref('')
const checkUpdatesInterval = ref(Number.NaN)

async function getVersionTag() {
  try {
    const response = await fetch(`${location.origin}${location.pathname}`, {
      cache: 'no-cache',
      method: 'HEAD',
    })
    return response.headers.get('etag') || response.headers.get('last-modified')
  }
  catch {
    console.error('检查更新失败')
  }
}

async function checkUpdates() {
  if (updateNoticeHandled.value) {
    return
  }

  const versionTag = await getVersionTag()
  if (!versionTag) {
    return
  }
  if (!lastVersionTag.value) {
    lastVersionTag.value = versionTag
    return
  }
  if (updateNoticeVisible.value || updateNoticeHandled.value) {
    return
  }
  if (lastVersionTag.value !== versionTag && versionTag) {
    stopInterval()
    // handled 是一次性提示锁，用户取消或按 Escape 后也不能在本次会话反复打扰。
    updateNoticeHandled.value = true
    updateNoticeVisible.value = true
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
  clearInterval(checkUpdatesInterval.value)
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
})
</script>

<template>
  <QsGenericModal
    v-model="updateNoticeVisible"
    :title="t('app.components.checkUpdates.message')"
    size="sm"
    :closable="false"
    :dismiss-on-overlay="false"
  >
    <p class="text-sm text-muted-foreground leading-6 m-0">
      {{ t('app.components.checkUpdates.description') }}
    </p>

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
