import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 路由与空白页面契约使用 Node.js 内置 runner。
import test from 'node:test'

import fundAccountManagementRoutes from '../../src/router/modules/fund-account.management'

test('管理员工作台注册账户管理分组及两个资金账户入口', () => {
  assert.equal(fundAccountManagementRoutes.path, '/admin/fund-accounts')
  assert.equal(fundAccountManagementRoutes.name, 'adminFundAccountManagement')
  assert.equal(fundAccountManagementRoutes.meta?.title, '账户管理')
  assert.equal(fundAccountManagementRoutes.meta?.icon, 'i-lucide:wallet-cards')
  assert.deepEqual(
    fundAccountManagementRoutes.children?.map(route => ({
      name: route.name,
      path: route.path,
      title: route.meta?.title,
    })),
    [
      {
        name: 'adminFundAccountList',
        path: 'list',
        title: '资金账户列表',
      },
      {
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
    /import FundAccountManagement from '\.\/modules\/fund-account\.management'/u,
  )
  assert.match(
    administratorWorkbenchSource,
    /children: \[[\s\S]*?ProductManagement,[\s\S]*?FundAccountManagement,[\s\S]*?\]/u,
  )
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
