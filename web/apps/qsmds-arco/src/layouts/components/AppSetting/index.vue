<script setup lang="ts">
import AppSettingsActions from '@/components/business/AppSettingsPanel/AppSettingsActions.vue'
import AppSettingsPanel from '@/components/business/AppSettingsPanel/index.vue'
import eventBus from '@/utils/eventBus'

defineOptions({
  name: 'AppSetting',
})

type Mode = 'settings' | 'preferences'

const { t } = useI18n()
const isShow = ref(false)
const mode = ref<Mode>('settings')

function toggleAppSetting(modeValue: Mode = 'settings') {
  isShow.value = !isShow.value
  mode.value = modeValue
}

onMounted(() => {
  eventBus.on('global-app-setting-toggle', toggleAppSetting)
})

onBeforeUnmount(() => {
  eventBus.off('global-app-setting-toggle', toggleAppSetting)
})
</script>

<template>
  <FaModal
    v-model="isShow"
    :title="mode === 'settings' ? t('app.layouts.appSetting.titleSettings') : t('app.layouts.appSetting.titlePreferences')"
    :description="mode === 'settings' ? t('app.layouts.appSetting.description') : undefined"
    :destroy-on-close="false"
    class="sm:max-w-4xl"
    content-class="bg-[var(--g-main-area-bg)] transition-background-color"
  >
    <AppSettingsPanel :active="isShow" :mode="mode" />

    <template #footer>
      <AppSettingsActions :mode="mode" />
    </template>
  </FaModal>
</template>
