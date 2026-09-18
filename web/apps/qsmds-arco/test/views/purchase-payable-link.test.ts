import type { RouteRecordRaw } from 'vue-router'
import type { PurchasePayableDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证真实路由深链、剪贴板文本和既有登录权限导航。
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { financeWorkbench } from '../../src/router/modules/role.workbenches'
import { isAuthRouteAuthorized, resolveAuthRetryNavigation, resolveAuthSynchronizationNavigation } from '../../src/store/modules/app/auth-retry-navigation'
import { buildPurchasePayableLinkText } from '../../src/views/workbenches/purchase-payments/purchase-payments.logic'

const id = '11111111-1111-4111-8111-111111111111'
const path = `/qs-finance/realtime-payments/purchase-payments/${id}`
const order = { orderNo: 'PO/20260916-00016', supplier: { source: 'DICTIONARY' as const, value: 'SUPPLIER_1', label: '测试供应商', tone: null, known: true, effectiveEnabled: true } }
const payable = { id, paymentType: 'DEPOSIT', status: 'PENDING_PAYMENT', dueAmount: '100.00', remainingAmount: '80.50' } as PurchasePayableDto
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

test('批量付款独立路由优先于款项ID路由，登录及付款权限继续受控', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: financeWorkbench.children.map(withoutViews) })
  const route = router.resolve('/qs-finance/realtime-payments/purchase-payments/batch')
  assert.equal(route.name, 'qsFinanceRealtimePurchaseBatchPayment')
  assert.equal(route.meta.menu, false)
  assert.equal(route.meta.auth, 'purchase-orders:payment')
  assert.equal(route.meta.whiteList, undefined)
  assert.equal(route.meta.activeMenu, '/qs-finance/realtime-payments/purchase-payments')
  assert.deepEqual(resolveAuthRetryNavigation('anonymous', route.fullPath, '/'), { name: 'login', query: { redirect: route.fullPath } })
})

test('采购付款申请包含供应商、采购单号和所选待付金额，网址单独换行并保留部署目录及 hash', () => {
  assert.equal(buildPurchasePayableLinkText(order, payable, `/dms/#${path}`, 'https://dms.example/dms/#/old?keyword=x'), `【采购付款申请】\n\n采购订单：PO/20260916-00016\n供应商：测试供应商\n本次申请支付 [定金]：80.50 元。\n\n付款链接：\nhttps://dms.example/dms/#${path}`)
  assert.equal(buildPurchasePayableLinkText(order, { ...payable, paymentType: 'BALANCE', remainingAmount: '0.5' }, path, 'http://localhost:9000/#/old'), `【采购付款申请】\n\n采购订单：PO/20260916-00016\n供应商：测试供应商\n本次申请支付 [尾款]：0.50 元。\n\n付款链接：\nhttp://localhost:9000${path}`)
})

test('自定义供应商按实际名称展示，已结清及无效金额不生成付款信息', () => {
  assert.match(buildPurchasePayableLinkText({ ...order, supplier: { ...order.supplier, source: 'CUSTOM_TEXT', value: null, label: '自定义供应商' } }, payable, path, 'https://dms.example'), /供应商：自定义供应商\n/)
  for (const item of [
    { ...payable, status: 'PAID' as const },
    { ...payable, remainingAmount: '0.00' },
    { ...payable, remainingAmount: '-1.00' },
    { ...payable, remainingAmount: 'not-a-number' },
  ]) {
    assert.throws(() => buildPurchasePayableLinkText(order, item, path, 'https://dms.example'), /unavailable/)
  }
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
