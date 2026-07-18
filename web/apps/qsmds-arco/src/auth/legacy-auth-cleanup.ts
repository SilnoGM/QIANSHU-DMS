interface RemovableStorage {
  removeItem: (key: string) => void
}

interface LegacyStorageScope {
  readonly localStorage: RemovableStorage
  readonly sessionStorage: RemovableStorage
}

/**
 * 只维护已确认的旧认证键清单；主题、语言等非身份偏好不得被顺带清除。
 * 版本升级若新增旧键，必须显式添加到下一版清单并补测试。
 */
const LEGACY_AUTH_KEYS_V1 = [
  'token',
  'account',
  'avatar',
  'login_account',
  'appAccount',
] as const

const LEGACY_AUTH_PREFIXES_V1 = [
  '',
  'qsdms_dev',
  'qsdms_pro',
  'qianshu-dms',
  'fa_test_',
] as const

export function removeLegacyAuthStorage(
  storage: RemovableStorage,
): void {
  const keys = new Set<string>()
  for (const prefix of LEGACY_AUTH_PREFIXES_V1) {
    for (const key of LEGACY_AUTH_KEYS_V1) {
      keys.add(`${prefix}${key}`)
    }
  }

  for (const key of keys) {
    try {
      storage.removeItem(key)
    }
    catch {
      // Safari 隐私模式或宿主策略可能拒绝某个操作；迁移必须继续 best effort。
    }
  }
}

export function cleanupLegacyAuthStorageBeforeApp(
  scope: LegacyStorageScope = window,
): void {
  for (const storageName of ['localStorage', 'sessionStorage'] as const) {
    try {
      // 某些隐私模式会在读取 Storage getter 时直接抛错，不能因此阻断真实 /me 启动恢复。
      removeLegacyAuthStorage(scope[storageName])
    }
    catch {
      // legacy purge 是 best effort；失败时旧 Token 仍不会被 Server 或 Account Store 接受。
    }
  }
}
