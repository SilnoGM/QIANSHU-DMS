<script setup lang="ts">
import AppAccountProfile from '@/components/AppAccountButton/profile.vue'
import EditPassword from '@/components/AppAccountForm/edit-password.vue'
import AppStartupSplash from '@/components/AppStartupSplash/index.vue'
import { useAppStartup } from '@/composables/app/startup'
import {
  resolveAuthRetryNavigation,
  resolveForcedPasswordCompletionNavigation,
  resolveRequestedFullPath,
} from '@/store/modules/app/auth-retry-navigation'
import dayjs from '@/utils/dayjs'
import eventBus from '@/utils/eventBus'
import { ua } from '@/utils/ua'
import Provider from './ui/provider/index.vue'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const appAccountStore = useAppAccountStore()
const router = useRouter()

const { locale } = useI18n()
const { auth } = useAppAuth()
const { auth: localeAuth } = useAppLocaleAuth()
const { generateI18nTitle } = useAppMenu()
const { visible: startupVisible, leaving: startupLeaving } = useAppStartup()
const changePasswordVisible = ref(false)
const profileVisible = ref(false)

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
  eventBus.on('global-change-password-visible', openChangePassword)
  eventBus.on('global-profile-visible', openProfile)
})

onBeforeUnmount(() => {
  eventBus.off('global-change-password-visible', openChangePassword)
  eventBus.off('global-profile-visible', openProfile)
})

function openChangePassword() {
  if (appAccountStore.authState === 'authenticated') {
    changePasswordVisible.value = true
  }
}

function openProfile() {
  if (appAccountStore.authState === 'authenticated') {
    profileVisible.value = true
  }
}

async function retryAuthentication() {
  const homeFullPath = appSettingsStore.settings.app.home.fullPath
  const currentFullPath = resolveRequestedFullPath(
    route.fullPath || homeFullPath,
    window.location.hash,
  )
  await appAccountStore.revalidateAuth()
  const target = resolveAuthRetryNavigation(
    appAccountStore.authState,
    currentFullPath,
    homeFullPath,
  )
  if (target !== null) {
    await router.replace(target)
  }
}

async function handleNormalPasswordSuccess() {
  // 改密会轮换 Session 并清理旧身份域；重新进入当前路径以注册新身份的动态路由。
  await router.replace(route.fullPath || appSettingsStore.settings.app.home.fullPath)
}

watch(() => appAccountStore.authState, (state, previousState) => {
  if (state !== 'authenticated') {
    changePasswordVisible.value = false
    profileVisible.value = false
  }
  const target = resolveForcedPasswordCompletionNavigation(
    previousState,
    state,
    appSettingsStore.settings.app.home.fullPath,
  )
  if (target !== null) {
    // 根层拥有 Router 生命周期，避免强制改密 Modal 卸载与 success 事件竞争。
    void router.replace(target)
  }
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
    <div v-if="appAccountStore.authState === 'loading'" class="bg-background flex-center min-h-screen">
      <div class="flex-col-center gap-4">
        <FaIcon name="i-svg-spinners:90-ring-with-bg" class="text-primary size-10" />
        <span class="text-sm text-muted-foreground">正在确认登录状态…</span>
      </div>
    </div>
    <div v-else-if="appAccountStore.authState === 'unavailable'" class="p-6 bg-background flex-center min-h-screen">
      <AResult status="warning" title="暂时无法确认登录状态" subtitle="系统不会把网络故障当作退出登录，请检查连接后重试。">
        <template #extra>
          <AButton type="primary" @click="retryAuthentication">
            重新检查身份
          </AButton>
        </template>
      </AResult>
    </div>
    <div v-else-if="appAccountStore.authState === 'password_change_required'" class="bg-muted/30 min-h-screen">
      <EditPassword :model-value="true" forced />
    </div>
    <template v-else>
      <RouterView v-slot="{ Component }">
        <AppNotSupportedMobile v-if="!appSettingsStore.settings.app.mobile && appSettingsStore.mode === 'mobile'" />
        <Component :is="Component" v-else-if="isAuth" />
        <AppNotAllowed v-else />
      </RouterView>
      <AppBackToTop />
    </template>
    <EditPassword
      v-if="appAccountStore.authState === 'authenticated'"
      v-model="changePasswordVisible"
      @success="handleNormalPasswordSuccess"
    />
    <AppAccountProfile
      v-if="appAccountStore.authState === 'authenticated'"
      v-model="profileVisible"
    />
    <FaToast :theme="appSettingsStore.currentColorScheme" />
    <AppCheckUpdates />
    <AppSystemInfo />
    <AppStartupSplash v-if="startupVisible" :leaving="startupLeaving" />
  </Provider>
</template>
