import type { RouteRecordRaw } from 'vue-router'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证工作台菜单按现有业务权限隔离。
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'

import { matchesAuthorization } from '../../src/composables/app/auth'
import { financeWorkbench, purchaseTransportWorkbench } from '../../src/router/modules/role.workbenches'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('财务和采运工作台只展示当前用户有权访问的业务入口', () => {
  const menus = [financeWorkbench, purchaseTransportWorkbench]
  const visiblePaths = (permissions: string[]) => filterAccessibleMenus(
    menus,
    value => matchesAuthorization(permissions, value),
    () => true,
  ).flatMap(menu => menu.children?.filter(child => child.meta?.menu !== false).flatMap(child => child.children?.filter(leaf => leaf.meta?.menu !== false).map(leaf => `${child.path}/${leaf.path}`) ?? [child.path]) ?? [])

  assert.deepEqual(visiblePaths([]), [])
  assert.deepEqual(visiblePaths(['sales-orders:read', 'purchase-orders:read']), ['/qs-purchase-transport/shipments', '/qs-purchase-transport/containers'])
  assert.deepEqual(visiblePaths(['sales-orders:payment']), [])
  assert.deepEqual(visiblePaths(['sales-receipts:read']), ['/qs-finance/realtime-payments/sales-receipts'])
  assert.deepEqual(visiblePaths(['packaging-costs:pay']), [])
  assert.deepEqual(visiblePaths(['packaging-costs:read']), ['/qs-finance/realtime-payments/packaging-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:payment']), ['/qs-finance/realtime-payments/purchase-payments', '/qs-finance/bill-reconciliation/shunlianhang-ocean-bills'])
  assert.deepEqual(visiblePaths(['purchase-orders:review']), ['/qs-purchase-transport/reviews'])
  assert.deepEqual(visiblePaths([
    'sales-receipts:read',
    'purchase-orders:payment',
    'purchase-orders:review',
  ]), ['/qs-finance/realtime-payments/sales-receipts', '/qs-finance/realtime-payments/purchase-payments', '/qs-finance/bill-reconciliation/shunlianhang-ocean-bills', '/qs-purchase-transport/reviews'])
})

test('采运工作台货件和柜次菜单复用采购读取权限，审核菜单继续独立授权', () => {
  const routes = purchaseTransportWorkbench.children
  assert.deepEqual(routes.filter(route => route.meta?.menu !== false).map(route => route.name), ['qsPurchaseTransportReviews', 'qsPurchaseTransportShipments', 'qsPurchaseTransportContainers'])
  assert.equal(purchaseTransportWorkbench.meta?.title, 'workbench.purchaseTransport')
  assert.equal(routes[1]?.meta?.auth, 'purchase-orders:read')
  assert.equal(routes[2]?.meta?.auth, 'purchase-orders:read')
  assert.equal(routes[2]?.meta?.title, 'workbench.containers')
  assert.equal(routes[2]?.meta?.icon, 'qs-container-management')
  assert.equal(typeof routes[2]?.component, 'function')
  assert.equal(routes[0]?.meta?.auth, 'purchase-orders:review')
})

test('财务分为实时收付、账单对账和账户管理，叶子路由保留独立权限', () => {
  assert.deepEqual(financeWorkbench.children.map(route => route.path), ['/qs-finance/realtime-payments', '/qs-finance/bill-reconciliation', '/qs-finance/fund-accounts'])
  const routes = financeWorkbench.children.flatMap(route => route.children ?? [])
  assert.equal(new Set(routes.map(route => route.name)).size, 11)
  const paymentDetail = routes.find(route => route.name === 'qsFinanceRealtimePurchasePayablePayment')
  assert.equal(paymentDetail?.meta?.menu, false)
  assert.equal(paymentDetail?.meta?.auth, 'purchase-orders:payment')
  const packagingPayment = routes.find(route => route.name === 'qsFinanceRealtimePackagingPayment')
  assert.equal(packagingPayment?.path, 'packaging-payments/:requestId/payment')
  assert.equal(packagingPayment?.meta?.menu, false)
  assert.equal(packagingPayment?.meta?.auth, 'packaging-costs:read')
  assert.equal(packagingPayment?.meta?.activeMenu, '/qs-finance/realtime-payments/packaging-payments')
  for (const route of routes) {
    assert.equal(typeof route.component, 'function')
    assert.equal(typeof route.meta?.auth, 'string')
    assert.notEqual(route.meta?.singleMenu, true)
  }
  const accountOnly = filterAccessibleMenus([financeWorkbench], value => matchesAuthorization(['fund-accounts:read'], value), () => true)
  assert.deepEqual(accountOnly[0]?.children?.map(route => route.path), ['/qs-finance/fund-accounts'])
})

test('柜次与顺联航账单详情可直接解析，隐藏菜单并保持对应列表高亮', async () => {
  const withoutViews = (route: RouteRecordRaw): RouteRecordRaw => ({
    ...route,
    component: {},
    children: route.children?.map(withoutViews),
  }) as RouteRecordRaw
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...purchaseTransportWorkbench.children, ...financeWorkbench.children].map(withoutViews),
  })
  for (const [path, name, title, activeMenu, permission] of [
    ['/qs-purchase-transport/containers/container-123', 'qsPurchaseTransportContainerDetail', 'workbench.containerDetail', '/qs-purchase-transport/containers', 'purchase-orders:read'],
    ['/qs-finance/bill-reconciliation/shunlianhang-ocean-bills/bill-123', 'qsFinanceShunlianhangOceanBillDetail', 'workbench.shunlianhangOceanBillDetail', '/qs-finance/bill-reconciliation/shunlianhang-ocean-bills', 'purchase-orders:payment'],
  ]) {
    await router.push(path)
    const route = router.currentRoute.value
    assert.equal(route.name, name)
    assert.equal(route.meta.title, title)
    assert.equal(route.meta.menu, false)
    assert.equal(route.meta.activeMenu, activeMenu)
    assert.equal(route.meta.auth, permission)
    assert.equal(route.params.id, path.split('/').at(-1))
    assert.equal(matchesAuthorization([], route.meta.auth!), false)
  }
  await router.push('/qs-finance/bill-reconciliation/shunlianhang-ocean-bills')
  assert.equal(router.currentRoute.value.name, 'qsFinanceShunlianhangOceanBills')
  assert.notEqual(router.currentRoute.value.meta.menu, false)
  assert.equal(router.currentRoute.value.matched[0]?.meta.title, 'workbench.billReconciliation')
})
