import { setSettings } from '@fantastic-admin/settings'
import { APP_THEME_BASE_COLORS } from './settings.theme'

export default setSettings({
  app: {
    account: {
      auth: true,
    },
    feedback: true,
    errorLog: true,
    checkUpdates: true,
    // 用户管理已提供窄屏卡片与底部操作 Drawer，正式应用必须允许进入移动布局。
    mobile: true,
    copyright: {
      enable: false,
      dates: '2023-2026',
      company: 'Liaocheng Qianshu Culture Media Co., Ltd. All Rights Reserved.',
      website: 'https://qianshu.ltd/web//official/#/',
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
    baseColorLight: APP_THEME_BASE_COLORS.light,
    baseColorDark: APP_THEME_BASE_COLORS.dark,
    light: 'green',
    dark: 'green',
  },
  menu: {
    mode: 'head',
    style: 'line',
    mainMenuClickMode: 'smart',
    subMenuCollapseButton: true,
    hotkeys: false,
  },
  topbar: {
    mode: 'fixed',
  },
  tabbar: {
    hotkeys: false,
  },
  toolbar: {
    breadcrumb: {
      style: 'modern',
      mainMenu: true,
    },
    menuSearch: {
      enable: true,
      hotkeys: false,
    },
    notification: true,
    fullscreen: true,
    pageReload: true,
    layout: [
      'favorites',
      'breadcrumb',
      '->',
      'menuSearch',
      'i18n',
      'fullscreen',
      'notification',
      'colorScheme',
      'pageReload',
    ],
  },
  page: {
    transitionMode: 'fade',
    iframeKeepAliveMax: 9,
    hotkeys: false,
  },
})
