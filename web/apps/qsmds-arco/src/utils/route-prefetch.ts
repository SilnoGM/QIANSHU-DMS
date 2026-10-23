import type { RouteLocationRaw, Router } from 'vue-router'

/**
 * 菜单悬停预取只负责触发路由组件自身的动态 import。
 *
 * Vue Router 的 `components.default` 在路由懒加载场景下就是 `() => import(...)`；
 * 调一次即进入浏览器模块缓存，点击时不再等待网络。失败时移除记录，允许下次重试；
 * 同一路径只预取一次，避免悬停抖动造成重复请求。
 */
const prefetchedTargets = new Set<string>()

export function prefetchRouteComponent(
  router: Router,
  target: RouteLocationRaw,
): void {
  let resolved
  try {
    resolved = router.resolve(target)
  }
  catch {
    return
  }

  const component = resolved.matched.at(-1)?.components?.default
  if (typeof component !== 'function') {
    return
  }

  const key = resolved.fullPath
  if (prefetchedTargets.has(key)) {
    return
  }
  prefetchedTargets.add(key)

  try {
    const result = (component as () => unknown)()
    if (result !== null && typeof (result as PromiseLike<unknown>)?.then === 'function') {
      void Promise.resolve(result as PromiseLike<unknown>)
        .catch(() => prefetchedTargets.delete(key))
    }
  }
  catch {
    prefetchedTargets.delete(key)
  }
}

/** 测试与身份切换时清空预取记录；不清空也不会影响正确性。 */
export function resetRoutePrefetchCache(): void {
  prefetchedTargets.clear()
}
