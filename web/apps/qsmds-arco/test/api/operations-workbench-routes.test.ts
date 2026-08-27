import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与占位页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import operationsWorkbenchRoutes from '../../src/router/modules/operations.workbench'

test('销售订单迁移到销售业务分组，旧路由不再保留', () => {
  const salesRoute = operationsWorkbenchRoutes.find(
    route => route.name === 'qsOperationsSales',
  )
  const salesChildren = salesRoute?.children ?? []

  assert.equal(salesRoute?.path, '/qs-operations/sales')
  assert.equal(salesRoute?.meta?.title, '销售订单')
  assert.equal(typeof salesRoute?.component, 'function')
  assert.deepEqual(salesRoute?.redirect, { name: 'qsOperationsPendingSalesOrders' })
  assert.deepEqual(
    salesChildren.map(route => ({
      activeMenu: route.meta?.activeMenu,
      menu: route.meta?.menu,
      name: route.name,
      path: route.path,
      props: route.props,
      title: route.meta?.title,
    })),
    [
      {
        activeMenu: undefined,
        menu: undefined,
        name: 'qsOperationsPendingSalesOrders',
        path: 'pending-sales-orders',
        props: { viewMode: 'pending' },
        title: '待办订单',
      },
      {
        activeMenu: undefined,
        menu: undefined,
        name: 'qsOperationsSalesOrders',
        path: 'sales-orders',
        props: { viewMode: 'all' },
        title: '全部订单',
      },
      {
        activeMenu: '/qs-operations/sales/sales-orders',
        menu: false,
        name: 'operationsSalesOrderCreate',
        path: 'sales-orders/create',
        props: undefined,
        title: '新增销售订单',
      },
    ],
  )

  const allPaths = operationsWorkbenchRoutes.flatMap(route => [
    route.path,
    ...(route.children ?? []).map(child => child.path),
  ])
  assert.doesNotMatch(allPaths.join('\n'), /\/operations\/sales-orders/u)
})

test('采购订单迁移到采购业务分组，并按待办、全部顺序展示', () => {
  const purchaseRoute = operationsWorkbenchRoutes.find(
    route => route.name === 'qsOperationsPurchase',
  )
  const purchaseChildren = purchaseRoute?.children ?? []

  assert.equal(purchaseRoute?.path, '/qs-operations/purchase')
  assert.equal(purchaseRoute?.meta?.title, '采购订单')
  assert.equal(typeof purchaseRoute?.component, 'function')
  assert.deepEqual(purchaseRoute?.redirect, {
    name: 'qsOperationsPendingPurchaseOrders',
  })
  assert.deepEqual(
    purchaseChildren.map(route => ({
      menu: route.meta?.menu,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        menu: undefined,
        name: 'qsOperationsPendingPurchaseOrders',
        path: 'pending-purchase-orders',
        title: '待办采购',
      },
      {
        menu: undefined,
        name: 'qsOperationsPurchaseOrders',
        path: 'purchase-orders',
        title: '全部采购',
      },
    ],
  )

  const routeContract = JSON.stringify(operationsWorkbenchRoutes)
  assert.doesNotMatch(routeContract, /\/operations\/purchase-orders/u)
  assert.doesNotMatch(routeContract, /operationsPurchaseOrderCreate/u)
})

test('千树运营工作台是最左侧顶部导航', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )
  const asyncRoutesSource = routesSource.slice(
    routesSource.indexOf('const asyncRoutes'),
  )

  assert.match(
    asyncRoutesSource,
    /title: '千树运营工作台'[\s\S]*?children: \[[\s\S]*?\.\.\.OperationsWorkbenchRoutes/u,
  )
  assert.ok(
    asyncRoutesSource.indexOf('title: \'千树运营工作台\'')
    < asyncRoutesSource.indexOf('title: \'管理员工作台\''),
  )
})

test('全部采购页面只提供页头', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/<FaPageHeader(?:\s|>)/gu)?.length, 1)
  assert.match(source, /<FaPageHeader\s+title="全部采购"\s*\/>/u)
  assert.doesNotMatch(source, /<Fa(?:Alert|Button|Card|Empty|Icon|PageMain)/u)
  assert.doesNotMatch(source, /useRouter|useRoute|fetch\(|axios/u)
})

test('待办采购页面只提供页头', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/purchase-orders/pending.vue', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/<FaPageHeader(?:\s|>)/gu)?.length, 1)
  assert.match(source, /<FaPageHeader\s+title="待办采购"\s*\/>/u)
  assert.doesNotMatch(source, /<Fa(?:Alert|Button|Card|Empty|Icon|PageMain)/u)
  assert.doesNotMatch(source, /useRouter|useRoute|fetch\(|axios/u)
})
