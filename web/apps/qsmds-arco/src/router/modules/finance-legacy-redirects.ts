import type { RouteRecordRaw } from 'vue-router'

// 旧书签只负责转向新地址，访问权限仍由目标业务路由校验。
export const financeLegacyRedirects: RouteRecordRaw[] = [
  ['/admin/fund-accounts', '/qs-finance/fund-accounts/list'],
  ['/admin/fund-accounts/list', '/qs-finance/fund-accounts/list'],
  ['/admin/fund-accounts/transactions', '/qs-finance/fund-accounts/transactions'],
  ['/qs-finance/sales-receipts', '/qs-finance/realtime-payments/sales-receipts'],
  ['/qs-finance/purchase-payments', '/qs-finance/realtime-payments/purchase-payments'],
].map(([path, target]) => ({
  path,
  redirect: to => ({ path: target, query: to.query, hash: to.hash }),
}))
