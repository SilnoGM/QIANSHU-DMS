<script setup lang="ts">
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import eventBus from '@/utils/eventBus'

defineOptions({
  name: 'AppAssetReload',
})

const { t } = useI18n()

const visible = ref(false)

function handleReloadRequired(): void {
  visible.value = true
}

function closePrompt(): void {
  visible.value = false
}

function reloadPage(): void {
  window.location.reload()
}

onMounted(() => {
  eventBus.on('global-asset-reload-required', handleReloadRequired)
})

onUnmounted(() => {
  eventBus.off('global-asset-reload-required', handleReloadRequired)
})
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('app.components.assetReload.title')"
    :closable="false"
    :dismiss-on-overlay="false"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
    </template>

    <p class="text-sm text-muted-foreground leading-6 m-0">
      {{ t('app.components.assetReload.description') }}
    </p>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="closePrompt"
      >
        {{ t('app.components.assetReload.later') }}
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="reloadPage"
      >
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        {{ t('app.components.assetReload.refreshNow') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
