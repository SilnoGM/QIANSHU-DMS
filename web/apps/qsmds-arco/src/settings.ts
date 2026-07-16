import { setSettings } from '@fantastic-admin/settings'

export default setSettings({
  app: {
    account: {
      auth: true,
    },
    feedback: true,
    lockScreen: true,
    errorLog: true,
    checkUpdates: true,
    mobile: false,
    copyright: {
      enable: true,
      dates: '2023-2026',
      company: 'Liaocheng Qianshu Culture Media Co., Ltd. All Rights Reserved.',
      website: 'https://qianshu.ltd/web//official/#/',
    },
    preferences: {
      theme: true,
      menu: true,
      topbar: true,
      tabbar: true,
      toolbar: true,
      page: true,
    },
  },
  theme: {
    baseColorLight: 'zinc',
    baseColorDark: 'zinc',
  },
  menu: {
    mode: 'head',
    style: 'line',
    mainMenuClickMode: 'smart',
    subMenuCollapseButton: true,
  },
  topbar: {
    mode: 'fixed',
  },
  toolbar: {
    breadcrumb: {
      style: 'modern',
      mainMenu: true,
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
    transitionMode: 'slide-right',
    iframeKeepAliveMax: 9,
    hotkeys: false,
  },
})
