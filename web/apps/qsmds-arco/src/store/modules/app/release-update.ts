/**
 * 版本更新提醒。
 *
 * release.json 的轮询与更新弹窗都在 AppCheckUpdates 内，本 Store 只保存「远端存在更高版本」
 * 这一结论：弹窗被“稍后提醒”关闭后，侧边栏版本入口仍要能提示还有新版本。
 * 不做持久化——刷新后运行的就是新 bundle，版本会重新比较，旧标记不应残留。
 */
export const useAppReleaseUpdateStore = defineStore('appReleaseUpdate', () => {
  const latestVersion = ref<string | null>(null)

  const hasUpdate = computed(() => latestVersion.value !== null)

  function setLatestVersion(version: string | null): void {
    latestVersion.value = version
  }

  return {
    hasUpdate,
    latestVersion,
    setLatestVersion,
  }
})
