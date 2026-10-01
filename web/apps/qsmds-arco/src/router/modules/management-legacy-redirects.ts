import type { RouteRecordRaw } from 'vue-router'

// 旧书签只负责转向新地址，访问权限仍由目标业务路由校验。
export const managementLegacyRedirects: RouteRecordRaw[] = [
  // 原「权限体系」父路径与三个管理页面迁入管理员工作台-用户与角色。
  ['/system', '/admin/users'],
  ['/system/users', '/admin/users'],
  ['/system/roles', '/admin/roles'],
  ['/system/permissions', '/admin/permissions'],
  // 原「基础数据」整组迁入管理员工作台，父路径与全部叶子同步换前缀。
  ['/system/basic-data', '/admin/basic-data'],
  ['/system/basic-data/regions', '/admin/basic-data/regions'],
  ['/system/basic-data/currencies', '/admin/basic-data/currencies'],
  ['/system/basic-data/exchange-rates', '/admin/basic-data/exchange-rates'],
  ['/system/basic-data/numbering', '/admin/basic-data/numbering'],
  ['/system/basic-data/numbering/create', '/admin/basic-data/numbering/create'],
  ['/system/basic-data/numbering/shipping-mark-bindings', '/admin/basic-data/numbering/shipping-mark-bindings'],
  ['/system/basic-data/dictionaries', '/admin/basic-data/dictionaries'],
].map(([path, target]) => ({
  path,
  redirect: to => ({ path: target, query: to.query, hash: to.hash }),
}))
