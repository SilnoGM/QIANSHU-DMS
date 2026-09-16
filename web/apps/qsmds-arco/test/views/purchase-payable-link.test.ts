import type { RouteRecordRaw } from 'vue-router'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证真实路由深链、剪贴板文本和既有登录权限导航。
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { financeWorkbench } from '../../src/router/modules/role.workbenches'
import { isAuthRouteAuthorized, resolveAuthRetryNavigation, resolveAuthSynchronizationNavigation } from '../../src/store/modules/app/auth-retry-navigation'
import { buildPurchasePayableLinkText } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

const id = '11111111-1111-4111-8111-111111111111'
const path = `/qs-finance/realtime-payments/purchase-payments/${id}`
function withoutViews(route: RouteRecordRaw): RouteRecordRaw {
  return { ...route, component: {}, children: route.children?.map(withoutViews) } as RouteRecordRaw
}

test('付款链接定位具体款项，隐藏菜单且要求采购付款权限', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: financeWorkbench.children.map(withoutViews) })
  const route = router.resolve({ name: 'qsFinanceRealtimePurchasePayablePayment', params: { id } })
  assert.equal(route.path, path)
  assert.equal(route.meta.menu, false)
  assert.equal(route.meta.auth, 'purchase-orders:payment')
  assert.equal(route.meta.whiteList, undefined)
  assert.equal(route.meta.activeMenu, '/qs-finance/realtime-payments/purchase-payments')
})

test('付款复制格式保留部署目录和 hash 路由，不带列表筛选或付款金额', () => {
  assert.equal(buildPurchasePayableLinkText('PO/20260916-00016', `/dms/#${path}`, 'https://dms.example/dms/#/old?keyword=x'), `【PO/20260916-00016付款】https://dms.example/dms/#${path}`)
  assert.equal(buildPurchasePayableLinkText('PO/1', path, 'http://localhost:9000/#/old'), `【PO/1付款】http://localhost:9000${path}`)
})

test('付款深链未登录先登录并保留目标，登录后回到同一款项', () => {
  assert.deepEqual(resolveAuthRetryNavigation('anonymous', path, '/'), { name: 'login', query: { redirect: path } })
  assert.equal(resolveAuthSynchronizationNavigation({ state: 'authenticated', currentFullPath: '/login', currentRouteName: 'login', loginRedirect: path, homeFullPath: '/' }), path)
  assert.equal(isAuthRouteAuthorized(['purchase-orders:payment'], []), false)
})

test('采购单付款链接与具体款项路由分开，均使用付款权限并隐藏菜单', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: financeWorkbench.children.map(withoutViews) })
  const route = router.resolve({ name: 'qsFinanceRealtimePurchaseOrderPayment', params: { id } })
  assert.equal(route.path, `/qs-finance/realtime-payments/purchase-payments/orders/${id}`)
  assert.equal(route.meta.menu, false)
  assert.equal(route.meta.auth, 'purchase-orders:payment')
  assert.equal(route.meta.whiteList, undefined)
})
