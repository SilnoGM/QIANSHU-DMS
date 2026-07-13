export function useAppLocaleAuth() {
  function auth(value: string | string[]) {
    const appSettingsStore = useAppSettingsStore()
    let auth
    if (typeof value === 'string') {
      auth = value !== '' ? appSettingsStore.lang === value : true
    }
    else {
      auth = value.length > 0 ? value.includes(appSettingsStore.lang) : true
    }
    return auth
  }

  return {
    auth,
  }
}
