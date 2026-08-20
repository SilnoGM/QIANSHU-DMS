import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与占位页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import operationsWorkbenchRoutes from '../../src/router/modules/operations.workbench'

test('千树运营工作台注册两个可见订单入口和两个隐藏新增入口', () => {
  assert.deepEqual(
    operationsWorkbenchRoutes.map(route => ({
      activeMenu: route.meta?.activeMenu,
      menu: route.meta?.menu,
      name: route.name,
      path: route.path,
      singleMenu: route.meta?.singleMenu,
      title: route.meta?.title,
    })),
    [
      {
        activeMenu: undefined,
        menu: undefined,
        name: 'operationsSalesOrders',
        path: '/operations/sales-orders',
        singleMenu: true,
        title: '销售订单',
      },
      {
        activeMenu: undefined,
        menu: undefined,
        name: 'operationsPurchaseOrders',
        path: '/operations/purchase-orders',
        singleMenu: true,
        title: '采购订单',
      },
      {
        activeMenu: '/operations/sales-orders',
        menu: false,
        name: 'operationsSalesOrderCreate',
        path: '/operations/sales-orders/create',
        singleMenu: true,
        title: '新增销售订单',
      },
      {
        activeMenu: '/operations/purchase-orders',
        menu: false,
        name: 'operationsPurchaseOrderCreate',
        path: '/operations/purchase-orders/create',
        singleMenu: true,
        title: '新增采购订单',
      },
    ],
  )
  assert.ok(operationsWorkbenchRoutes.every(
    route => typeof route.component === 'function',
  ))
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
