<script setup lang="ts">
import { diffTwoObj, setSettings } from '@fantastic-admin/settings'
import { useClipboard } from '@vueuse/core'

type Mode = 'settings' | 'preferences'

defineOptions({
  name: 'AppSettingsActions',
})

withDefaults(defineProps<{
  mode?: Mode
}>(), {
  mode: 'settings',
})

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()
const appPreferencesStore = useAppPreferencesStore()
const settingsDefault = setSettings({})
const { copy, copied, isSupported } = useClipboard({ legacy: true })

function handleCopy() {
  copy(JSON.stringify(diffTwoObj(settingsDefault, appSettingsStore.settings), null, 2))
}

async function handleReset() {
  await appPreferencesStore.updatePreferences()
  location.reload()
}
</script>

<template>
  <!-- 桌面端横向压缩 Footer 高度；窄屏仍保留 44px 全宽触控按钮。 -->
  <div
    v-if="isSupported"
    class="flex flex-col gap-3 w-full sm:flex-row sm:items-center"
    :class="mode === 'settings' ? 'sm:justify-between' : 'sm:justify-end'"
  >
    <template v-if="mode === 'settings'">
      <i18n-t class="text-sm/6 text-muted-foreground min-w-0 sm:flex-1" keypath="app.layouts.appSetting.warning" tag="div">
        <template #path>
          <code class="text-xs font-mono font-semibold px-1 py-0.5 rounded bg-muted relative">src/settings.ts</code>
        </template>
      </i18n-t>
      <FaButton class="shrink-0 min-h-11 w-full sm:min-h-9 sm:w-auto" @click="handleCopy">
        <FaIcon :name="copied ? 'i-tabler:clipboard-check' : 'i-tabler:clipboard'" class="size-5" />
        {{ t('app.layouts.appSetting.copy') }}
      </FaButton>
    </template>
    <FaButton v-else class="shrink-0 min-h-11 w-full sm:min-h-9 sm:w-auto" @click="handleReset">
      {{ t('app.layouts.appSetting.reset') }}
    </FaButton>
  </div>
</template>
