import type { RouteRecordRaw } from 'vue-router'

interface ComponentLibraryEnvironment {
  DEV: boolean
  MODE?: string
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
 * 真实 Provider 验收入口只进入显式 test build，且始终从菜单隐藏。
 *
 * Showcase 必须继续使用本地 fixture；这个入口专门让隔离 Browser E2E 通过应用启动层
 * 注入的默认 Provider 访问真实 HTTP。production/development 构建均不注册它。
 */
export function createRegionSelectorBrowserE2eRoutes(
  environment: ComponentLibraryEnvironment,
): RouteRecordRaw[] {
  if (
    environment.MODE !== 'test'
    || environment.VITE_ENABLE_COMPONENT_LIBRARY !== true
  ) {
    return []
  }

  return [
    {
      path: '/__e2e/region-selector',
      name: 'regionSelectorBrowserE2e',
      component: Layout,
      meta: {
        title: '地区选择器浏览器验收',
        menu: false,
      },
      children: [
        {
          path: '',
          name: 'regionSelectorBrowserE2eIndex',
          component: () => import(
            '@/views/component_library/business/region-selector-browser-harness.vue'
          ),
          meta: {
            title: '地区选择器浏览器验收',
            menu: false,
          },
        },
      ],
    },
  ]
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
      {
        path: 'image-group',
        name: 'componentLibraryImageGroup',
        component: () => import('@/views/component_library/basic/image-group.vue'),
        meta: {
          title: '图片组',
          icon: 'i-lucide:images',
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
      {
        path: 'good-tooltip',
        name: 'componentLibraryQsGoodTooltip',
        component: () => import('@/views/component_library/business/good-tooltip.vue'),
        meta: {
          title: '产品提示',
          icon: 'i-lucide:package-search',
        },
      },
      {
        path: 'region-selector',
        name: 'componentLibraryQsRegionSelector',
        component: () => import('@/views/component_library/business/region-selector.vue'),
        meta: {
          title: '地区选择器',
          icon: 'i-lucide:map-pinned',
        },
      },
      {
        path: 'dictionary-select',
        name: 'componentLibraryQsDictionarySelect',
        component: () => import('@/views/component_library/business/dictionary-select.vue'),
        meta: {
          title: '字典选择器',
          icon: 'i-lucide:list-filter',
        },
      },
      {
        path: 'person-display',
        name: 'componentLibraryQsPersonDisplay',
        component: () => import('@/views/component_library/business/person-display.vue'),
        meta: {
          title: '人员显示',
          icon: 'i-lucide:user-round',
        },
      },
      {
        path: 'product-selector',
        name: 'componentLibraryQsProductSelector',
        component: () => import('@/views/component_library/business/product-selector.vue'),
        meta: {
          title: '产品选择器',
          icon: 'i-lucide:package-search',
        },
      },
      {
        path: 'order-product-line-editor',
        name: 'componentLibraryQsOrderProductLineEditor',
        component: () => import('@/views/component_library/business/order-product-line-editor.vue'),
        meta: {
          title: '订单产品明细编辑器',
          icon: 'i-lucide:table-properties',
        },
      },
      {
        path: 'sales-order-desc',
        name: 'componentLibraryQsSalesOrderDesc',
        component: () => import('@/views/component_library/business/sales-order-desc.vue'),
        meta: {
          title: '销售订单详情',
          icon: 'i-lucide:receipt-text',
        },
      },
      {
        path: 'status-switch-toolbar',
        name: 'componentLibraryQsStatusSwitchToolbar',
        component: () => import('@/views/component_library/business/status-switch-toolbar.vue'),
        meta: {
          title: '状态切换工具栏',
          icon: 'i-lucide:list-filter',
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
