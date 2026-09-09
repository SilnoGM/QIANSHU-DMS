import type { RouteRecordRaw } from 'vue-router'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 用真实路由解析验证旧地址重定向及参数保留。
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { financeLegacyRedirects } from '../../src/router/modules/finance-legacy-redirects'
import { financeWorkbench } from '../../src/router/modules/role.workbenches'

function withoutViews(route: RouteRecordRaw): RouteRecordRaw {
  return { ...route, component: {}, children: route.children?.map(withoutViews) } as RouteRecordRaw
}

test('旧资金和收付地址转向新路由并保留查询与锚点', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [...financeLegacyRedirects, ...financeWorkbench.children.map(withoutViews)] })
  for (const [oldPath, name] of [
    ['/admin/fund-accounts', 'qsFinanceFundAccountList'],
    ['/admin/fund-accounts/list', 'qsFinanceFundAccountList'],
    ['/admin/fund-accounts/transactions', 'qsFinanceFundAccountTransactions'],
    ['/qs-finance/sales-receipts', 'qsFinanceRealtimeSalesReceipts'],
    ['/qs-finance/purchase-payments', 'qsFinanceRealtimePurchasePayments'],
  ]) {
    await router.push(`${oldPath}?accountId=account-123#record`)
    assert.equal(router.currentRoute.value.name, name)
    assert.equal(router.currentRoute.value.query.accountId, 'account-123')
    assert.equal(router.currentRoute.value.hash, '#record')
    assert.equal(router.currentRoute.value.matched.length, 2)
    assert.ok(router.currentRoute.value.meta.auth)
  }
  assert.equal(router.hasRoute('adminFundAccountList'), false)
  assert.equal(router.hasRoute('adminFundAccountTransactions'), false)
})
