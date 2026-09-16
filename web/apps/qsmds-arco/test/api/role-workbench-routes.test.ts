import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证工作台菜单按现有业务权限隔离。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import { financeWorkbench, purchaseWorkbench } from '../../src/router/modules/role.workbenches'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('财务和采购工作台只展示当前用户有权访问的业务入口', () => {
  const menus = [financeWorkbench, purchaseWorkbench]
  const visiblePaths = (permissions: string[]) => filterAccessibleMenus(
    menus,
    value => matchesAuthorization(permissions, value),
    () => true,
  ).flatMap(menu => menu.children?.flatMap(child => child.children?.filter(leaf => leaf.meta?.menu !== false).map(leaf => `${child.path}/${leaf.path}`) ?? [child.path]) ?? [])

  assert.deepEqual(visiblePaths([]), [])
  assert.deepEqual(visiblePaths(['sales-orders:read', 'purchase-orders:read']), ['/qs-purchase/shipments'])
  assert.deepEqual(visiblePaths(['sales-orders:payment']), [])
  assert.deepEqual(visiblePaths(['sales-receipts:read']), ['/qs-finance/realtime-payments/sales-receipts'])
  assert.deepEqual(visiblePaths(['packaging-costs:pay']), [])
  assert.deepEqual(visiblePaths(['packaging-costs:read']), ['/qs-finance/realtime-payments/packaging-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:payment']), ['/qs-finance/realtime-payments/purchase-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:review']), ['/qs-purchase/reviews'])
  assert.deepEqual(visiblePaths([
    'sales-receipts:read',
    'purchase-orders:payment',
    'purchase-orders:review',
  ]), ['/qs-finance/realtime-payments/sales-receipts', '/qs-finance/realtime-payments/purchase-payments', '/qs-purchase/reviews'])
})

test('采购货件菜单复用采购读取权限，审核菜单继续独立授权', () => {
  const routes = purchaseWorkbench.children
  assert.deepEqual(routes.map(route => route.name), ['qsPurchaseReviews', 'qsPurchaseShipments'])
  assert.equal(routes[1]?.meta?.auth, 'purchase-orders:read')
  assert.equal(routes[0]?.meta?.auth, 'purchase-orders:review')
})

test('财务分为实时收付和账户管理，叶子路由保留独立权限', () => {
  assert.deepEqual(financeWorkbench.children.map(route => route.path), ['/qs-finance/realtime-payments', '/qs-finance/fund-accounts'])
  const routes = financeWorkbench.children.flatMap(route => route.children ?? [])
  assert.equal(new Set(routes.map(route => route.name)).size, 6)
  const paymentDetail = routes.find(route => route.name === 'qsFinanceRealtimePurchasePayablePayment')
  assert.equal(paymentDetail?.meta?.menu, false)
  assert.equal(paymentDetail?.meta?.auth, 'purchase-orders:payment')
  for (const route of routes) {
    assert.equal(typeof route.component, 'function')
    assert.equal(typeof route.meta?.auth, 'string')
    assert.notEqual(route.meta?.singleMenu, true)
  }
  const accountOnly = filterAccessibleMenus([financeWorkbench], value => matchesAuthorization(['fund-accounts:read'], value), () => true)
  assert.deepEqual(accountOnly[0]?.children?.map(route => route.path), ['/qs-finance/fund-accounts'])
})
