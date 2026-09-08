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
  ).flatMap(menu => menu.children?.map(child => child.path) ?? [])

  assert.deepEqual(visiblePaths([]), [])
  assert.deepEqual(visiblePaths(['sales-orders:read', 'purchase-orders:read']), [])
  assert.deepEqual(visiblePaths(['sales-orders:payment']), [])
  assert.deepEqual(visiblePaths(['sales-receipts:read']), ['/qs-finance/sales-receipts'])
  assert.deepEqual(visiblePaths(['purchase-orders:payment']), ['/qs-finance/purchase-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:review']), ['/qs-purchase/reviews'])
  assert.deepEqual(visiblePaths([
    'sales-receipts:read',
    'purchase-orders:payment',
    'purchase-orders:review',
  ]), ['/qs-finance/sales-receipts', '/qs-finance/purchase-payments', '/qs-purchase/reviews'])
})

test('三个入口使用独立路由名与平级菜单，并保留直接访问权限', () => {
  const routes = [...financeWorkbench.children, ...purchaseWorkbench.children]
  assert.equal(new Set(routes.map(route => route.name)).size, 3)
  for (const route of routes) {
    assert.equal(route.meta?.singleMenu, true)
    assert.equal(typeof route.component, 'function')
    assert.equal(typeof route.meta?.auth, 'string')
  }
})
