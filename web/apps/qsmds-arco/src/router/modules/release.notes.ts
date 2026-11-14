import type { RouteRecordRaw } from 'vue-router'

/**
 * 版本更新日志对所有登录用户可见，只展示变更说明、不承载业务数据，
 * 因此不声明权限；它不进入侧边栏菜单，入口是侧边栏底部的版本号。
 */
const route: RouteRecordRaw = {
  path: 'release-notes',
  name: 'releaseNotes',
  component: () => import('@/views/release-notes/index.vue'),
  meta: {
    title: '版本更新日志',
    menu: false,
    breadcrumb: false,
  },
}

export default route
