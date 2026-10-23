<script setup lang="ts">
import { ConfigProvider as AConfigProvider } from '@arco-design/web-vue'
import { locales } from './index'
import '@arco-design/web-vue/es/config-provider/style/css.js'

const appSettingsStore = useAppSettingsStore()

const prefersColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
watch(() => appSettingsStore.settings.theme.colorScheme, (colorScheme) => {
  if (colorScheme === '') {
    prefersColorScheme.addEventListener('change', updateTheme)
  }
  else {
    prefersColorScheme.removeEventListener('change', updateTheme)
  }
  nextTick(() => {
    updateTheme()
  })
}, {
  immediate: true,
})
function updateTheme() {
  switch (appSettingsStore.currentColorScheme) {
    case 'light':
      document.body.removeAttribute('arco-theme')
      break
    case 'dark':
      document.body.setAttribute('arco-theme', 'dark')
      break
  }
}
</script>

<template>
  <AConfigProvider :locale="locales[appSettingsStore.lang]">
    <slot />
  </AConfigProvider>
</template>
