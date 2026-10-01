import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'
import pinia from '@/store'
import UserRoles, { ADMIN_USER_ROLE_READ_PERMISSIONS } from './modules/admin.user-roles'
import ApplicationSettings from './modules/application.settings'
import BasicData, { BASIC_DATA_READ_PERMISSIONS } from './modules/basic.data'
import ComponentLibraryRoutes, {
  createRegionSelectorBrowserE2eRoutes,
  shouldEnableComponentLibrary,
} from './modules/component.library'
import { financeLegacyRedirects } from './modules/finance-legacy-redirects'
import { managementLegacyRedirects } from './modules/management-legacy-redirects'
import OperationsWorkbenchRoutes from './modules/operations.workbench'
import ProductManagement, {
  PRODUCT_MANAGEMENT_PERMISSIONS,
} from './modules/product.management'
import { financeWorkbench, purchaseTransportWorkbench } from './modules/role.workbenches'
import SupplierPaymentProfiles, { SUPPLIER_PAYMENT_PROFILE_PERMISSIONS } from './modules/supplier.payment.profiles'
import SystemAudit from './modules/system.audit'
import SystemDevelopmentMap from './modules/system.development-map'
import SystemReleaseNotes from './modules/system.release-notes'
import SystemStatus from './modules/system.status'

/**
 * 首页准入使用「任一管理读取权限」门槛，使无业务页面的身份进入稳定 403。
 * 该集合与具体导航分组解耦，独立于管理员工作台与系统管理的分组权限。
 */
export const MANAGEMENT_READ_PERMISSIONS = [
  'users:read',
  'roles:read',
  'audit:read',
  'regions:read',
] as const

/**
 * 管理员工作台主导航的 any-of 门槛，由四个子模块的读取权限并集构成。
 *
 * route store 会把这个数组覆盖到每个一级子路由，App.vue 又校验全部 matched
 * 记录，因此并集必须覆盖子模块的全部需求：漏项会让对应角色菜单可见但页面 403，
 * 或整个管理员工作台主导航被过滤。新增子模块权限时同步扩展此数组即可。
 */
const ADMIN_WORKBENCH_PERMISSIONS = [
  ...BASIC_DATA_READ_PERMISSIONS,
  ...PRODUCT_MANAGEMENT_PERMISSIONS,
  ...ADMIN_USER_ROLE_READ_PERMISSIONS,
  ...SUPPLIER_PAYMENT_PROFILE_PERMISSIONS,
]

// 固定路由（默认路由）
const constantRoutes: RouteRecordRaw[] = [
  ...financeLegacyRedirects,
  ...managementLegacyRedirects,
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
      auth: [...ADMIN_WORKBENCH_PERMISSIONS],
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
    },
    children: [
      SystemAudit,
      ApplicationSettings,
      SystemReleaseNotes,
      SystemDevelopmentMap,
      SystemStatus,
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
