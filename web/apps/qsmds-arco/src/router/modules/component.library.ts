import type { RouteRecordRaw } from 'vue-router'

interface ComponentLibraryEnvironment {
  DEV: boolean
  VITE_ENABLE_COMPONENT_LIBRARY?: boolean
}

/**
 * 本地开发始终保留组件调试入口，避免真实 `.env` 成为开发前置条件。
 * 非开发构建必须显式传入公开布尔开关，确保生产默认不注册内部路由。
 */
export function shouldEnableComponentLibrary(environment: ComponentLibraryEnvironment): boolean {
  return environment.DEV || environment.VITE_ENABLE_COMPONENT_LIBRARY === true
}

/**
 * 三个分类保持为次导航一级叶子路由，由 route Store 的 singleMenu 转换负责挂载正式 Layout。
 * 分类内部只有在真实组件数量增长后才增加子路由，避免首期建立空洞的多级结构。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/component-library/basic',
    name: 'componentLibraryBasic',
    component: () => import('@/views/component_library/basic/index.vue'),
    meta: {
      title: '基础组件',
      icon: 'i-lucide:shapes',
      singleMenu: true,
    },
  },
  {
    path: '/component-library/business',
    name: 'componentLibraryBusiness',
    component: () => import('@/views/component_library/business/index.vue'),
    meta: {
      title: '业务组件',
      icon: 'i-lucide:workflow',
      singleMenu: true,
    },
  },
  {
    path: '/component-library/page-templates',
    name: 'componentLibraryPageTemplates',
    component: () => import('@/views/component_library/page_templates/index.vue'),
    meta: {
      title: '页面模板',
      icon: 'i-lucide:panels-top-left',
      singleMenu: true,
    },
  },
]

export default routes
