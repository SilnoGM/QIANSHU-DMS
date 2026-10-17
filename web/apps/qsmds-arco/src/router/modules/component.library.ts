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
      icon: 'qs-basic-components',
    },
    children: [
      {
        path: 'amount-display',
        name: 'componentLibraryAmountDisplay',
        component: () => import('@/views/component_library/basic/index.vue'),
        meta: {
          title: '金额显示',
          icon: 'qs-money-display',
        },
      },
      {
        path: 'money-input',
        name: 'componentLibraryMoneyInput',
        component: () => import('@/views/component_library/basic/money-input.vue'),
        meta: {
          title: '金额输入',
          icon: 'qs-money-input',
        },
      },
      {
        path: 'date-time-display',
        name: 'componentLibraryDateTimeDisplay',
        component: () => import('@/views/component_library/basic/date-time-display.vue'),
        meta: {
          title: '日期显示',
          icon: 'qs-date-time',
        },
      },
      {
        path: 'toast',
        name: 'componentLibraryQsToast',
        component: () => import('@/views/component_library/basic/toast.vue'),
        meta: {
          title: '轻提示',
          icon: 'qs-toast',
        },
      },
      {
        path: 'image-group',
        name: 'componentLibraryImageGroup',
        component: () => import('@/views/component_library/basic/image-group.vue'),
        meta: {
          title: '图片组',
          icon: 'qs-image-group',
        },
      },
      {
        path: 'icons',
        name: 'componentLibraryIcons',
        component: () => import('@/views/component_library/basic/icons.vue'),
        meta: {
          title: '图标库',
          icon: 'qs-icons',
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
      icon: 'qs-business-components',
    },
    children: [
      {
        path: 'generic-table',
        name: 'componentLibraryGenericTable',
        component: () => import('@/views/component_library/business/index.vue'),
        meta: {
          title: '通用表格',
          icon: 'qs-table',
        },
      },
      {
        path: 'ocean-container-list',
        name: 'componentLibraryQsOceanContainerList',
        component: () => import('@/views/component_library/business/ocean-container-list.vue'),
        meta: {
          title: '海运柜次卡片',
          icon: 'qs-ocean-containers',
        },
      },
      {
        path: 'generic-drawer',
        name: 'componentLibraryGenericDrawer',
        component: () => import('@/views/component_library/business/generic-drawer.vue'),
        meta: {
          title: '通用抽屉',
          icon: 'qs-drawer',
        },
      },
      {
        path: 'generic-modal',
        name: 'componentLibraryGenericModal',
        component: () => import('@/views/component_library/business/generic-modal.vue'),
        meta: {
          title: '通用模态框',
          icon: 'qs-modal',
        },
      },
      {
        path: 'factory-shipment-modal',
        name: 'componentLibraryQsFactoryShipmentModal',
        component: () => import('@/views/component_library/business/factory-shipment-modal.vue'),
        meta: {
          title: '订单工厂发货弹窗',
          icon: 'qs-factory-shipment',
        },
      },
      {
        path: 'sales-order-selector-modal',
        name: 'componentLibraryQsSalesOrderSelectorModal',
        component: () => import('@/views/component_library/business/sales-order-selector-modal.vue'),
        meta: {
          title: '销售订单选择弹窗',
          icon: 'qs-order-select',
        },
      },
      {
        path: 'sales-order-products-editor-modal',
        name: 'componentLibraryQsSalesOrderProductsEditorModal',
        component: () => import('@/views/component_library/business/sales-order-products-editor-modal.vue'),
        meta: {
          title: '销售订单产品修改弹窗',
          icon: 'qs-order-products-edit',
        },
      },
      {
        path: 'good-tooltip',
        name: 'componentLibraryQsGoodTooltip',
        component: () => import('@/views/component_library/business/good-tooltip.vue'),
        meta: {
          title: '产品提示',
          icon: 'qs-product-info',
        },
      },
      {
        path: 'region-selector',
        name: 'componentLibraryQsRegionSelector',
        component: () => import('@/views/component_library/business/region-selector.vue'),
        meta: {
          title: '地区选择器',
          icon: 'qs-regions',
        },
      },
      {
        path: 'dictionary-select',
        name: 'componentLibraryQsDictionarySelect',
        component: () => import('@/views/component_library/business/dictionary-select.vue'),
        meta: {
          title: '字典选择器',
          icon: 'qs-dictionaries',
        },
      },
      {
        path: 'person-display',
        name: 'componentLibraryQsPersonDisplay',
        component: () => import('@/views/component_library/business/person-display.vue'),
        meta: {
          title: '人员显示',
          icon: 'qs-person',
        },
      },
      {
        path: 'product-selector',
        name: 'componentLibraryQsProductSelector',
        component: () => import('@/views/component_library/business/product-selector.vue'),
        meta: {
          title: '产品选择器',
          icon: 'qs-product-select',
        },
      },
      {
        path: 'order-product-line-editor',
        name: 'componentLibraryQsOrderProductLineEditor',
        component: () => import('@/views/component_library/business/order-product-line-editor.vue'),
        meta: {
          title: '订单产品明细编辑器',
          icon: 'qs-order-lines',
        },
      },
      {
        path: 'part-configurator',
        name: 'componentLibraryQsPartConfigurator',
        component: () => import('@/views/component_library/business/part-configurator.vue'),
        meta: {
          title: '货件配置器',
          icon: 'qs-part-configurator',
        },
      },
      {
        path: 'sales-order-desc',
        name: 'componentLibraryQsSalesOrderDesc',
        component: () => import('@/views/component_library/business/sales-order-desc.vue'),
        meta: {
          title: '销售订单详情',
          icon: 'qs-sales-orders',
        },
      },
      {
        path: 'purchase-order-desc',
        name: 'componentLibraryQsPurchaseOrderDesc',
        component: () => import('@/views/component_library/business/purchase-order-desc.vue'),
        meta: {
          title: '采购订单详情',
          icon: 'qs-purchase-orders',
        },
      },
      {
        path: 'status-switch-toolbar',
        name: 'componentLibraryQsStatusSwitchToolbar',
        component: () => import('@/views/component_library/business/status-switch-toolbar.vue'),
        meta: {
          title: '状态切换工具栏',
          icon: 'qs-status-switch',
        },
      },
      {
        path: 'reconciliation-line-switcher',
        name: 'componentLibraryQsReconciliationLineSwitcher',
        component: () => import('@/views/component_library/business/reconciliation-line-switcher.vue'),
        meta: {
          title: '对账明细行切换',
          icon: 'qs-bill-reconciliation-check',
        },
      },
      {
        path: 'personal-fund-account-card',
        name: 'componentLibraryQsPersonalFundAccountCard',
        component: () => import('@/views/component_library/business/personal-fund-account-card.vue'),
        meta: {
          title: '个人资金账户卡片',
          icon: 'qs-fund-accounts',
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
      icon: 'qs-page-templates',
      singleMenu: true,
    },
  },
]

export default routes
