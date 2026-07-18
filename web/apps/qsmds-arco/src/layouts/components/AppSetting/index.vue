<script setup lang="ts">
import { diffTwoObj, setSettings } from '@fantastic-admin/settings'
import { BASE_COLORS, THEMES } from '@fantastic-admin/themes'
import { useClipboard } from '@vueuse/core'
import Sortable from 'sortablejs'
import { localesInfo } from '@/locales'
import eventBus from '@/utils/eventBus'

defineOptions({
  name: 'AppSetting',
})

type Mode = 'settings' | 'preferences'

const { t } = useI18n()

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const settingsDefault = setSettings({})
const appPreferencesStore = useAppPreferencesStore()
const appMenuStore = useAppMenuStore()

type BaseColorName = keyof typeof BASE_COLORS
type ThemeName = keyof typeof THEMES

const isShow = ref(false)
const mode = ref<Mode>('settings')

watch(isShow, (val) => {
  if (val && mode.value === 'settings') {
    appPreferencesStore.$patch({
      immediateUpdate: false,
    })
  }
  else {
    appPreferencesStore.$patch({
      immediateUpdate: true,
    })
  }
}, {
  immediate: true,
})

watch(() => appSettingsStore.settings.app.layout, (value) => {
  if (mode.value !== 'settings') {
    return
  }
  if (route.meta.layout?.center ?? value.center) {
    document.body.setAttribute('data-app-layout-center', '')
  }
  else {
    document.body.removeAttribute('data-app-layout-center')
  }
  document.body.setAttribute('data-app-layout-center-scope', route.meta.layout?.centerScope ?? value.centerScope)
  document.body.style.setProperty('--g-app-layout-center-width', `${route.meta.layout?.centerWidth ?? value.centerWidth}px`)
}, {
  deep: true,
})

const appLayoutCenterWidth = computed<number[]>({
  get() {
    return [appSettingsStore.settings.app.layout.centerWidth]
  },
  set(value) {
    appSettingsStore.settings.app.layout.centerWidth = value[0]
  },
})

const activeColorScheme = computed(() => appSettingsStore.currentColorScheme ?? 'light')
const currentBaseColor = computed(() => {
  return activeColorScheme.value === 'dark'
    ? appSettingsStore.settings.theme.baseColorDark
    : appSettingsStore.settings.theme.baseColorLight
})
const currentBaseColorTokens = computed(() => {
  return BASE_COLORS[currentBaseColor.value][activeColorScheme.value]
})
const themeList = computed(() => {
  return Object.keys(THEMES).map((key) => {
    const tokens = THEMES[key as ThemeName][activeColorScheme.value] as Partial<Record<'--primary', string>>
    return {
      label: key as ThemeName,
      value: THEMES[key as ThemeName][activeColorScheme.value],
      preview: tokens['--primary'] ?? currentBaseColorTokens.value['--primary'],
    }
  })
})
const baseColorList = computed(() => {
  return Object.keys(BASE_COLORS).map((key) => {
    return {
      label: key as BaseColorName,
      value: BASE_COLORS[key as BaseColorName][activeColorScheme.value],
    }
  })
})
const currentTheme = computed(() => {
  return activeColorScheme.value === 'dark'
    ? appSettingsStore.settings.theme.dark
    : appSettingsStore.settings.theme.light
})

function setBaseColor(baseColor: BaseColorName) {
  if (activeColorScheme.value === 'dark') {
    appSettingsStore.settings.theme.baseColorDark = baseColor
  }
  else {
    appSettingsStore.settings.theme.baseColorLight = baseColor
  }
}

function setTheme(theme: ThemeName) {
  if (activeColorScheme.value === 'dark') {
    appSettingsStore.settings.theme.dark = theme
  }
  else {
    appSettingsStore.settings.theme.light = theme
  }
}

const themeRadius = computed<number[]>({
  get() {
    return [appSettingsStore.settings.theme.radius]
  },
  set(value) {
    appSettingsStore.settings.theme.radius = value[0]
  },
})

const i18nDefaultLang = computed({
  get() {
    return appSettingsStore.settings.toolbar.i18n.defaultLang === '' ? '-' : appSettingsStore.settings.toolbar.i18n.defaultLang
  },
  set(value) {
    appSettingsStore.settings.toolbar.i18n.defaultLang = value === '-' ? '' : value
  },
})

