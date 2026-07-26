import type { RouteRecordRaw } from 'vue-router'

interface ComponentLibraryEnvironment {
  DEV: boolean
  VITE_ENABLE_COMPONENT_LIBRARY?: boolean
}

function Layout() {
  return import('@/layouts/index.vue')
}

/**
 * 本地开发始终保留组件调试入口，避免真实 `.env` 成为开发前置条件。
 * 非开发构建必须显式传入公开布尔开关，确保生产默认不注册内部路由。
 */
export function shouldEnableComponentLibrary(environment: ComponentLibraryEnvironment): boolean {
  return environment.DEV || environment.VITE_ENABLE_COMPONENT_LIBRARY === true
}

/**
 * 基础组件与业务组件使用分类父路由，每个可验收组件拥有独立叶子路由。
 * 父路径显式重定向到首个组件，既兼容历史分类地址，也保证直接刷新有确定落点。
 * 页面模板尚未形成多个资产，继续使用 singleMenu 保持现有导航层级。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/component-library/basic',
    name: 'componentLibraryBasic',
    component: Layout,
    redirect: {
      name: 'componentLibraryAmountDisplay',
    },
    meta: {
      title: '基础组件',
      icon: 'i-lucide:shapes',
    },
    children: [
      {
        path: 'amount-display',
        name: 'componentLibraryAmountDisplay',
        component: () => import('@/views/component_library/basic/index.vue'),
        meta: {
          title: '金额显示',
          icon: 'i-lucide:badge-dollar-sign',
        },
      },
      {
        path: 'money-input',
        name: 'componentLibraryMoneyInput',
        component: () => import('@/views/component_library/basic/money-input.vue'),
        meta: {
          title: '金额输入',
          icon: 'i-lucide:hand-coins',
        },
      },
      {
        path: 'date-time-display',
        name: 'componentLibraryDateTimeDisplay',
        component: () => import('@/views/component_library/basic/date-time-display.vue'),
        meta: {
          title: '日期显示',
          icon: 'i-lucide:clock-3',
        },
      },
      {
        path: 'toast',
        name: 'componentLibraryQsToast',
        component: () => import('@/views/component_library/basic/toast.vue'),
        meta: {
          title: '轻提示',
          icon: 'i-lucide:message-circle-more',
        },
      },
    ],
  },
  {
    path: '/component-library/business',
    name: 'componentLibraryBusiness',
    component: Layout,
    redirect: {
      name: 'componentLibraryGenericTable',
    },
    meta: {
      title: '业务组件',
      icon: 'i-lucide:workflow',
    },
    children: [
      {
        path: 'generic-table',
        name: 'componentLibraryGenericTable',
        component: () => import('@/views/component_library/business/index.vue'),
        meta: {
          title: '通用表格',
          icon: 'i-lucide:table-2',
        },
      },
      {
        path: 'generic-drawer',
        name: 'componentLibraryGenericDrawer',
        component: () => import('@/views/component_library/business/generic-drawer.vue'),
        meta: {
          title: '通用抽屉',
          icon: 'i-lucide:panel-right-open',
        },
      },
      {
        path: 'generic-modal',
        name: 'componentLibraryGenericModal',
        component: () => import('@/views/component_library/business/generic-modal.vue'),
        meta: {
          title: '通用模态框',
          icon: 'i-lucide:panels-top-left',
        },
      },
    ],
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
