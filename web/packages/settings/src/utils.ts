import type { RequiredDeep } from 'type-fest'
import type { SettingsLegacyOptions, SettingsOptions } from './types'
import { createDefu } from 'defu'
import { cloneDeep } from 'es-toolkit'
import settingsDefault from './default'

export const merge = createDefu((obj, key, value) => {
  if (Array.isArray(obj[key]) && Array.isArray(value)) {
    obj[key] = value
    return true
  }
})

export const mergeWithoutUndefinedProps = createDefu((obj, key, value) => {
  if (obj[key] === undefined) {
    delete obj[key]
    return true
  }
  if (Array.isArray(obj[key]) && Array.isArray(value)) {
    obj[key] = value
    return true
  }
})

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function diffTwoObj(originalObj: Record<string, any>, diffObj: Record<string, any>) {
  if (!isObject(originalObj) || !isObject(diffObj)) {
    return diffObj
  }
  const diff: Record<string, any> = {}
  for (const key in diffObj) {
    const originalValue = originalObj[key]
    const diffValue = diffObj[key]
    if (JSON.stringify(originalValue) !== JSON.stringify(diffValue)) {
      if (isObject(originalValue) && isObject(diffValue)) {
        const nestedDiff = diffTwoObj(originalValue, diffValue)
        if (Object.keys(nestedDiff).length > 0) {
          diff[key] = nestedDiff
        }
      }
      else {
        diff[key] = diffValue
      }
    }
  }
  return diff
}

export function setSettings(settings: SettingsOptions) {
  return merge(settings, cloneDeep(settingsDefault)) as RequiredDeep<SettingsOptions>
}

