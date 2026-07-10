<script setup lang="ts">
import dayjs from '@/utils/dayjs'
import { ua } from '@/utils/ua'
import Provider from './ui/provider/index.vue'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

const route = useRoute()

const appSettingsStore = useAppSettingsStore()

const { locale } = useI18n()
const { auth } = useAppAuth()
const { auth: localeAuth } = useAppLocaleAuth()
const { generateI18nTitle } = useAppMenu()

document.body.setAttribute('data-os', ua.getOS().name || '')

const isAuth = computed(() => {
  return route.matched.every((item) => {
    return auth(item.meta.auth ?? '') && localeAuth(item.meta.localeAuth ?? '')
  })
})

// 设置网页 title
watch([
  () => appSettingsStore.settings.app.dynamicTitle,
  () => appSettingsStore.title,
  () => appSettingsStore.customTitleList,
  () => appSettingsStore.lang,
], () => {
  nextTick(() => {
    if (appSettingsStore.settings.app.dynamicTitle && appSettingsStore.title) {
      const title = appSettingsStore.customTitleList.find(item => item.fullPath === route.fullPath)?.title || generateI18nTitle(appSettingsStore.title)
      document.title = `${title} - ${import.meta.env.VITE_APP_TITLE}`
    }
    else {
      document.title = import.meta.env.VITE_APP_TITLE
    }
  })
}, {
  immediate: true,
  deep: true,
})

onMounted(() => {
  appSettingsStore.setMode(document.documentElement.clientWidth)
  window.addEventListener('resize', () => {
    appSettingsStore.setMode(document.documentElement.clientWidth)
  })
})

watch(() => appSettingsStore.lang, () => {
  locale.value = appSettingsStore.lang
})

watch(() => appSettingsStore.lang, () => {
  switch (appSettingsStore.lang) {
    case 'zh-cn':
      dayjs.locale('zh-cn')
      break
    case 'zh-tw':
      dayjs.locale('zh-tw')
      break
    case 'en':
      dayjs.locale('en')
      break
  }
}, {
  immediate: true,
})
</script>

<template>
  <Provider>
    <RouterView v-slot="{ Component }">
      <AppNotSupportedMobile v-if="!appSettingsStore.settings.app.mobile && appSettingsStore.mode === 'mobile'" />
      <Component :is="Component" v-else-if="isAuth" />
      <AppNotAllowed v-else />
    </RouterView>
    <AppBackToTop />
    <FaToast :theme="appSettingsStore.currentColorScheme" />
    <AppLoginAgain />
    <AppCheckUpdates />
    <AppSystemInfo />
  </Provider>
</template>
