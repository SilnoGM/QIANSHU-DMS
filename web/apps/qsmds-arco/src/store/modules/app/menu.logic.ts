import type { MenuRecordMainRaw, MenuRecordRaw } from '@fantastic-admin/types'
import { cloneDeep } from 'es-toolkit'

type MenuCollection = MenuRecordMainRaw[] | MenuRecordRaw[]
type AccessPredicate = (value: string | string[]) => boolean

/**
 * 按权限与语言条件递归过滤菜单。
 *
 * 该函数只负责纯数据转换，调用方仍从 Account Store 和设置 Store 提供真实判定。
 * 独立的纯函数边界让父子菜单过滤规则可以直接回归测试，避免测试复制生产递归逻辑。
 */
export function filterAccessibleMenus<T extends MenuCollection>(
  menus: T,
  auth: AccessPredicate,
  localeAuth: AccessPredicate,
): T {
  const result: Array<MenuRecordMainRaw | MenuRecordRaw> = []

  menus.forEach((menu) => {
    if (
      !auth(menu.meta?.auth ?? '')
      || !localeAuth(menu.meta?.localeAuth ?? '')
    ) {
      return
    }

    const accessibleMenu = cloneDeep(menu)
    if (accessibleMenu.children && accessibleMenu.children.length > 0) {
      accessibleMenu.children = filterAccessibleMenus(
        accessibleMenu.children,
        auth,
        localeAuth,
      )
      if (accessibleMenu.children.length > 0) {
        result.push(accessibleMenu)
      }
      return
    }

    delete accessibleMenu.children
    result.push(accessibleMenu)
  })

  return result as T
}
