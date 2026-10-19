import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'
import pinia from '@/store'
import UserRoles from './modules/admin.user-roles'
import ApplicationSettings from './modules/application.settings'
import BasicData from './modules/basic.data'
import ComponentLibraryRoutes, {
  createRegionSelectorBrowserE2eRoutes,
  shouldEnableComponentLibrary,
} from './modules/component.library'
import { financeLegacyRedirects } from './modules/finance-legacy-redirects'
import { managementLegacyRedirects } from './modules/management-legacy-redirects'
import OperationsWorkbenchRoutes from './modules/operations.workbench'
import ProductManagement from './modules/product.management'
import { financeWorkbench, purchaseTransportWorkbench } from './modules/role.workbenches'
import SupplierPaymentProfiles from './modules/supplier.payment.profiles'
import SystemAudit from './modules/system.audit'
import {
  ADMIN_WORKBENCH_PERMISSION,
  OPERATIONS_WORKBENCH_PERMISSION,
  SYSTEM_MANAGEMENT_PERMISSION,
} from './modules/workbench-access'

// 固定路由（默认路由）
const constantRoutes: RouteRecordRaw[] = [
  ...financeLegacyRedirects,
  ...managementLegacyRedirects,
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login-collage.vue'),
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
          // 首页是登录后的默认落点：此处不设置权限门槛，任一已登录身份都可进入而不落入 403 拦截。
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
      auth: [OPERATIONS_WORKBENCH_PERMISSION],
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
      auth: [ADMIN_WORKBENCH_PERMISSION],
    },
    children: [
      BasicData,
      ProductManagement,
      UserRoles,
      SupplierPaymentProfiles,
    ],
  },
  {
    meta: {
      title: '系统管理',
      icon: 'qs-system',
      auth: [SYSTEM_MANAGEMENT_PERMISSION],
    },
    children: [
      SystemAudit,
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
