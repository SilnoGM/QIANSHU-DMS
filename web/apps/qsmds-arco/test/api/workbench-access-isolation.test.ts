import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 工作台准入契约使用 Node.js 内置 runner。
import test from 'node:test'
import { createRouterMatcher } from 'vue-router'

import { matchesAuthorization } from '../../src/composables/app/auth'
import ApplicationSettings from '../../src/router/modules/application.settings'
import operationsWorkbenchRoutes from '../../src/router/modules/operations.workbench'
import { financeWorkbench, purchaseTransportWorkbench } from '../../src/router/modules/role.workbenches'
import SystemAudit from '../../src/router/modules/system.audit'
import {
  FINANCE_WORKBENCH_PERMISSION,
  OPERATIONS_WORKBENCH_PERMISSION,
  PURCHASE_TRANSPORT_WORKBENCH_PERMISSION,
  SYSTEM_MANAGEMENT_PERMISSION,
} from '../../src/router/modules/workbench-access'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'
import { buildRegisteredRoutes } from '../../src/store/modules/app/route.logic'

const routesSource = readFileSync(
  new URL('../../src/router/routes.ts', import.meta.url),
  'utf8',
)
const workbenchesSource = readFileSync(
  new URL('../../src/router/modules/role.workbenches.ts', import.meta.url),
  'utf8',
)

/**
 * 与 routes.ts 的 asyncRoutes 同形：运营与系统管理分组在 routes.ts 内联装配，
 * 这里用同一份子路由数组与同一个准入常量复刻，并由「routes.ts 装配」用例锁住源码。
 */
const operationsWorkbench = {
  meta: {
    title: '千树运营工作台',
    auth: [OPERATIONS_WORKBENCH_PERMISSION],
  },
  children: [...operationsWorkbenchRoutes],
}
const systemManagement = {
  meta: {
    title: '系统管理',
    auth: [SYSTEM_MANAGEMENT_PERMISSION],
  },
  children: [SystemAudit, ApplicationSettings],
}

const routesRaw = [
  operationsWorkbench,
  financeWorkbench,
  purchaseTransportWorkbench,
  systemManagement,
]

const rolePermissions: Record<string, string[]> = {
  operations_staff: [
    'invoice-requests:cancel',
    'invoice-requests:create',
    'invoice-requests:read',
    'packaging-costs:create',
    'purchase-orders:create',
    'purchase-orders:document',
    'purchase-orders:payment',
    'purchase-orders:read',
    'purchase-orders:update',
    'sales-orders:create',
    'sales-orders:document',
    'sales-orders:payment',
    'sales-orders:read',
    'sales-orders:update',
    'sales-receipts:void',
    OPERATIONS_WORKBENCH_PERMISSION,
  ],
  finance_staff: [
    'fund-accounts:create',
    'fund-accounts:manual-adjust',
    'fund-accounts:read',
    'fund-accounts:update-share-rate',
    'fund-business-sources:manage',
    'fund-posting-types:manage',
    'fund-transactions:reverse',
    'invoice-requests:cancel',
    'invoice-requests:document',
    'invoice-requests:read',
    'invoice-requests:read-all',
    'invoice-requests:return',
    'invoice-requests:review',
    'invoice-requests:settle',
    'packaging-costs:pay',
    'packaging-costs:read',
    'purchase-orders:payment',
    'sales-receipts:read',
    'sales-receipts:review',
    'sales-receipts:void',
    'slh-bills:create',
    'slh-bills:read',
    'slh-bills:reconcile',
    FINANCE_WORKBENCH_PERMISSION,
  ],
  purchasing_staff: [
    'container-batches:create',
    'container-batches:read',
    'container-batches:update',
    'purchase-orders:read',
    'purchase-orders:review',
    'purchase-orders:update',
    'sales-orders:read',
    PURCHASE_TRANSPORT_WORKBENCH_PERMISSION,
  ],
}

function visibleMainRouteTitles(permissions: string[]) {
  return filterAccessibleMenus(
    routesRaw as Parameters<typeof filterAccessibleMenus>[0],
    value => matchesAuthorization(permissions, value),
    () => true,
  ).map(menu => menu.meta?.title)
}

const registeredMatcher = createRouterMatcher(
  buildRegisteredRoutes(routesRaw as Parameters<typeof buildRegisteredRoutes>[0]),
  {},
)
function canEnter(permissions: string[], path: string) {
  const matched = registeredMatcher.resolve({ path }, undefined!)?.matched ?? []
  assert.ok(matched.length > 0, `路由未注册：${path}`)
  return matched.every(record => matchesAuthorization(permissions, record.meta?.auth ?? ''))
}

test('三个角色只看到自己工作台的主导航，业务码本身不再放行其它工作台', () => {
  assert.deepEqual(visibleMainRouteTitles(rolePermissions.operations_staff), ['千树运营工作台'])
  assert.deepEqual(visibleMainRouteTitles(rolePermissions.finance_staff), ['workbench.finance'])
  assert.deepEqual(visibleMainRouteTitles(rolePermissions.purchasing_staff), ['workbench.purchaseTransport'])

  // 准入码是唯一的分组门槛：只有业务码（含跨工作台共享的采购付款/读取）不得看到任何工作台。
  assert.deepEqual(visibleMainRouteTitles(['purchase-orders:read', 'purchase-orders:payment', 'sales-receipts:void']), [])
  assert.deepEqual(visibleMainRouteTitles([]), [])
})

