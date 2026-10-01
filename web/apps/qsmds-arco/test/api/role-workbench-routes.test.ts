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
  assert.deepEqual(visiblePaths(['sales-orders:read', 'purchase-orders:read']), ['/qs-purchase-transport/shipments'])
  assert.deepEqual(visiblePaths(['container-batches:read']), ['/qs-purchase-transport/containers'])
  assert.deepEqual(visiblePaths(['sales-orders:payment']), [])
  assert.deepEqual(visiblePaths(['sales-receipts:read']), ['/qs-finance/realtime-payments/sales-receipts'])
  assert.deepEqual(visiblePaths(['packaging-costs:pay']), [])
  assert.deepEqual(visiblePaths(['packaging-costs:read']), ['/qs-finance/realtime-payments/packaging-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:payment']), ['/qs-finance/realtime-payments/purchase-payments'])
  assert.deepEqual(visiblePaths(['purchase-orders:review']), ['/qs-purchase-transport/reviews'])
  assert.deepEqual(visiblePaths(['slh-bills:read']), ['/qs-finance/bill-reconciliation/slh-bill-management'])
  assert.deepEqual(visiblePaths(['slh-bills:reconcile']), ['/qs-finance/bill-reconciliation/slh-bill-reconciliation'])
  assert.deepEqual(visiblePaths(['sales-receipts:read', 'purchase-orders:payment', 'purchase-orders:review']), ['/qs-finance/realtime-payments/sales-receipts', '/qs-finance/realtime-payments/purchase-payments', '/qs-purchase-transport/reviews'])
})

test('顺联航账单入口排在实收实付之后、账户管理之前，管理页与对账页各用独立权限', () => {
  const routes = financeWorkbench.children
  assert.deepEqual(routes.map(route => route.path), ['/qs-finance/realtime-payments', '/qs-finance/bill-reconciliation', '/qs-finance/fund-accounts'])
  const group = routes[1]!
  assert.equal(group.name, 'qsFinanceBillReconciliation')
  assert.equal(group.meta?.title, 'workbench.billReconciliation')
  assert.equal(group.meta?.icon, 'qs-bill-reconciliation')
  assert.deepEqual(group.meta?.auth, ['slh-bills:read', 'slh-bills:reconcile'])
  assert.equal(typeof group.component, 'function')
  const leaves = group.children ?? []
  assert.deepEqual(leaves.filter(leaf => leaf.meta?.menu !== false).map(leaf => [leaf.path, leaf.name, leaf.meta?.title, leaf.meta?.icon, leaf.meta?.auth]), [
    ['slh-bill-management', 'qsFinanceBillReconciliationSlhBillManagement', 'workbench.slhBillManagement', 'qs-bill-management', 'slh-bills:read'],
    ['slh-bill-reconciliation', 'qsFinanceBillReconciliationSlhBillReconciliation', 'workbench.slhBillReconciliation', 'qs-bill-reconciliation-check', 'slh-bills:reconcile'],
  ])
  for (const leaf of leaves) {
    // 对账仍沿用占位页；账单管理已替换为真实页面，两者都保持叶子形状。
    assert.equal(typeof leaf.component, 'function')
    assert.notEqual(leaf.meta?.singleMenu, true)
  }
  // 有 children 的路由会被 Route Store 的 deleteMiddleRouteComponent 删掉自身组件，
  // 因此导入与详情必须是同组隐藏兄弟路由，列表页不能再挂子路由。
  assert.ok(leaves.every(leaf => leaf.children === undefined))
  assert.deepEqual(leaves.filter(leaf => leaf.meta?.menu === false).map(leaf => [leaf.path, leaf.name, leaf.meta?.title, leaf.meta?.auth, leaf.meta?.activeMenu, leaf.meta?.breadcrumb]), [
    ['slh-bill-management/import', 'qsFinanceBillReconciliationSlhBillImport', 'slhBill.importTitle', 'slh-bills:create', '/qs-finance/bill-reconciliation/slh-bill-management', undefined],
    // 详情页与导入页一样保留面包屑末级（不设 breadcrumb: false），两页口径一致。
    ['slh-bill-management/:id', 'qsFinanceBillReconciliationSlhBillDetail', 'slhBill.detailTitle', 'slh-bills:read', '/qs-finance/bill-reconciliation/slh-bill-management', undefined],
    // 对账详情同上：面包屑显示「顺联航账单对账详情」，层级里不出现列表那一级。
    ['slh-bill-reconciliation/:id', 'qsFinanceBillReconciliationSlhReconciliationDetail', 'workbench.slhBillReconciliationDetail', 'slh-bills:reconcile', '/qs-finance/bill-reconciliation/slh-bill-reconciliation', undefined],
  ])
})

test('柜次菜单使用独立读取权限，货件与审核菜单保留既有授权', () => {
  const routes = purchaseTransportWorkbench.children
  assert.deepEqual(routes.filter(route => route.meta?.menu !== false).map(route => route.name), ['qsPurchaseTransportReviews', 'qsPurchaseTransportShipments', 'qsPurchaseTransportContainers'])
  assert.equal(purchaseTransportWorkbench.meta?.title, 'workbench.purchaseTransport')
  assert.equal(routes[1]?.meta?.auth, 'purchase-orders:read')
  assert.equal(routes[2]?.meta?.auth, 'container-batches:read')
  assert.equal(routes[2]?.meta?.title, 'workbench.containers')
  assert.equal(routes[2]?.meta?.icon, 'qs-container-management')
  assert.equal(typeof routes[2]?.component, 'function')
  assert.equal(routes[0]?.meta?.auth, 'purchase-orders:review')
})

test('财务分为实时收付、账单对账和账户管理，叶子路由保留独立权限', () => {
  assert.deepEqual(financeWorkbench.children.map(route => route.path), ['/qs-finance/realtime-payments', '/qs-finance/bill-reconciliation', '/qs-finance/fund-accounts'])
  const routes = financeWorkbench.children.flatMap(route => route.children ?? [])
  // 账单对账分组新增导入与详情两个隐藏叶子；顺联航对账分组新增对账详情一个隐藏叶子。
  assert.equal(new Set(routes.map(route => route.name)).size, 14)
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

test('柜次详情可直接解析，隐藏菜单并保持对应列表高亮', async () => {
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
    ['/qs-purchase-transport/containers/container-123/import', 'qsPurchaseTransportContainerImport', 'workbench.containerImport', '/qs-purchase-transport/containers', 'container-batches:update'],
    ['/qs-purchase-transport/containers/container-123', 'qsPurchaseTransportContainerDetail', 'workbench.containerDetail', '/qs-purchase-transport/containers', 'container-batches:read'],
  ]) {
    await router.push(path)
    const route = router.currentRoute.value
    assert.equal(route.name, name)
    assert.equal(route.meta.title, title)
    assert.equal(route.meta.menu, false)
    assert.equal(route.meta.activeMenu, activeMenu)
    assert.equal(route.meta.auth, permission)
    assert.equal(route.params.id, name === 'qsPurchaseTransportContainerImport' ? 'container-123' : path.split('/').at(-1))
    assert.equal(matchesAuthorization([], route.meta.auth!), false)
  }
})
