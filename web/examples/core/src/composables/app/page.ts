export function useAppPage() {
  const route = useRoute()
  const router = useRouter()

  const appSettingsStore = useAppSettingsStore()
  const appTabbarStore = useAppTabbarStore()

  const tabbar = useAppTabbar()

  function reload() {
    appSettingsStore.setIsReloading(true)
    router.push({
      name: 'reload',
    }).then(() => {
      setTimeout(() => {
        appSettingsStore.setIsReloading(false)
      }, 100)
    })
  }

  function setCustomTitle(title: string) {
    appSettingsStore.setCustomTitle(route.fullPath, title)
    if (appSettingsStore.settings.topbar.tabbar) {
      appTabbarStore.setCustomTitle({
        tabId: tabbar.getId(),
        title,
      })
    }
  }

  function resetCustomTitle() {
    appSettingsStore.resetCustomTitle(route.fullPath)
    if (appSettingsStore.settings.topbar.tabbar) {
      appTabbarStore.resetCustomTitle(tabbar.getId())
    }
  }

  function maximize(status: boolean) {
    appSettingsStore.setMainPageMaximize(status)
  }

  return {
    reload,
    setCustomTitle,
    resetCustomTitle,
    maximize,
  }
}
