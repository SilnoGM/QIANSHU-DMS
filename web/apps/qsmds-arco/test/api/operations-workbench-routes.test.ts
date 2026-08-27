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

test('采购订单继续保留原有列表与隐藏新增入口', () => {
  const purchaseRoutes = operationsWorkbenchRoutes.filter(
    route => route.name === 'operationsPurchaseOrders'
      || route.name === 'operationsPurchaseOrderCreate',
  )

  assert.deepEqual(purchaseRoutes.map(route => ({
    activeMenu: route.meta?.activeMenu,
    menu: route.meta?.menu,
    name: route.name,
    path: route.path,
    singleMenu: route.meta?.singleMenu,
    title: route.meta?.title,
  })), [
    {
      activeMenu: undefined,
      menu: undefined,
      name: 'operationsPurchaseOrders',
      path: '/operations/purchase-orders',
      singleMenu: true,
      title: '采购订单',
    },
    {
      activeMenu: '/operations/purchase-orders',
      menu: false,
      name: 'operationsPurchaseOrderCreate',
      path: '/operations/purchase-orders/create',
      singleMenu: true,
      title: '新增采购订单',
    },
  ])
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

test('采购订单列表继续保持单一新增按钮的空白产品边界', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/<FaButton(?:\s|>)/gu)?.length, 1)
  assert.equal(source.match(/<\/FaButton>/gu)?.length, 1)
  assert.match(source, />\s*新增采购订单\s*<\/FaButton>/u)
  assert.match(
    source,
    /router\.push\(\{ name: 'operationsPurchaseOrderCreate' \}\)/u,
  )
  assert.doesNotMatch(source, /<Fa(?:Alert|Card|Empty|Icon|PageHeader)/u)
})

test('采购订单新增页继续保持单一返回按钮的空白产品边界', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/purchase-orders/create.vue', import.meta.url),
    'utf8',
  )

  assert.equal(source.match(/<FaButton(?:\s|>)/gu)?.length, 1)
  assert.equal(source.match(/<\/FaButton>/gu)?.length, 1)
  assert.match(source, /<FaButton\s+variant="outline"\s+@click="navigateBack">/u)
  assert.match(source, />\s*返回\s*<\/FaButton>/u)
  assert.match(
    source,
    /router\.push\(\{ name: 'operationsPurchaseOrders' \}\)/u,
  )
  assert.doesNotMatch(source, /<Fa(?:Alert|Card|Empty|Icon|PageHeader)/u)
})
