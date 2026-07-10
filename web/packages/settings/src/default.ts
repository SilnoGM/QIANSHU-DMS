import type { RequiredDeep } from 'type-fest'
import type { SettingsOptions } from './types'

const settingsDefault: RequiredDeep<SettingsOptions> = {
  app: {
    account: {
      auth: false,
      expiredMode: 'redirect',
      multipleAccounts: false,
    },
    routeMode: 'hash',
    routeBaseOn: 'frontend',
    dynamicTitle: false,
    watermark: false,
    feedback: false,
    lockScreen: false,
    errorLog: false,
    checkUpdates: false,
    rip: false,
    mobile: true,
    layout: {
      center: false,
      centerScope: 'inner',
      centerWidth: 1400,
    },
    home: {
      enable: true,
      title: 'app.route.home',
      fullPath: '/',
    },
    copyright: {
      enable: false,
      dates: '',
      company: '',
      website: '',
    },
    preferences: {
      theme: false,
      menu: false,
      topbar: false,
      tabbar: false,
      toolbar: false,
      page: false,
    },
  },
  theme: {
    sync: true,
    baseColorLight: 'neutral',
    baseColorDark: 'neutral',
    light: 'default',
    dark: 'default',
    colorScheme: 'light',
    radius: 0.5,
    colorAmblyopia: false,
  },
  menu: {
    mode: 'side',
    style: '',
    dark: false,
    mainMenuClickMode: 'switch',
    subMenuUniqueExpand: true,
    subMenuCollapse: false,
    subMenuAutoCollapse: false,
    subMenuCollapseButton: false,
    hotkeys: false,
  },
  topbar: {
    tabbar: false,
    toolbar: true,
    mode: 'static',
    switchTabbarAndToolbar: false,
  },
  tabbar: {
    style: '',
    minMaxWidth: [150, 150],
    icon: false,
    dblclickAction: 'close',
    memory: false,
    hotkeys: false,
  },
  toolbar: {
    favorites: false,
    breadcrumb: {
      enable: true,
      style: '',
      mainMenu: false,
    },
    menuSearch: {
      enable: true,
      hotkeys: true,
    },
    notification: false,
    i18n: {
      enable: false,
      defaultLang: '',
    },
    fullscreen: false,
    pageReload: false,
    colorScheme: false,
    layout: ['favorites', 'breadcrumb', '->', 'menuSearch', 'notification', 'i18n', 'fullscreen', 'pageReload', 'colorScheme'],
  },
  page: {
    transitionMode: '',
    progress: true,
    iframeKeepAliveMax: 3,
    hotkeys: true,
  },
}

export default settingsDefault
