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
import SystemManagement, {
  MANAGEMENT_READ_PERMISSIONS,
} from './modules/system.management'

// 固定路由（默认路由）
const constantRoutes: RouteRecordRaw[] = [
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
          icon: 'i-ant-design:home-twotone',
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
    icon: 'i-lucide:library-big',
  },
  children: [
    ...ComponentLibraryRoutes,
    ...createRegionSelectorBrowserE2eRoutes(import.meta.env),
  ],
}

const asyncRoutes: RouteRecordMainRaw[] = [
  {
    meta: {
      title: '系统管理',
      icon: 'i-lucide:settings-2',
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