export function setSettingsLegacy(settingsLegacy: SettingsLegacyOptions) {
  const settingsDefaultLegacy: RequiredDeep<SettingsLegacyOptions> = {
    app: {
      themeSync: true,
      lightTheme: 'default',
      darkTheme: 'default',
      colorScheme: 'light',
      radius: 0.5,
      enableMournMode: false,
      enableColorAmblyopiaMode: false,
      defaultLang: '',
      enablePermission: false,
      enableProgress: true,
      enableDynamicTitle: false,
      enableWatermark: false,
      enableFeedback: false,
      enableErrorLog: false,
      loginExpiredMode: 'redirect',
      enableCheckUpdates: false,
      routeBaseOn: 'frontend',
      direction: 'ltr',
    },
    userPreferences: {
      enable: false,
      storageTo: 'local',
    },
    home: {
      enable: true,
      title: 'app.route.home',
      fullPath: '/',
    },
    layout: {
      widthMode: 'adaption',
      widthModeScope: 'outer',
      enableMobileAdaptation: false,
    },
    menu: {
      baseOn: 'frontend',
      mode: 'side',
      style: '',
      enableDark: false,
      mainMenuClickMode: 'switch',
      subMenuUniqueOpened: true,
      subMenuCollapse: false,
      subMenuAutoCollapse: false,
      enableSubMenuCollapseButton: false,
      enableHotkeys: false,
    },
    topbar: {
      mode: 'static',
      switchTabbarAndToolbar: false,
    },
    tabbar: {
      enable: false,
      style: '',
      enableIcon: false,
      dblclickAction: 'close',
      enableMemory: false,
      enableHotkeys: false,
      storageTo: 'local',
    },
    toolbar: {
      enable: true,
      favorites: false,
      breadcrumb: true,
      navSearch: true,
      notification: false,
      i18n: false,
      fullscreen: false,
      pageReload: false,
      colorScheme: false,
      layout: ['favorites', 'breadcrumb', '->', 'navSearch', 'notification', 'i18n', 'fullscreen', 'pageReload', 'colorScheme'],
    },
    favorites: {
      storageTo: 'local',
    },
    breadcrumb: {
      style: '',
      enableMainMenu: false,
    },
    mainPage: {
      enableHotkeys: true,
      iframeCacheMax: 3,
      enableTransition: true,
      transitionMode: 'fade',
    },
    navSearch: {
      enableHotkeys: true,
    },
    copyright: {
      enable: false,
      dates: '',
      company: '',
      website: '',
      beian: '',
    },
  }

  settingsLegacy = merge(settingsLegacy, cloneDeep(settingsDefaultLegacy))

  const settings: SettingsOptions = {
    app: {
      account: {
        auth: settingsLegacy.app?.enablePermission,
        expiredMode: settingsLegacy.app?.loginExpiredMode,
      },
      routeBaseOn: settingsLegacy.app?.routeBaseOn === 'filesystem' ? 'frontend' : settingsLegacy.app?.routeBaseOn,
      dynamicTitle: settingsLegacy.app?.enableDynamicTitle,
      watermark: settingsLegacy.app?.enableWatermark,
      feedback: settingsLegacy.app?.enableFeedback,
      errorLog: settingsLegacy.app?.enableErrorLog,
      checkUpdates: settingsLegacy.app?.enableCheckUpdates,
      rip: settingsLegacy.app?.enableMournMode,
      mobile: settingsLegacy.layout?.enableMobileAdaptation,
      layout: {
        center: settingsLegacy.layout?.widthMode === 'center',
        centerScope: settingsLegacy.layout?.widthModeScope,
      },
      home: {
        enable: settingsLegacy.home?.enable,
        title: settingsLegacy.home?.title,
        fullPath: settingsLegacy.home?.fullPath,
      },
      copyright: {
        enable: settingsLegacy.copyright?.enable,
        dates: settingsLegacy.copyright?.dates,
        company: settingsLegacy.copyright?.company,
        website: settingsLegacy.copyright?.website,
      },
    },
    theme: {
      sync: settingsLegacy.app?.themeSync,
      light: settingsLegacy.app?.lightTheme,
      dark: settingsLegacy.app?.darkTheme,
      colorScheme: settingsLegacy.app?.colorScheme,
      radius: settingsLegacy.app?.radius,
      colorAmblyopia: settingsLegacy.app?.enableColorAmblyopiaMode,
    },
    menu: {
      mode: settingsLegacy.menu?.mode,
      style: settingsLegacy.menu?.style,
      dark: settingsLegacy.menu?.enableDark,
      mainMenuClickMode: settingsLegacy.menu?.mainMenuClickMode,
      subMenuUniqueExpand: settingsLegacy.menu?.subMenuUniqueOpened,
      subMenuCollapse: settingsLegacy.menu?.subMenuCollapse,
      subMenuAutoCollapse: settingsLegacy.menu?.subMenuAutoCollapse,
      subMenuCollapseButton: settingsLegacy.menu?.enableSubMenuCollapseButton,
      hotkeys: settingsLegacy.menu?.enableHotkeys,
    },
    topbar: {
      tabbar: settingsLegacy.tabbar?.enable,
      toolbar: settingsLegacy.toolbar?.enable,
      mode: settingsLegacy.topbar?.mode,
      switchTabbarAndToolbar: settingsLegacy.topbar?.switchTabbarAndToolbar,
    },
    tabbar: {
      style: settingsLegacy.tabbar?.style,
      icon: settingsLegacy.tabbar?.enableIcon,
      dblclickAction: settingsLegacy.tabbar?.dblclickAction,
      memory: settingsLegacy.tabbar?.enableMemory,
      hotkeys: settingsLegacy.tabbar?.enableHotkeys,
    },
    toolbar: {
      favorites: settingsLegacy.toolbar?.favorites,
      breadcrumb: {
        enable: settingsLegacy.toolbar?.breadcrumb,
        style: settingsLegacy.breadcrumb?.style,
        mainMenu: settingsLegacy.breadcrumb?.enableMainMenu,
      },
      menuSearch: {
        enable: settingsLegacy.toolbar?.navSearch,
        hotkeys: settingsLegacy.navSearch?.enableHotkeys,
      },
      notification: settingsLegacy.toolbar?.notification,
      i18n: {
        enable: settingsLegacy.toolbar?.i18n,
        defaultLang: settingsLegacy.app?.defaultLang,
      },
      fullscreen: settingsLegacy.toolbar?.fullscreen,
      pageReload: settingsLegacy.toolbar?.pageReload,
      colorScheme: settingsLegacy.toolbar?.colorScheme,
      layout: settingsLegacy.toolbar?.layout?.map((item) => {
        if (item === 'navSearch') {
          return 'menuSearch'
        }
        return item
      }),
    },
    page: {
      hotkeys: settingsLegacy.mainPage?.enableHotkeys,
      iframeKeepAliveMax: settingsLegacy.mainPage?.iframeCacheMax,
      transitionMode: settingsLegacy.mainPage?.transitionMode,
      progress: settingsLegacy.app?.enableProgress,
    },
  }

  const result = merge(settings, cloneDeep(settingsDefault))

  // turbo-console-disable-next-line
  console.warn(
    '[Fantastic-admin]\n\n当前正在使用 v5.x 版本的配置，为了您的使用体验，请复制下方 v6.x 配置到 src/settings.ts 中替换\n',
    JSON.stringify(diffTwoObj(settingsDefault, result), null, 2),
  )

  return result as RequiredDeep<SettingsOptions>
}
