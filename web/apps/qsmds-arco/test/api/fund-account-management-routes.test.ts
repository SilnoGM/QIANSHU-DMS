import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与空白页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import { matchesAuthorization } from '../../src/composables/app/auth'
import fundAccountManagementRoutes, {
  FUND_ACCOUNT_MANAGEMENT_PERMISSIONS,
} from '../../src/router/modules/fund-account.management'
import { filterAccessibleMenus } from '../../src/store/modules/app/menu.logic'

test('管理员工作台注册账户管理分组及两个资金账户入口', () => {
  assert.deepEqual(FUND_ACCOUNT_MANAGEMENT_PERMISSIONS, ['fund-accounts:read'])
  assert.equal(fundAccountManagementRoutes.path, '/admin/fund-accounts')
  assert.equal(fundAccountManagementRoutes.name, 'adminFundAccountManagement')
  assert.equal(fundAccountManagementRoutes.meta?.title, '账户管理')
  assert.equal(fundAccountManagementRoutes.meta?.icon, 'i-lucide:wallet-cards')
  assert.deepEqual(
    fundAccountManagementRoutes.meta?.auth,
    ['fund-accounts:read'],
  )
  assert.deepEqual(
    fundAccountManagementRoutes.children?.map(route => ({
      auth: route.meta?.auth,
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        auth: 'fund-accounts:read',
        name: 'adminFundAccountList',
        path: 'list',
        title: '资金账户列表',
      },
      {
        auth: 'fund-accounts:read',
        name: 'adminFundAccountTransactions',
        path: 'transactions',
        title: '资金账户流水',
      },
    ],
  )
  assert.ok(
    fundAccountManagementRoutes.children?.every(
      route => typeof route.component === 'function',
    ),
  )
})

test('管理员工作台在产品管理后挂载账户管理', () => {
  const routesSource = readFileSync(
    new URL('../../src/router/routes.ts', import.meta.url),
    'utf8',
  )
  const administratorWorkbenchSource = routesSource.slice(
    routesSource.indexOf('title: \'管理员工作台\''),
    routesSource.indexOf('title: \'系统管理\''),
  )

  assert.match(
    routesSource,
    /import FundAccountManagement, \{[\s\S]*?FUND_ACCOUNT_MANAGEMENT_PERMISSIONS,[\s\S]*?\} from '\.\/modules\/fund-account\.management'/u,
  )
  const productPermissionIndex = administratorWorkbenchSource.indexOf(
    '...PRODUCT_MANAGEMENT_PERMISSIONS',
  )
  const fundAccountPermissionIndex = administratorWorkbenchSource.indexOf(
    '...FUND_ACCOUNT_MANAGEMENT_PERMISSIONS',
  )
  const productRouteIndex = administratorWorkbenchSource.indexOf(
    'ProductManagement,',
  )
  const fundAccountRouteIndex = administratorWorkbenchSource.indexOf(
    'FundAccountManagement,',
  )

  assert.ok(productPermissionIndex >= 0)
  assert.ok(fundAccountPermissionIndex > productPermissionIndex)
  assert.ok(productRouteIndex > fundAccountPermissionIndex)
  assert.ok(fundAccountRouteIndex > productRouteIndex)
})

test('资金账户专属权限精确控制分组、菜单和直接访问资格', () => {
  const menuFixture = [{
    path: fundAccountManagementRoutes.path,
    meta: {
      auth: fundAccountManagementRoutes.meta?.auth,
      title: fundAccountManagementRoutes.meta?.title,
    },
    children: (fundAccountManagementRoutes.children ?? []).map(route => ({
      path: route.path,
      meta: {
        auth: route.meta?.auth,
        title: route.meta?.title,
      },
    })),
  }]
  const visiblePaths = (permissions: string[]) => filterAccessibleMenus(
    menuFixture,
    value => matchesAuthorization(permissions, value),
    () => true,
  )[0]?.children?.map(menu => menu.path) ?? []

  assert.deepEqual(visiblePaths(['fund-accounts:read']), [
    'list',
    'transactions',
  ])
  assert.deepEqual(visiblePaths(['products:read']), [])
  assert.deepEqual(visiblePaths([]), [])
})

test('资金账户页面保持单一空白根节点', () => {
  for (const relativePath of [
    '../../src/views/admin/fund-account-management/list/index.vue',
    '../../src/views/admin/fund-account-management/transactions/index.vue',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const templateStart = source.indexOf('<template>')
    const templateEnd = source.indexOf('</template>', templateStart)

    assert.notEqual(templateStart, -1)
    assert.notEqual(templateEnd, -1)

    const template = source
      .slice(templateStart + '<template>'.length, templateEnd)
      .trim()
    assert.equal(template, '<div />')
  }
})
