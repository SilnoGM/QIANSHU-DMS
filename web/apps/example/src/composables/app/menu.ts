export function useAppMenu() {
  const router = useRouter()
  const { t, te } = useI18n({ useScope: 'global' })

  const appSettingsStore = useAppSettingsStore()
  const appMenuStore = useAppMenuStore()

  function generateI18nTitle(titleOrKey: string | (() => any) = t('app.route.undefined')) {
    return typeof titleOrKey === 'function'
      ? titleOrKey()
      : te(titleOrKey)
        ? t(titleOrKey)
        : titleOrKey
  }

  function switchTo(index: number) {
    appMenuStore.setActived(index)
    if (
      appSettingsStore.settings.menu.mainMenuClickMode === 'jump'
      || (appSettingsStore.settings.menu.mainMenuClickMode === 'smart' && appMenuStore.sidebarMenusHasOnlyMenu)
    ) {
      router.push(appMenuStore.sidebarMenusFirstDeepestPath)
    }
  }

  return {
    generateI18nTitle,
    switchTo,
  }
}
