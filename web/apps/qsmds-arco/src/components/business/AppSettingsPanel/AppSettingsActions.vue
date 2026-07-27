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
  <div v-if="isSupported" class="w-full">
    <template v-if="mode === 'settings'">
      <i18n-t class="text-sm/6 c-rose mb-2 px-4 py-2 text-center rounded-lg bg-rose/20" keypath="app.layouts.appSetting.warning" tag="div">
        <template #path>
          <code class="text-sm font-mono font-semibold px-[0.3rem] py-[0.2rem] rounded bg-muted relative">src/settings.ts</code>
        </template>
      </i18n-t>
      <FaButton class="w-full" @click="handleCopy">
        <FaIcon :name="copied ? 'i-tabler:clipboard-check' : 'i-tabler:clipboard'" class="size-5" />
        {{ t('app.layouts.appSetting.copy') }}
      </FaButton>
    </template>
    <FaButton v-else class="w-full" @click="handleReset">
      {{ t('app.layouts.appSetting.reset') }}
    </FaButton>
  </div>
</template>