test('直接 URL 准入与菜单一致：跨工作台路径全部被拦截，自己工作台（含隐藏页）可进入', () => {
  const operationsStaff = rolePermissions.operations_staff
  const financeStaff = rolePermissions.finance_staff
  const purchasingStaff = rolePermissions.purchasing_staff

  for (const path of [
    '/qs-finance/realtime-payments/purchase-payments',
    '/qs-finance/realtime-payments/purchase-payments/batch',
    '/qs-finance/bill-reconciliation/slh-bill-management',
    '/qs-finance/fund-accounts/list',
    '/qs-purchase-transport/reviews',
    '/qs-purchase-transport/containers',
    '/qs-purchase-transport/containers/container-1/import',
    '/qs-finance/invoices/approval',
    '/system/audit',
    '/system/application-settings',
  ]) {
    assert.equal(canEnter(operationsStaff, path), false, `运营角色不应进入 ${path}`)
  }
  for (const path of [
    '/qs-operations/sales/pending-sales-orders',
    '/qs-operations/sales/sales-orders/create',
    '/qs-operations/purchase/purchase-orders/create',
    '/qs-operations/warehouse-transport/ocean-containers',
    '/qs-operations/warehouse-transport/overseas-storage',
    '/qs-operations/invoices/create',
    '/qs-operations/invoices/records',
  ]) {
    assert.equal(canEnter(operationsStaff, path), true, `运营角色应能进入 ${path}`)
  }

  for (const path of [
    '/qs-operations/sales/pending-sales-orders',
    '/qs-operations/sales/sales-orders/create',
    '/qs-operations/purchase/purchase-orders',
    '/qs-operations/warehouse-transport/ocean-containers',
    '/qs-operations/invoices/create',
    '/qs-operations/invoices/records',
    '/qs-purchase-transport/containers',
    '/system/audit',
    '/system/application-settings',
  ]) {
    assert.equal(canEnter(financeStaff, path), false, `财务角色不应进入 ${path}`)
  }
  for (const path of [
    '/qs-finance/realtime-payments/sales-receipts',
    '/qs-finance/realtime-payments/purchase-payments/batch',
    '/qs-finance/bill-reconciliation/slh-bill-management/import',
    '/qs-finance/fund-accounts/transactions',
    '/qs-finance/invoices/approval',
    '/qs-finance/invoices/approval/9f1e0b6c-1111-4222-8333-444444444444',
  ]) {
    assert.equal(canEnter(financeStaff, path), true, `财务角色应能进入 ${path}`)
  }

  for (const path of [
    '/qs-operations/sales/pending-sales-orders',
    '/qs-operations/purchase/purchase-orders',
    '/qs-operations/warehouse-transport/warehouse-arrivals',
    '/qs-operations/warehouse-transport/ocean-containers',
    '/qs-operations/invoices/create',
    '/qs-operations/invoices/records',
    '/qs-finance/realtime-payments/purchase-payments',
    '/qs-finance/invoices/approval',
    '/system/audit',
    '/system/application-settings',
  ]) {
    assert.equal(canEnter(purchasingStaff, path), false, `采运角色不应进入 ${path}`)
  }
  for (const path of [
    '/qs-purchase-transport/reviews',
    '/qs-purchase-transport/shipments',
    '/qs-purchase-transport/containers',
    '/qs-purchase-transport/containers/container-1',
    '/qs-purchase-transport/containers/container-1/import',
  ]) {
    assert.equal(canEnter(purchasingStaff, path), true, `采运角色应能进入 ${path}`)
  }
})

test('系统管理只对管理员权限（audit:read，系统专用）开放', () => {
  assert.equal(matchesAuthorization(rolePermissions.operations_staff, SYSTEM_MANAGEMENT_PERMISSION), false)
  assert.equal(matchesAuthorization(rolePermissions.finance_staff, SYSTEM_MANAGEMENT_PERMISSION), false)
  assert.equal(matchesAuthorization(rolePermissions.purchasing_staff, SYSTEM_MANAGEMENT_PERMISSION), false)

  const adminPermissions = ['users:read', 'roles:read', 'audit:read']
  assert.deepEqual(
    filterAccessibleMenus(
      [systemManagement] as unknown as Parameters<typeof filterAccessibleMenus>[0],
      value => matchesAuthorization(adminPermissions, value),
      () => true,
    ).map(menu => menu.meta?.title),
    ['系统管理'],
  )
  assert.equal(canEnter(adminPermissions, '/system/audit'), true)
  assert.equal(canEnter(adminPermissions, '/system/application-settings'), true)
  assert.equal(canEnter([], '/system/application-settings'), false)
})

test('routes.ts 与 role.workbenches.ts 按准入常量装配分组门槛', () => {
  assert.match(routesSource, /from '\.\/modules\/workbench-access'/u)
  assert.match(
    routesSource,
    /title: '千树运营工作台'[\s\S]{0,200}?auth: \[OPERATIONS_WORKBENCH_PERMISSION\]/u,
  )
  assert.match(
    routesSource,
    /title: '系统管理'[\s\S]{0,200}?auth: \[SYSTEM_MANAGEMENT_PERMISSION\]/u,
  )
  assert.match(
    routesSource,
    /title: '管理员工作台'[\s\S]{0,200}?auth: \[\.\.\.ADMIN_WORKBENCH_PERMISSIONS\]/u,
  )
  assert.match(
    workbenchesSource,
    /auth: \[FINANCE_WORKBENCH_PERMISSION\]/u,
  )
  assert.match(
    workbenchesSource,
    /auth: \[PURCHASE_TRANSPORT_WORKBENCH_PERMISSION\]/u,
  )
})
