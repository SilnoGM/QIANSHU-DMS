import type { Router } from 'vue-router'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 校验菜单悬停预取的缓存与失败重试语义。
import test from 'node:test'
import { prefetchRouteComponent, resetRoutePrefetchCache } from '../../src/utils/route-prefetch'

function fakeRouter(component: unknown, fullPath = '/target'): Router {
  return {
    resolve: () => ({
      fullPath,
      matched: [{ components: { default: component } }],
    }),
  } as unknown as Router
}

test('同一路径只触发一次路由组件加载', () => {
  resetRoutePrefetchCache()
  let calls = 0
  const loader = async () => {
    calls += 1
  }
  const router = fakeRouter(loader)

  prefetchRouteComponent(router, '/target')
  prefetchRouteComponent(router, '/target')

  assert.equal(calls, 1)
})

test('非函数组件和解析失败时不抛错', () => {
  resetRoutePrefetchCache()
  assert.doesNotThrow(() => prefetchRouteComponent(fakeRouter({ render: () => null }), '/target'))
  assert.doesNotThrow(() => prefetchRouteComponent({
    resolve: () => {
      throw new Error('resolve failed')
    },
  } as unknown as Router, '/target'))
})

test('加载失败后允许下次重试', async () => {
  resetRoutePrefetchCache()
  let calls = 0
  const loader = async () => {
    calls += 1
    throw new Error('chunk failed')
  }
  const router = fakeRouter(loader)

  prefetchRouteComponent(router, '/target')
  await new Promise(resolve => setImmediate(resolve))
  prefetchRouteComponent(router, '/target')

  assert.equal(calls, 2)
})
