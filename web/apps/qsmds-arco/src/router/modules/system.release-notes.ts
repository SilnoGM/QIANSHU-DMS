import type { RouteRecordRaw } from 'vue-router'

/**
 * 版本更新是纯展示页：数据由构建时的 `vite/development-map.ts` 从 Git 发版 Tag 生成，
 * 运行时不访问 Git。内容不敏感，与应用配置同款不设单独权限码。
 */
const route: RouteRecordRaw = {
  path: '/system/release-notes',
  name: 'systemReleaseNotes',
  component: () => import('@/views/system/release-notes/index.vue'),
  meta: {
    title: '版本更新',
    icon: 'qs-release-notes',
    singleMenu: true,
  },
}

export default route
