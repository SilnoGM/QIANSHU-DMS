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
const order = { orderNo: 'PO/20260916-00016', customerName: '客户甲', purchaseType: 'SALES_LINKED' as const }
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

test('付款复制包含客户、采购单号和所选待付金额，链接保留部署目录及 hash 且不携带金额', () => {
  assert.equal(buildPurchasePayableLinkText(order, payable, `/dms/#${path}`, 'https://dms.example/dms/#/old?keyword=x'), `我需要为【客户甲】的订单【PO/20260916-00016】付【定金】：80.50 元。\n\n付款链接：\nhttps://dms.example/dms/#${path}`)
  assert.equal(buildPurchasePayableLinkText(order, { ...payable, paymentType: 'BALANCE', remainingAmount: '0.5' }, path, 'http://localhost:9000/#/old'), `我需要为【客户甲】的订单【PO/20260916-00016】付【尾款】：0.50 元。\n\n付款链接：\nhttp://localhost:9000${path}`)
})

test('备货或缺少客户时使用明确文案，已结清及无效金额不生成付款信息', () => {
  assert.match(buildPurchasePayableLinkText({ ...order, customerName: null, purchaseType: 'STOCK' }, payable, path, 'https://dms.example'), /为【公司备货】/)
  assert.match(buildPurchasePayableLinkText({ ...order, customerName: ' ' }, payable, path, 'https://dms.example'), /为【未记录客户】/)
  for (const item of [
    { ...payable, status: 'PAID' as const },
    { ...payable, remainingAmount: '0.00' },
    { ...payable, remainingAmount: '-1.00' },
    { ...payable, remainingAmount: 'not-a-number' },
  ]) { assert.throws(() => buildPurchasePayableLinkText(order, item, path, 'https://dms.example'), /unavailable/) }
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
