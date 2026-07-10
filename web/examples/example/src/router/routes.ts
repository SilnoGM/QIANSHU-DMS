import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'
import pinia from '@/store'
import AlwaysExpandExample from './modules/always.expand.example'
import AuthExample from './modules/auth.example'
import BreadcrumbExample from './modules/breadcrumb.example'
import ComponentExample from './modules/component.example'
import ComponentProExample from './modules/component.pro.example'
import EcologyExample from './modules/ecology.example'
import ExternalLinkExample from './modules/external.link.example'
import FakeExample from './modules/fake.example'
import FeatureExample from './modules/feature.example'
import IconExample from './modules/icon.example'
import JsxExample from './modules/jsx.example'
import KeepAliveExample from './modules/keep.alive.example'
import LayoutCenterExample from './modules/layout.center.example'
import LayoutContainerExample from './modules/layout.container.example'
import MenuBadgeExample from './modules/menu.badge.example'
import MenuIconExample from './modules/menu.icon.example'
import MenuQueryExample from './modules/menu.query.example'
import MultilevelMenuExample from './modules/multilevel.menu.example'
import PagesExample from './modules/pages.example'
import PluginExample from './modules/plugin.example'
import StandardModuleExample from './modules/standard.module.example'
import StyleExample from './modules/style.example'
import TabbarExample from './modules/tabbar.example'
import UiExample from './modules/ui.example'

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
const asyncRoutes: RouteRecordMainRaw[] = [
  {
    meta: {
      title: $t('route.demo'),
      icon: 'i-ri:function-ai-line',
    },
    children: [
      StyleExample,
      MultilevelMenuExample,
      BreadcrumbExample,
      KeepAliveExample,
      AlwaysExpandExample,
      MenuBadgeExample,
      MenuIconExample,
      MenuQueryExample,
      LayoutCenterExample,
      TabbarExample,
      ComponentExample,
      ComponentProExample,
      IconExample,
      LayoutContainerExample,
      FeatureExample,
      PluginExample,
      AuthExample,
      FakeExample,
      JsxExample,
      ExternalLinkExample,
      StandardModuleExample,
    ],
  },
  {
    meta: {
      title: 'UI',
      icon: 'i-whh:jqueryui',
      localeAuth: ['zh-cn', 'zh-tw'],
    },
    children: [
      UiExample,
    ],
  },
  {
    meta: {
      title: $t('route.page'),
      icon: 'i-ri:pages-line',
    },
    children: [
      ...PagesExample,
    ],
  },
  {
    meta: {
      title: $t('route.ecology'),
      icon: 'i-icon-park-outline:circular-connection',
      badge: true,
      localeAuth: ['zh-cn', 'zh-tw'],
    },
    children: [
      ...EcologyExample,
    ],
  },
]

export {
  asyncRoutes,
  constantRoutes,
  systemRoutes,
}
