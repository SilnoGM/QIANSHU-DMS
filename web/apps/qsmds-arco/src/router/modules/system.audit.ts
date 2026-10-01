import type { RouteRecordRaw } from 'vue-router'

/**
 * 审计日志上移为系统管理的直接子项，保留原路径与路由名，旧书签无需重定向。
 *
 * singleMenu 与「应用配置」同款：单页菜单直接落在侧边栏一层，面包屑仍显示
 * 「系统管理 / 审计日志」，不出现单条目的折叠分组。
 */
const route: RouteRecordRaw = {
  path: '/system/audit',
  name: 'systemAudit',
  component: () => import('@/views/system/audit/index.vue'),
  meta: {
    title: '审计日志',
    icon: 'qs-audit-log',
    auth: 'audit:read',
    singleMenu: true,
  },
}

export default route
