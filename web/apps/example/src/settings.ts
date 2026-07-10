import { setSettings } from '@fantastic-admin/settings'

export default setSettings({
  app: {
    account: {
      auth: true,
      multipleAccounts: true,
    },
    dynamicTitle: true,
    feedback: true,
    lockScreen: true,
    errorLog: true,
    checkUpdates: true,
    copyright: {
      enable: true,
      dates: '2020-present',
      company: 'Fantastic-admin',
      website: 'https://fantastic-admin.hurui.me',
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
  menu: {
    style: 'dot',
    mainMenuClickMode: 'smart',
    subMenuCollapseButton: true,
    hotkeys: true,
  },
  topbar: {
    tabbar: true,
    toolbar: true,
    mode: 'fixed',
  },
  tabbar: {
    style: 'fashion',
    icon: true,
    memory: true,
    hotkeys: true,
  },
  toolbar: {
    favorites: true,
    breadcrumb: {
      style: 'modern',
      mainMenu: true,
    },
    notification: true,
    i18n: {
      enable: true,
    },
    fullscreen: true,
    pageReload: true,
    colorScheme: true,
  },
  page: {
    hotkeys: true,
    iframeKeepAliveMax: 9,
    transitionMode: 'slide-right',
  },
})
