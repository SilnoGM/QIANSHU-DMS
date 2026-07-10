import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/feature_example',
  component: Layout,
  name: 'featureExample',
  meta: {
    title: $t('route.feature.root'),
    icon: 'i-ic:twotone-auto-awesome',
  },
  children: [
    {
      path: 'i18n',
      name: 'featureExampleI18n',
      component: () => import('@/views/feature_example/i18n.vue'),
      meta: {
        title: $t('route.feature.i18n'),
        icon: 'i-ri:earth-line',
        badge: 'PRO',
      },
    },
    {
      path: 'font',
      name: 'featureExampleFont',
      component: () => import('@/views/feature_example/font.vue'),
      meta: {
        title: $t('route.feature.font'),
        icon: 'i-ri:font-size',
        badge: 'PRO',
      },
    },
    {
      path: 'waves',
      name: 'featureExampleWaves',
      component: () => import('@/views/feature_example/waves.vue'),
      meta: {
        title: $t('route.feature.waves'),
        icon: 'i-ph:waves-bold',
        badge: 'PRO',
      },
    },
    {
      path: 'zoomable',
      name: 'featureExampleZoomable',
      component: () => import('@/views/feature_example/zoomable.vue'),
      meta: {
        title: $t('route.feature.zoomable'),
        icon: 'i-mingcute:zoom-in-line',
        badge: 'PRO',
      },
    },
    {
      path: 'watermark',
      name: 'featureExampleWatermark',
      component: () => import('@/views/feature_example/watermark.vue'),
      meta: {
        title: $t('route.feature.watermark'),
        icon: 'i-icon-park-outline:mosaic',
        badge: 'PRO',
      },
    },
    {
      path: 'bug',
      name: 'featureExampleBug',
      component: () => import('@/views/feature_example/bug.vue'),
      meta: {
        title: $t('route.feature.bug'),
        icon: 'i-ri:bug-line',
        badge: 'PRO',
      },
    },
    {
      path: 'title',
      name: 'featureExampleTitle',
      component: () => import('@/views/feature_example/title.vue'),
      meta: {
        title: $t('route.feature.title'),
        icon: 'i-mdi:format-title',
        badge: 'PRO',
      },
    },
    {
      path: 'maximize',
      name: 'featureExampleMaximize',
      component: () => import('@/views/feature_example/maximize.vue'),
      meta: {
        title: $t('route.feature.maximize'),
        icon: 'i-ri:picture-in-picture-exit-line',
        badge: 'PRO',
      },
    },
    {
      path: 'newWindow',
      name: 'featureExampleNewWindow',
      component: () => import('@/views/feature_example/new.window.vue'),
      meta: {
        title: $t('route.feature.newwindow'),
        icon: 'i-ooui:new-window-ltr',
        badge: 'PRO',
        newWindow: true,
      },
    },
    {
      path: 'vueuse',
      name: 'featureExampleVueuse',
      component: () => import('@/views/feature_example/vueuse.vue'),
      meta: {
        title: 'VueUse',
        icon: 'i-logos:vueuse',
      },
    },
    {
      path: 'login-expired',
      name: 'featureExampleLoginExpired',
      component: () => import('@/views/feature_example/login-expired.vue'),
      meta: {
        title: $t('route.feature.login-expired'),
        icon: 'i-ri:pass-expired-fill',
        badge: 'PRO',
      },
    },
    {
      path: 'confetti',
      name: 'featureExampleConfetti',
      component: () => import('@/views/feature_example/confetti.vue'),
      meta: {
        title: $t('route.feature.confetti'),
        icon: 'i-ph:confetti',
        badge: 'PRO',
      },
    },
    {
      path: 'tiks',
      name: 'featureExampleTiks',
      component: () => import('@/views/feature_example/tiks.vue'),
      meta: {
        title: $t('route.feature.tiks'),
        icon: 'i-ri:volume-up-line',
        badge: 'PRO',
      },
    },
    {
      path: 'rules',
      name: 'featureExampleRules',
      component: () => import('@/views/feature_example/rules.vue'),
      meta: {
        title: $t('route.feature.rules'),
        icon: 'i-mdi:regex',
        localeAuth: ['zh-cn'],
      },
    },
    {
      path: 'reload',
      name: 'featureExampleReload',
      component: () => import('@/views/feature_example/reload.vue'),
      meta: {
        title: $t('route.feature.reload'),
        icon: 'i-iconoir:refresh-double',
        keepAlive: true,
      },
    },
    {
      path: 'menuswitch',
      name: 'featureExampleMenuswitch',
      component: () => import('@/views/feature_example/menuswitch.vue'),
      meta: {
        title: $t('route.feature.menuswitch'),
        icon: 'i-charm:menu-hamburger',
      },
    },
    {
      path: 'leavetips',
      name: 'featureExampleLeavetips',
      component: () => import('@/views/feature_example/leavetips.vue'),
      meta: {
        title: $t('route.feature.leavetips'),
        icon: 'i-pepicons:leave',
      },
    },
    {
      path: 'scroll',
      name: 'featureExampleScroll',
      component: () => import('@/views/feature_example/scroll.vue'),
      meta: {
        title: $t('route.feature.scroll'),
        icon: 'i-carbon:auto-scroll',
        keepAlive: true,
      },
    },
  ],
}

export default routes
