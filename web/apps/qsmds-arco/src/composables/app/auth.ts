export function matchesAuthorization(
  permissions: readonly string[],
  value: string | string[],
): boolean {
  if (typeof value === 'string') {
    return value === '' || permissions.includes(value)
  }
  return value.length === 0 || value.some(item => permissions.includes(item))
}

export function matchesAllPermissions(
  permissions: readonly string[],
  value: string[],
): boolean {
  return value.length === 0 || value.every(item => permissions.includes(item))
}

export function useAppAuth() {
  const appAccountStore = useAppAccountStore()

  function auth(value: string | string[]) {
    // 权限只能来自本次 /auth/me 的服务端快照，历史偏好设置不得绕过菜单或按钮鉴权。
    return matchesAuthorization(appAccountStore.permissions, value)
  }

  function authAll(value: string[]) {
    return matchesAllPermissions(appAccountStore.permissions, value)
  }

  return {
    auth,
    authAll,
  }
}