const tabbarWidthMode = ref<'constant' | 'adaptive' | 'adaptive-min' | 'adaptive-max'>('constant')
const tabbarWidth = computed<number[]>({
  get() {
    const widthArr = []
    switch (tabbarWidthMode.value) {
      case 'constant':
        widthArr.push(appSettingsStore.settings.tabbar.minMaxWidth[0] as number)
        widthArr.push(appSettingsStore.settings.tabbar.minMaxWidth[1] as number)
        break
      case 'adaptive':
        break
      case 'adaptive-min':
        widthArr.push(appSettingsStore.settings.tabbar.minMaxWidth[0] as number)
        break
      case 'adaptive-max':
        widthArr.push(appSettingsStore.settings.tabbar.minMaxWidth[1] as number)
        break
    }
    return widthArr
  },
  set(value) {
    switch (tabbarWidthMode.value) {
      case 'constant':
        appSettingsStore.settings.tabbar.minMaxWidth = [value[0], value[1]]
        break
      case 'adaptive':
        break
      case 'adaptive-min':
        appSettingsStore.settings.tabbar.minMaxWidth = [value[0], 'unset']
        break
      case 'adaptive-max':
        appSettingsStore.settings.tabbar.minMaxWidth = ['unset', value[0]]
        break
    }
  },
})
watch(tabbarWidthMode, (value) => {
  switch (value) {
    case 'constant':
      appSettingsStore.settings.tabbar.minMaxWidth = [150, 200]
      break
    case 'adaptive':
      appSettingsStore.settings.tabbar.minMaxWidth = ['unset', 'unset']
      break
    case 'adaptive-min':
      appSettingsStore.settings.tabbar.minMaxWidth = [150, 'unset']
      break
    case 'adaptive-max':
      appSettingsStore.settings.tabbar.minMaxWidth = ['unset', 200]
      break
  }
})

watch(() => appSettingsStore.settings.menu.mode, (value) => {
  if (value === 'single') {
    appMenuStore.setActived(0)
  }
  else {
    appMenuStore.setActived(route.fullPath)
  }
})

const toolbarLayoutRef = useTemplateRef('toolbarLayoutRef')
watch(() => toolbarLayoutRef.value, (val) => {
  if (val) {
    // eslint-disable-next-line no-new
    new Sortable(val, {
      animation: 200,
      ghostClass: 'op-30',
      draggable: '.draggable',
      filter: '.no-drag',
      onUpdate: (e) => {
        if (e.newIndex !== undefined && e.oldIndex !== undefined) {
          appSettingsStore.settings.toolbar.layout.splice(e.newIndex, 0, appSettingsStore.settings.toolbar.layout.splice(e.oldIndex, 1)[0])
        }
      },
    })
  }
})

onMounted(() => {
  eventBus.on('global-app-setting-toggle', (modeValue: Mode = 'settings') => {
    isShow.value = !isShow.value
    mode.value = modeValue
  })
})

