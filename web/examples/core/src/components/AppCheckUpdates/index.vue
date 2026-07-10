<script setup lang="ts">
defineOptions({
  name: 'AppCheckUpdates',
})

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()

const visible = ref(false)
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
  const versionTag = await getVersionTag()
  if (!versionTag) {
    return
  }
  if (!lastVersionTag.value) {
    lastVersionTag.value = versionTag
    return
  }
  if (visible.value) {
    return
  }
  if (lastVersionTag.value !== versionTag && versionTag) {
    stopInterval()
    visible.value = true
    useFaModal().confirm({
      title: t('app.components.checkUpdates.message'),
      content: t('app.components.checkUpdates.description'),
      confirmButtonText: t('app.components.checkUpdates.confirm'),
      cancelButtonText: t('app.components.checkUpdates.cancel'),
      onConfirm: () => location.reload(),
    })
  }
}

function startInterval() {
  checkUpdates()
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
  <div />
</template>
