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
  ).flatMap(menu => menu.children?.flatMap(child => child.children?.map(leaf => `${child.path}/${leaf.path}`) ?? [child.path]) ?? [])

  assert.deepEqual(visiblePaths([]), [])
  assert.deepEqual(visiblePaths(['sales-orders:read', 'purchase-orders:read']), [])
  assert.deepEqual(visiblePaths(['sales-orders:payment']), [])
  assert.deepEqual(visiblePaths(['sales-receipts:read']), ['/qs-finance/realtime-payments/sales-receipts'])
  assert.deepEqual(visiblePaths(['purchase-orders:payment']), ['/qs-finance/realtime-payments/purchase-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:review']), ['/qs-purchase/reviews'])
  assert.deepEqual(visiblePaths([
    'sales-receipts:read',
    'purchase-orders:payment',
    'purchase-orders:review',
  ]), ['/qs-finance/realtime-payments/sales-receipts', '/qs-finance/realtime-payments/purchase-payments', '/qs-purchase/reviews'])
})

test('财务分为实时收付和账户管理，叶子路由保留独立权限', () => {
  assert.deepEqual(financeWorkbench.children.map(route => route.path), ['/qs-finance/realtime-payments', '/qs-finance/fund-accounts'])
  const routes = financeWorkbench.children.flatMap(route => route.children ?? [])
  assert.equal(new Set(routes.map(route => route.name)).size, 4)
  for (const route of routes) {
    assert.equal(typeof route.component, 'function')
    assert.equal(typeof route.meta?.auth, 'string')
    assert.notEqual(route.meta?.singleMenu, true)
  }
  const accountOnly = filterAccessibleMenus([financeWorkbench], value => matchesAuthorization(['fund-accounts:read'], value), () => true)
  assert.deepEqual(accountOnly[0]?.children?.map(route => route.path), ['/qs-finance/fund-accounts'])
})
