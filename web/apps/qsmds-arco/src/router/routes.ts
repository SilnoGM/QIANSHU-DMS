import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'
import pinia from '@/store'
import ApplicationSettings from './modules/application.settings'
import BasicData from './modules/basic.data'
import ComponentLibraryRoutes, {
  createRegionSelectorBrowserE2eRoutes,
  shouldEnableComponentLibrary,
} from './modules/component.library'
import { financeLegacyRedirects } from './modules/finance-legacy-redirects'
import OperationsWorkbenchRoutes from './modules/operations.workbench'
import ProductManagement, {
  PRODUCT_MANAGEMENT_PERMISSIONS,
} from './modules/product.management'
import { financeWorkbench, purchaseTransportWorkbench } from './modules/role.workbenches'
import SupplierPaymentProfiles, { SUPPLIER_PAYMENT_PROFILE_PERMISSIONS } from './modules/supplier.payment.profiles'
import SystemManagement, {
  MANAGEMENT_READ_PERMISSIONS,
} from './modules/system.management'

// 固定路由（默认路由）
const constantRoutes: RouteRecordRaw[] = [
  ...financeLegacyRedirects,
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login.vue'),
    meta: {
      whiteList: true,
      title: $t('app.route.login'),
    },
  },
  {
    path: '/:all(.*)*',
    name: 'notFound',
    component: () => import('@/views/[...all].vue'),
    meta: {
      title: '找不到页面',
    },
  },
]

// 系统路由
const systemRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/index.vue'),
    meta: {
      breadcrumb: false,
    },
    children: [
      {
        path: '',
        component: () => import('@/views/index.vue'),
        meta: {
          title: $t(useAppSettingsStore(pinia).settings.app.home.title),
          icon: 'qs-home',
          breadcrumb: false,
          auth: [...MANAGEMENT_READ_PERMISSIONS],
        },
      },
      {
        path: 'reload',
        name: 'reload',
        component: () => import('@/views/reload.vue'),
        meta: {
          title: $t('app.route.reload'),
          breadcrumb: false,
        },
      },
    ],
  },
]

// 动态路由（异步路由、导航菜单路由）
const componentLibraryMainRoute: RouteRecordMainRaw = {
  meta: {
    title: '组件库',
    icon: 'qs-library',
  },
  children: [
    ...ComponentLibraryRoutes,
    ...createRegionSelectorBrowserE2eRoutes(import.meta.env),
  ],
}

const asyncRoutes: RouteRecordMainRaw[] = [
  {
    meta: {
      title: '千树运营工作台',
      icon: 'qs-workbench-operations',
    },
    children: [
      ...OperationsWorkbenchRoutes,
    ],
  },
  financeWorkbench,
  purchaseTransportWorkbench,
  {
    meta: {
      title: '管理员工作台',
      icon: 'qs-workbench-admin',
      auth: [
        ...PRODUCT_MANAGEMENT_PERMISSIONS,
        ...SUPPLIER_PAYMENT_PROFILE_PERMISSIONS,
      ],
    },
    children: [
      ProductManagement,
      SupplierPaymentProfiles,
    ],
  },
  {
    meta: {
      title: '系统管理',
      icon: 'qs-system',
    },
    children: [
      SystemManagement,
      BasicData,
      ApplicationSettings,
    ],
  },
  ...(shouldEnableComponentLibrary(import.meta.env)
    ? [componentLibraryMainRoute]
    : []),
]

export {
  asyncRoutes,
  constantRoutes,
  systemRoutes,
}