function checkVisible<T extends object>(preference: boolean | T | undefined, property?: keyof T): boolean {
  if (mode.value === 'settings') {
    return true
  }

  if (typeof preference === 'boolean') {
    return preference
  }

  if (typeof preference !== 'object' || preference === null) {
    return false
  }

  if (property === undefined) {
    return true
  }

  return Boolean(preference[property])
}

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
  <FaModal v-model="isShow" :title="mode === 'settings' ? t('app.layouts.appSetting.titleSettings') : t('app.layouts.appSetting.titlePreferences')" :description="mode === 'settings' ? t('app.layouts.appSetting.description') : undefined" :footer="isSupported" :destroy-on-close="false" class="sm:max-w-4xl" content-class="bg-[var(--g-main-area-bg)] transition-background-color">
    <div
      :class="{
        'columns-1': appSettingsStore.mode === 'mobile',
        'columns-2': appSettingsStore.mode === 'pc',
      }"
    >
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.theme)" :title="t('app.layouts.appSetting.theme.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'baseColorLight') || checkVisible(appSettingsStore.settings.app.preferences.theme, 'baseColorDark')" class="space-y-2">
          <div class="text-sm">
            {{ t('app.layouts.appSetting.theme.baseColor') }}
          </div>
          <div class="themes themes-base">
            <FaButton v-for="item in baseColorList" :key="item.label" variant="outline" class="theme" :class="{ active: currentBaseColor === item.label }" @click="setBaseColor(item.label)">
              <div
                class="content"
                :style="`background-color: oklch(${item.value['--ring']});`"
              />
            </FaButton>
          </div>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'light') || checkVisible(appSettingsStore.settings.app.preferences.theme, 'dark')" class="space-y-2">
          <div class="text-sm">
            {{ t('app.layouts.appSetting.theme.themeColor') }}
          </div>
          <div class="themes themes-theme">
            <FaButton v-for="item in themeList" :key="item.label" variant="outline" class="theme" :class="{ active: currentTheme === item.label }" @click="setTheme(item.label)">
              <div class="content" :style="`background-color: oklch(${item.preview});`" />
            </FaButton>
          </div>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'colorScheme')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.theme.colorScheme') }}
          </div>
          <FaButtonGroup>
            <FaButton
              v-for="(item, index) in [
                { icon: 'i-ri:sun-line', value: 'light' },
                { icon: 'i-ri:moon-line', value: 'dark' },
                { icon: 'i-codicon:color-mode', value: '' },
              ]" :key="index" :variant="appSettingsStore.settings.theme.colorScheme === item.value ? 'default' : 'outline'" size="sm" :class="{ 'z-1': appSettingsStore.settings.theme.colorScheme === item.value }" @click="appSettingsStore.settings.theme.colorScheme = (item.value as any)"
            >
              <FaIcon :name="item.icon" />
            </FaButton>
          </FaButtonGroup>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'sync')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.theme.sync') }}
            <FaTooltip :text="t('app.layouts.appSetting.theme.syncTip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.theme.sync" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'radius')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.theme.radius') }}
          </div>
          <FaSlider v-model="themeRadius" :min="0" :max="1" :step="0.25" class="w-1/2" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.theme, 'colorAmblyopia')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.theme.colorAmblyopia') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.theme.colorAmblyopia" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.menu) && appSettingsStore.mode === 'pc'" :title="t('app.layouts.appSetting.menu.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'mode')" class="menu-mode">
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.side')" :delay="500">
            <FaButton variant="outline" class="mode mode-side" :class="{ active: appSettingsStore.settings.menu.mode === 'side' }" @click="appSettingsStore.settings.menu.mode = 'side'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.head')" :delay="500">
            <FaButton variant="outline" class="mode mode-head" :class="{ active: appSettingsStore.settings.menu.mode === 'head' }" @click="appSettingsStore.settings.menu.mode = 'head'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.single')" :delay="500">
            <FaButton variant="outline" class="mode mode-single" :class="{ active: appSettingsStore.settings.menu.mode === 'single' }" @click="appSettingsStore.settings.menu.mode = 'single'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'mode')" class="menu-mode">
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.only-side')" :delay="500">
            <FaButton variant="outline" class="mode mode-only-side" :class="{ active: appSettingsStore.settings.menu.mode === 'only-side' }" @click="appSettingsStore.settings.menu.mode = 'only-side'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.only-head')" :delay="500">
            <FaButton variant="outline" class="mode mode-only-head" :class="{ active: appSettingsStore.settings.menu.mode === 'only-head' }" @click="appSettingsStore.settings.menu.mode = 'only-head'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.side-panel')" :delay="500">
            <FaButton variant="outline" class="mode mode-side-panel" :class="{ active: appSettingsStore.settings.menu.mode === 'side-panel' }" @click="appSettingsStore.settings.menu.mode = 'side-panel'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
          <FaTooltip :text="t('app.layouts.appSetting.menu.mode.only-head')" :delay="500">
            <FaButton variant="outline" class="mode mode-head-panel" :class="{ active: appSettingsStore.settings.menu.mode === 'head-panel' }" @click="appSettingsStore.settings.menu.mode = 'head-panel'">
              <div class="mode-container" />
            </FaButton>
          </FaTooltip>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'dark')" class="setting-item">
          <div class="label" :class="{ 'op-50': appSettingsStore.currentColorScheme !== 'light' }">
            {{ t('app.layouts.appSetting.menu.dark') }}
            <FaTooltip :text="t('app.layouts.appSetting.menu.darkTip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.dark" :disabled="appSettingsStore.currentColorScheme !== 'light'" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'mainMenuClickMode')" class="setting-item">
          <div class="label" :class="{ 'op-50': !['single', 'side', 'head'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.mainMenuClickMode.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.menu.mainMenuClickMode.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaButtonGroup>
            <FaButton
              v-for="(item, index) in [
                { label: t('app.layouts.appSetting.menu.mainMenuClickMode.switch'), value: 'switch' },
                { label: t('app.layouts.appSetting.menu.mainMenuClickMode.jump'), value: 'jump' },
                { label: t('app.layouts.appSetting.menu.mainMenuClickMode.smart'), value: 'smart' },
              ]" :key="index" :variant="appSettingsStore.settings.menu.mainMenuClickMode === item.value ? 'default' : 'outline'" size="sm" :disabled="!['single', 'side', 'head'].includes(appSettingsStore.settings.menu.mode)" :class="{ 'z-1': appSettingsStore.settings.menu.mainMenuClickMode === item.value }" @click="appSettingsStore.settings.menu.mainMenuClickMode = (item.value as any)"
            >
              {{ item.label }}
            </FaButton>
          </FaButtonGroup>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'subMenuUniqueExpand')" class="setting-item">
          <div class="label" :class="{ 'op-50': ['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.subMenuUniqueExpand') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.subMenuUniqueExpand" :disabled="['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'subMenuCollapse')" class="setting-item">
          <div class="label" :class="{ 'op-50': ['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.subMenuCollapse') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.subMenuCollapse" :disabled="['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'subMenuAutoCollapse')" class="setting-item">
          <div class="label" :class="{ 'op-50': ['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.subMenuAutoCollapse.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.menu.subMenuAutoCollapse.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.subMenuAutoCollapse" :disabled="['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'subMenuCollapseButton') && appSettingsStore.mode === 'pc'" class="setting-item">
          <div class="label" :class="{ 'op-50': ['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.subMenuCollapseButton') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.subMenuCollapseButton" :disabled="['only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'style')" class="setting-item">
          <div class="label" :class="{ 'op-50': appSettingsStore.settings.menu.mode === 'single' }">
            {{ t('app.layouts.appSetting.menu.style') }}
          </div>
          <FaButtonGroup>
            <FaButton
              v-for="(item, index) in [
                { icon: 'i-jam:stop-sign', value: '' },
                { icon: ['head', 'only-head', 'head-panel'].includes(appSettingsStore.settings.menu.mode) ? 'i-ep:caret-top' : 'i-ep:caret-left', value: 'arrow' },
                { icon: ['side', 'only-side', 'side-panel'].includes(appSettingsStore.settings.menu.mode) ? 'i-tabler:minus-vertical' : 'i-tabler:minus', value: 'line' },
                { icon: 'i-icon-park-outline:dot', value: 'dot' },
              ]" :key="index" :variant="appSettingsStore.settings.menu.style === item.value ? 'default' : 'outline'" size="icon" class="h-7 w-7" :class="{ 'z-1': appSettingsStore.settings.menu.style === item.value }" :disabled="appSettingsStore.settings.menu.mode === 'single'" @click="appSettingsStore.settings.menu.style = (item.value as any)"
            >
              <FaIcon :name="item.icon" />
            </FaButton>
          </FaButtonGroup>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.menu, 'hotkeys')" class="setting-item">
          <div class="label" :class="{ 'op-50': ['single', 'only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode) }">
            {{ t('app.layouts.appSetting.menu.hotkeys') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.menu.hotkeys" :disabled="['single', 'only-side', 'only-head', 'side-panel', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.topbar)" :title="t('app.layouts.appSetting.topbar.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.topbar, 'tabbar')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.topbar.tabbar') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.topbar.tabbar" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.topbar, 'toolbar')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.topbar.toolbar') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.topbar.toolbar" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.topbar, 'switchTabbarAndToolbar')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.topbar.switchTabbarAndToolbar.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.topbar.switchTabbarAndToolbar.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.topbar.switchTabbarAndToolbar" :disabled="!appSettingsStore.settings.topbar.tabbar || !appSettingsStore.settings.topbar.toolbar" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.topbar, 'mode')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.topbar.mode.title') }}
          </div>
          <FaButtonGroup>
            <FaButton
              v-for="(item, index) in [
                { label: t('app.layouts.appSetting.topbar.mode.static'), value: 'static' },
                { label: t('app.layouts.appSetting.topbar.mode.fixed'), value: 'fixed' },
                { label: t('app.layouts.appSetting.topbar.mode.sticky'), value: 'sticky' },
              ]" :key="index" :variant="appSettingsStore.settings.topbar.mode === item.value ? 'default' : 'outline'" size="sm" :class="{ 'z-1': appSettingsStore.settings.topbar.mode === item.value }" :disabled="!appSettingsStore.settings.topbar.tabbar && !appSettingsStore.settings.topbar.toolbar" @click="appSettingsStore.settings.topbar.mode = (item.value as any)"
            >
              {{ item.label }}
            </FaButton>
          </FaButtonGroup>
        </div>
      </FaPageMain>
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar)" :title="t('app.layouts.appSetting.tabbar.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'style')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.style.title') }}
          </div>
          <FaButtonGroup>
            <FaButton
              v-for="(item, index) in [
                { label: t('app.layouts.appSetting.tabbar.style.default'), value: '' },
                { label: t('app.layouts.appSetting.tabbar.style.fashion'), value: 'fashion' },
                { label: t('app.layouts.appSetting.tabbar.style.card'), value: 'card' },
                { label: t('app.layouts.appSetting.tabbar.style.square'), value: 'square' },
              ]" :key="index" :variant="appSettingsStore.settings.tabbar.style === item.value ? 'default' : 'outline'" size="sm" :class="{ 'z-1': appSettingsStore.settings.tabbar.style === item.value }" @click="appSettingsStore.settings.tabbar.style = (item.value as any)"
            >
              {{ item.label }}
            </FaButton>
          </FaButtonGroup>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'minMaxWidth')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.minMaxWidth.title') }}
            <FaTooltip>
              <template #content>
                <div class="text-sm space-y-1">
                  <p>{{ t('app.layouts.appSetting.tabbar.minMaxWidth.tip.constant') }}</p>
                  <p>{{ t('app.layouts.appSetting.tabbar.minMaxWidth.tip.adaptive') }}</p>
                  <p>{{ t('app.layouts.appSetting.tabbar.minMaxWidth.tip.adaptive-min') }}</p>
                  <p>{{ t('app.layouts.appSetting.tabbar.minMaxWidth.tip.adaptive-max') }}</p>
                </div>
              </template>
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSelect
            v-model="tabbarWidthMode" :options="[
              { label: t('app.layouts.appSetting.tabbar.minMaxWidth.constant'), value: 'constant' },
              { label: t('app.layouts.appSetting.tabbar.minMaxWidth.adaptive'), value: 'adaptive' },
              { label: t('app.layouts.appSetting.tabbar.minMaxWidth.adaptive-min'), value: 'adaptive-min' },
              { label: t('app.layouts.appSetting.tabbar.minMaxWidth.adaptive-max'), value: 'adaptive-max' },
            ]"
          />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'minMaxWidth') && tabbarWidthMode !== 'adaptive'" class="setting-item">
          <div class="label" />
          <FaSlider v-model="tabbarWidth" :min="100" :max="250" :step="10" class="w-[200px]" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'icon')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.icon') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.tabbar.icon" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'dblclickAction')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.dblclickAction.title') }}
          </div>
          <FaSelect
            v-model="appSettingsStore.settings.tabbar.dblclickAction" :options="[
              { label: t('app.layouts.appSetting.tabbar.dblclickAction.reload'), value: 'reload' },
              { label: t('app.layouts.appSetting.tabbar.dblclickAction.close'), value: 'close' },
              { label: t('app.layouts.appSetting.tabbar.dblclickAction.pin'), value: 'pin' },
              { label: t('app.layouts.appSetting.tabbar.dblclickAction.maximize'), value: 'maximize' },
              { label: t('app.layouts.appSetting.tabbar.dblclickAction.window'), value: 'window' },
            ]"
          />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'memory')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.memory.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.tabbar.memory.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.tabbar.memory" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.tabbar, 'hotkeys')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.tabbar.hotkeys') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.tabbar.hotkeys" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar)" :title="t('app.layouts.appSetting.toolbar.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'favorites')" class="setting-item">
          <div class="label">
            <FaIcon name="i-uiw:star-off" />
            {{ t('app.layouts.appSetting.toolbar.favorites.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.toolbar.favorites.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.favorites" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'breadcrumb') && appSettingsStore.mode === 'pc'" class="setting-item">
          <div class="label">
            <FaIcon name="i-ic:twotone-double-arrow" />
            {{ t('app.layouts.appSetting.toolbar.breadcrumb.title') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.breadcrumb.enable" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'breadcrumb') && appSettingsStore.mode === 'pc'" class="ps-8 space-y-4">
          <div class="setting-item">
            <div class="label" :class="{ 'op-50': !appSettingsStore.settings.toolbar.breadcrumb.enable }">
              {{ t('app.layouts.appSetting.toolbar.breadcrumb.style.title') }}
            </div>
            <FaButtonGroup>
              <FaButton
                v-for="(item, index) in [
                  { label: t('app.layouts.appSetting.toolbar.breadcrumb.style.default'), value: '' },
                  { label: t('app.layouts.appSetting.toolbar.breadcrumb.style.modern'), value: 'modern' },
                ]" :key="index" :variant="appSettingsStore.settings.toolbar.breadcrumb.style === item.value ? 'default' : 'outline'" size="sm" :disabled="!appSettingsStore.settings.toolbar.breadcrumb.enable" :class="{ 'z-1': appSettingsStore.settings.toolbar.breadcrumb.style === item.value }" @click="appSettingsStore.settings.toolbar.breadcrumb.style = (item.value as any)"
              >
                {{ item.label }}
              </FaButton>
            </FaButtonGroup>
          </div>
          <div class="setting-item">
            <div class="label" :class="{ 'op-50': !appSettingsStore.settings.toolbar.breadcrumb.enable }">
              {{ t('app.layouts.appSetting.toolbar.breadcrumb.mainMenu') }}
            </div>
            <FaSwitch v-model="appSettingsStore.settings.toolbar.breadcrumb.mainMenu" :disabled="!appSettingsStore.settings.toolbar.breadcrumb.enable || ['single'].includes(appSettingsStore.settings.menu.mode)" />
          </div>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'menuSearch')" class="setting-item">
          <div class="label">
            <FaIcon name="i-ri:search-line" />
            {{ t('app.layouts.appSetting.toolbar.menuSearch.title') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.menuSearch.enable" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'menuSearch')" class="ps-8 space-y-4">
          <div class="setting-item">
            <div class="label" :class="{ 'op-50': !appSettingsStore.settings.toolbar.menuSearch.enable }">
              {{ t('app.layouts.appSetting.toolbar.menuSearch.hotkeys') }}
            </div>
            <FaSwitch v-model="appSettingsStore.settings.toolbar.menuSearch.hotkeys" :disabled="!appSettingsStore.settings.toolbar.menuSearch.enable" />
          </div>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'notification')" class="setting-item">
          <div class="label">
            <FaIcon name="i-ri:notification-3-line" />
            {{ t('app.layouts.appSetting.toolbar.notification') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.notification" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'i18n')" class="setting-item">
          <div class="label">
            <FaIcon name="i-ri:translate" />
            {{ t('app.layouts.appSetting.toolbar.i18n.title') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.i18n.enable" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'i18n')" class="ps-8 space-y-4">
          <div class="setting-item">
            <div class="label" :class="{ 'op-50': !appSettingsStore.settings.toolbar.i18n.enable }">
              {{ t('app.layouts.appSetting.toolbar.i18n.defaultLang') }}
            </div>
            <FaSelect
              v-model="i18nDefaultLang" :options="[
                { label: t('app.layouts.appSetting.toolbar.i18n.followSystem'), value: '-' },
                ...Object.keys(localesInfo).map(item => ({ label: localesInfo[item].label, value: item })),
              ]" :disabled="!appSettingsStore.settings.toolbar.i18n.enable"
            />
          </div>
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'fullscreen') && appSettingsStore.mode === 'pc'" class="setting-item">
          <div class="label">
            <FaIcon name="i-ri:fullscreen-line" />
            {{ t('app.layouts.appSetting.toolbar.fullscreen') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.fullscreen" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'pageReload')" class="setting-item">
          <div class="label">
            <FaIcon name="i-iconoir:refresh-double" />
            {{ t('app.layouts.appSetting.toolbar.pageReload.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.toolbar.pageReload.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.pageReload" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'colorScheme')" class="setting-item">
          <div class="label">
            <FaIcon name="i-ri:sun-line" />
            {{ t('app.layouts.appSetting.toolbar.colorScheme') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.toolbar.colorScheme" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.toolbar, 'layout')" ref="toolbarLayoutRef" class="px-2 py-1 border rounded-lg flex items-center">
          <span
            v-for="tool in appSettingsStore.settings.toolbar.layout" :key="tool" class="draggable p-1 flex items-center justify-center empty:hidden" :class="{
              'flex-1 text-secondary-foreground/50 no-drag': tool === '->',
              'cursor-ew-resize': tool !== '->' && (typeof appSettingsStore.settings.toolbar[tool] === 'boolean' ? !appSettingsStore.settings.toolbar[tool] : !appSettingsStore.settings.toolbar[tool].enable),
              'pointer-events-none w-0 op-0 p-[0]! no-drag': tool !== '->' && (typeof appSettingsStore.settings.toolbar[tool] === 'boolean' ? !appSettingsStore.settings.toolbar[tool] : !appSettingsStore.settings.toolbar[tool].enable),
            }"
          >
            <FaIcon v-if="tool === 'favorites'" name="i-uiw:star-off" />
            <FaIcon v-if="tool === 'breadcrumb' && appSettingsStore.mode === 'pc'" name="i-ic:twotone-double-arrow" :rotate="appSettingsStore.langDirection === 'rtl' ? 180 : 0" />
            <FaIcon v-if="tool === 'menuSearch'" name="i-ri:search-line" />
            <FaIcon v-if="tool === 'notification'" name="i-ri:notification-3-line" />
            <FaIcon v-if="tool === 'i18n'" name="i-ri:translate" />
            <FaIcon v-if="tool === 'fullscreen' && appSettingsStore.mode === 'pc'" name="i-ri:fullscreen-line" />
            <FaIcon v-if="tool === 'pageReload'" name="i-iconoir:refresh-double" />
            <FaIcon v-if="tool === 'colorScheme'" name="i-ri:sun-line" />
            <span v-if="tool === '->'" class="text-sm pointer-events-none">{{ t('app.layouts.appSetting.toolbar.layout') }}</span>
          </span>
        </div>
      </FaPageMain>
      <FaPageMain v-if="checkVisible(appSettingsStore.settings.app.preferences.page)" :title="t('app.layouts.appSetting.page.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.page, 'transitionMode')" class="transition-mode">
          <FaButton variant="outline" class="mode" :class="{ active: appSettingsStore.settings.page.transitionMode === '' }" @click="appSettingsStore.settings.page.transitionMode = ''" />
          <FaButton variant="outline" class="mode mode-fade" :class="{ active: appSettingsStore.settings.page.transitionMode === 'fade' }" @click="appSettingsStore.settings.page.transitionMode = 'fade'" />
          <FaButton variant="outline" class="mode mode-slide-left" :class="{ active: appSettingsStore.settings.page.transitionMode === 'slide-left' }" @click="appSettingsStore.settings.page.transitionMode = 'slide-left'" />
          <FaButton variant="outline" class="mode mode-slide-right" :class="{ active: appSettingsStore.settings.page.transitionMode === 'slide-right' }" @click="appSettingsStore.settings.page.transitionMode = 'slide-right'" />
          <FaButton variant="outline" class="mode mode-slide-top" :class="{ active: appSettingsStore.settings.page.transitionMode === 'slide-top' }" @click="appSettingsStore.settings.page.transitionMode = 'slide-top'" />
          <FaButton variant="outline" class="mode mode-slide-bottom" :class="{ active: appSettingsStore.settings.page.transitionMode === 'slide-bottom' }" @click="appSettingsStore.settings.page.transitionMode = 'slide-bottom'" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.page, 'progress')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.page.progress.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.page.progress.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.page.progress" />
        </div>
        <div v-if="checkVisible(appSettingsStore.settings.app.preferences.page, 'hotkeys')" class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.page.hotkeys') }}
          </div>
          <FaSwitch v-model="appSettingsStore.settings.page.hotkeys" />
        </div>
      </FaPageMain>
      <FaPageMain v-if="mode === 'settings'" :title="t('app.layouts.appSetting.app.title')" class="m-0 mb-4 break-inside-avoid light:border-none" title-class="font-bold" main-class="space-y-4">
        <div class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.app.dynamicTitle.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.app.dynamicTitle.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.app.dynamicTitle" />
        </div>
        <div class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.app.watermark.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.app.watermark.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.app.watermark" />
        </div>
        <div class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.app.feedback.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.app.feedback.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.app.feedback" />
        </div>
        <div class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.app.rip.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.app.rip.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.app.rip" />
        </div>
        <div class="setting-item">
          <div class="label">
            {{ t('app.layouts.appSetting.app.mobile.title') }}
            <FaTooltip :text="t('app.layouts.appSetting.app.mobile.tip')">
              <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
            </FaTooltip>
          </div>
          <FaSwitch v-model="appSettingsStore.settings.app.mobile" />
        </div>
        <div class="p-4 pb-4 pt-14 border rounded-lg relative space-y-4">
          <div class="font-bold px-4 py-2 border-b border-e rounded-rb-lg inset-s-0 inset-t-0 absolute">
            {{ t('app.layouts.appSetting.app.layout.title') }}
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.layout.center') }}
            </div>
            <FaSwitch v-model="appSettingsStore.settings.app.layout.center" />
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.layout.centerScope.title') }}
            </div>
            <FaButtonGroup>
              <FaButton
                v-for="(item, index) in [
                  { label: t('app.layouts.appSetting.app.layout.centerScope.inner'), value: 'inner' },
                  { label: t('app.layouts.appSetting.app.layout.centerScope.outer'), value: 'outer' },
                ]" :key="index" :variant="appSettingsStore.settings.app.layout.centerScope === item.value ? 'default' : 'outline'" size="sm" :class="{ 'z-1': appSettingsStore.settings.app.layout.centerScope === item.value }" :disabled="!appSettingsStore.settings.app.layout.center" @click="appSettingsStore.settings.app.layout.centerScope = (item.value as any)"
              >
                {{ item.label }}
              </FaButton>
            </FaButtonGroup>
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.layout.centerWidth') }}
            </div>
            <FaSlider v-model="appLayoutCenterWidth" :min="1200" :max="1600" :step="10" :disabled="!appSettingsStore.settings.app.layout.center" class="w-1/2" />
          </div>
        </div>
        <div class="p-4 pb-4 pt-14 border rounded-lg relative space-y-4">
          <div class="font-bold px-4 py-2 border-b border-e rounded-rb-lg inset-s-0 inset-t-0 absolute">
            {{ t('app.layouts.appSetting.app.home.title') }}
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.home.enable.title') }}
              <FaTooltip :text="t('app.layouts.appSetting.app.home.enable.tip')">
                <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
              </FaTooltip>
            </div>
            <FaSwitch v-model="appSettingsStore.settings.app.home.enable" />
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.home.homeTitle.title') }}
              <FaTooltip :text="t('app.layouts.appSetting.app.home.homeTitle.tip')">
                <FaIcon name="i-ri:question-line" class="text-base text-orange cursor-help" />
              </FaTooltip>
            </div>
            <FaInput v-model="appSettingsStore.settings.app.home.title" :disabled="appSettingsStore.settings.toolbar.i18n.enable" />
          </div>
        </div>
        <div class="p-4 pb-4 pt-14 border rounded-lg relative space-y-4">
          <div class="font-bold px-4 py-2 border-b border-e rounded-rb-lg inset-s-0 inset-t-0 absolute">
            {{ t('app.layouts.appSetting.app.copyright.title') }}
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.copyright.enable') }}
            </div>
            <FaSwitch v-model="appSettingsStore.settings.app.copyright.enable" />
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.copyright.dates') }}
            </div>
            <FaInput v-model="appSettingsStore.settings.app.copyright.dates" :disabled="!appSettingsStore.settings.app.copyright.enable" />
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.copyright.company') }}
            </div>
            <FaInput v-model="appSettingsStore.settings.app.copyright.company" :disabled="!appSettingsStore.settings.app.copyright.enable" />
          </div>
          <div class="setting-item">
            <div class="label">
              {{ t('app.layouts.appSetting.app.copyright.website') }}
            </div>
            <FaInput v-model="appSettingsStore.settings.app.copyright.website" :disabled="!appSettingsStore.settings.app.copyright.enable" />
          </div>
        </div>
      </FaPageMain>
    </div>
    <template #footer>
      <div v-if="mode === 'settings'" class="w-full">
        <i18n-t class="text-sm/6 c-rose mb-2 px-4 py-2 text-center rounded-lg bg-rose/20" keypath="app.layouts.appSetting.warning" tag="div">
          <template #path>
            <code class="text-sm font-mono font-semibold px-[0.3rem] py-[0.2rem] rounded bg-muted relative">src/settings.ts</code>
          </template>
        </i18n-t>
        <FaButton class="w-full" @click="handleCopy">
          <FaIcon :name="copied ? 'i-tabler:clipboard-check' : 'i-tabler:clipboard'" class="size-5" />
          {{ t('app.layouts.appSetting.copy') }}
        </FaButton>
      </div>
      <FaButton v-if="mode === 'preferences'" class="w-full" @click="handleReset">
        {{ t('app.layouts.appSetting.reset') }}
      </FaButton>
    </template>
  </FaModal>
</template>

<style scoped>
.themes {
  --uno: grid gap-2;

  &.themes-base {
    --uno: grid-cols-7;
  }

  &.themes-theme {
    --uno: grid-cols-6;
  }

  .theme {
    --uno: place-self-center w-full h-9 min-w-0 px-0;

    &.active {
      --uno: ring-primary ring-2;

      .content {
        --uno: w-5;
      }
    }

    .content {
      --uno: size-3.5 rounded-1/2 -rotate-45 transition-transform transition-width origin-center;
    }
  }
}

.menu-mode {
  --uno: flex items-center justify-center gap-4;

  .mode {
    --uno: relative w-16 h-12;

    &.active {
      --uno: ring-primary ring-2;
    }

    &::before,
    &::after,
    .mode-container {
      --uno: absolute pointer-events-none;
    }

    &::before {
      --uno: content-empty bg-primary;
    }

    &::after {
      --uno: content-empty bg-primary/60;
    }

    .mode-container {
      --uno: bg-primary/20 border-width-1.5 border-dashed border-primary;

      &::before {
        --uno: content-empty absolute w-full h-full;
      }
    }

    &-side {
      &::before {
        --uno: top-2 bottom-2 start-2 w-2 rounded-ss-1 rounded-es-1;
      }

      &::after {
        --uno: top-2 bottom-2 start-4.5 w-3;
      }

      .mode-container {
        --uno: inset-t-2 inset-e-2 inset-b-2 inset-s-8 rounded-se-1 rounded-ee-1;
      }
    }

    &-head {
      &::before {
        --uno: top-2 start-2 end-2 h-2 rounded-ss-1 rounded-se-1;
      }

      &::after {
        --uno: top-4.5 start-2 bottom-2 w-3 rounded-es-1;
      }

      .mode-container {
        --uno: inset-t-4.5 inset-e-2 inset-b-2 inset-s-5.5 rounded-ee-1;
      }
    }

    &-single {
      &::after {
        --uno: top-2 start-2 bottom-2 w-3 rounded-ss-1 rounded-es-1;
      }

      .mode-container {
        --uno: inset-t-2 inset-e-2 inset-b-2 inset-s-5.5 rounded-se-1 rounded-ee-1;
      }
    }

    &-only-side {
      &::before {
        --uno: top-2 bottom-2 start-2 w-2 rounded-ss-1 rounded-es-1;
      }

      .mode-container {
        --uno: inset-t-2 inset-e-2 inset-b-2 inset-s-4.5 rounded-se-1 rounded-ee-1;
      }
    }

    &-only-head {
      &::before {
        --uno: top-2 start-2 end-2 h-2 rounded-ss-1 rounded-se-1;
      }

      .mode-container {
        --uno: inset-t-4.5 inset-e-2 inset-b-2 inset-s-2 rounded-es-1 rounded-ee-1;
      }
    }

    &-side-panel {
      &::before {
        --uno: top-2 bottom-2 start-2 w-2 rounded-ss-1 rounded-es-1;
      }

      &::after {
        --uno: top-4 bottom-4 start-5.5 w-5;
      }

      .mode-container {
        --uno: inset-t-2 inset-e-2 inset-b-2 inset-s-4.5 rounded-se-1 rounded-ee-1;
      }
    }

    &-head-panel {
      &::before {
        --uno: top-2 start-2 end-2 h-2 rounded-ss-1 rounded-se-1;
      }

      &::after {
        --uno: top-5.5 bottom-3.5 start-5 w-6;
      }

      .mode-container {
        --uno: inset-t-4.5 inset-e-2 inset-b-2 inset-s-2 rounded-es-1 rounded-ee-1;
      }
    }
  }
}

.transition-mode {
  --uno: flex items-center justify-center gap-4;

  .mode {
    --uno: relative flex-1;

    &.active {
      --uno: ring-primary ring-2;
    }

    &::after {
      --uno: content-empty absolute w-3/5 h-3/5 top-1/5 left-1/5 rounded-lg bg-primary/20;

      animation: transition-mode-after 1.5s infinite;
    }

    @keyframes transition-mode-after {
      0% {
        visibility: visible;
      }

      30%,
      35% {
        visibility: hidden;
      }

      65% {
        visibility: visible;
      }
    }

    &.mode-fade {
      &::after {
        animation: transition-mode-fade-after 1.5s infinite;
      }

      @keyframes transition-mode-fade-after {
        0% {
          opacity: 1;
        }

        30%,
        35% {
          opacity: 0;
        }

        65% {
          opacity: 1;
        }
      }
    }

    &.mode-slide-left {
      &::after {
        animation: transition-mode-slide-left 1.5s infinite;
      }

      @keyframes transition-mode-slide-left {
        0% {
          opacity: 1;
        }

        30% {
          opacity: 0;
          transform: translate(-30%, 0);
        }

        35% {
          opacity: 0;
          transform: translate(30%, 0);
        }

        65% {
          opacity: 1;
        }
      }
    }

    &.mode-slide-right {
      &::after {
        animation: transition-mode-slide-right 1.5s infinite;
      }

      @keyframes transition-mode-slide-right {
        0% {
          opacity: 1;
        }

        30% {
          opacity: 0;
          transform: translate(30%, 0);
        }

        35% {
          opacity: 0;
          transform: translate(-30%, 0);
        }

        100% {
          opacity: 1;
        }
      }
    }

    &.mode-slide-top {
      &::after {
        animation: transition-mode-slide-top 1.5s infinite;
      }

      @keyframes transition-mode-slide-top {
        0% {
          opacity: 1;
        }

        30% {
          opacity: 0;
          transform: translate(0, -30%);
        }

        35% {
          opacity: 0;
          transform: translate(0, 30%);
        }

        100% {
          opacity: 1;
        }
      }
    }

    &.mode-slide-bottom {
      &::after {
        animation: transition-mode-slide-bottom 1.5s infinite;
      }

      @keyframes transition-mode-slide-bottom {
        0% {
          opacity: 1;
        }

        30% {
          opacity: 0;
          transform: translate(0, 30%);
        }

        35% {
          opacity: 0;
          transform: translate(0, -30%);
        }

        100% {
          opacity: 1;
        }
      }
    }
  }
}

.setting-item {
  --uno: flex items-center justify-between gap-4;

  .label {
    --uno: flex items-center flex-shrink-0 gap-2 text-sm;
  }
}
</style>
