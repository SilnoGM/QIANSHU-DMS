import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { cloneDeep } from 'es-toolkit'

/**
 * 生成实际注册路由：把主导航组的 `meta.auth` 覆盖到组内一级子路由。
 *
 * 覆盖优先于一级子路由自身声明（`item.meta?.auth ?? child.meta?.auth`），因此分组
 * 门槛是一级子路由的唯一准入依据——工作台准入码能同时约束菜单过滤与直接 URL 访问
 * 就靠这条规则；组内页面自身的精细权限继续由更深层叶子与页面内 `auth()` 承担。
 *
 * 与菜单过滤的差别：菜单树直接使用 `routesRaw`，一级子路由保留自己声明的 any-of
 * 集合；两层最终可见的叶子集合一致，因为叶子仍逐条校验自身权限。
 */
export function buildRegisteredRoutes(routesRaw: RouteRecordMainRaw[]): RouteRecordRaw[] {
  const returnRoutes: RouteRecordRaw[] = []
  routesRaw.forEach((item) => {
    const tmpRoutes = cloneDeep(item.children) as RouteRecordRaw[]
    tmpRoutes.forEach((child) => {
      if (!child.meta) {
        child.meta = {}
      }
      child.meta.auth = item.meta?.auth ?? child.meta?.auth
    })
    returnRoutes.push(...tmpRoutes)
  })
  returnRoutes.forEach((item) => {
    if (item.children) {
      item.children = deleteMiddleRouteComponent(item.children)
    }
  })
  return returnRoutes
}

// 删除路由中间层级对应的组件
export function deleteMiddleRouteComponent(routes: RouteRecordRaw[]): RouteRecordRaw[] {
  const res: RouteRecordRaw[] = []
  routes.forEach((route) => {
    if (route.children?.length) {
      delete route.component
      route.children = deleteMiddleRouteComponent(route.children)
    }
    else {
      delete route.children
    }
    res.push(route)
  })
  return res
}
