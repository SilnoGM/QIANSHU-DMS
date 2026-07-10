import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/plugin_example',
  component: Layout,
  name: 'pluginExample',
  meta: {
    title: $t('route.plugin.root'),
    icon: 'i-clarity:plugin-outline-alerted',
    badge: '演示',
  },
  children: [
    {
      path: 'hooksplus',
      name: 'pluginExampleHooksPlus',
      component: () => import('@/views/plugin_example/hooks.plus.vue'),
      meta: {
        title: 'VueHooks Plus',
        icon: 'https://inhiblabcore.github.io/docs/hooks/logo.svg',
      },
    },
    {
      path: 'print',
      name: 'pluginExamplePrint',
      component: () => import('@/views/plugin_example/print.vue'),
      meta: {
        title: 'Print',
        icon: 'i-ri:printer-line',
      },
    },
    {
      path: 'esign',
      name: 'pluginExampleEsign',
      component: () => import('@/views/plugin_example/esign.vue'),
      meta: {
        title: 'E-sign',
        icon: 'i-mdi:draw',
      },
    },
    {
      path: 'animation',
      name: 'pluginExampleAnimation',
      component: () => import('@/views/plugin_example/animation.vue'),
      meta: {
        title: 'Animate.css',
        icon: 'i-clarity:animation-line',
      },
    },
    {
      path: 'swiper',
      name: 'pluginExampleSwiper',
      component: () => import('@/views/plugin_example/swiper.vue'),
      meta: {
        title: 'Swiper',
        icon: 'i-carbon:carousel-horizontal',
      },
    },
    {
      path: 'chart',
      name: 'pluginExampleChart',
      meta: {
        title: $t('route.plugin.chart'),
        icon: 'i-ri:bar-chart-2-line',
      },
      children: [
        {
          path: 'echarts',
          name: 'pluginExampleChartEcharts',
          component: () => import('@/views/plugin_example/echarts.vue'),
          meta: {
            title: 'Echarts',
          },
        },
        {
          path: 'vchart',
          name: 'pluginExampleChartVchart',
          component: () => import('@/views/plugin_example/vchart.vue'),
          meta: {
            title: 'VChart',
          },
        },
        {
          path: 'vue-data-ui',
          name: 'pluginExampleChartVueDataUi',
          component: () => import('@/views/plugin_example/vue-data-ui.vue'),
          meta: {
            title: 'VueDataUI',
          },
        },
      ],
    },
    {
      path: 'tinymce',
      name: 'pluginExampleTinymce',
      component: () => import('@/views/plugin_example/tinymce.vue'),
      meta: {
        title: 'TinyMCE',
        icon: 'i-file-icons:tinymce',
        localeAuth: ['zh-cn'],
      },
    },
    {
      path: 'currencyinput',
      name: 'pluginExampleCurrencyInput',
      component: () => import('@/views/plugin_example/currency.input.vue'),
      meta: {
        title: 'Currency Input',
        icon: 'i-ph:currency-cny-bold',
      },
    },
    {
      path: 'splitpanes',
      name: 'pluginExampleSplitpanes',
      component: () => import('@/views/plugin_example/splitpanes.vue'),
      meta: {
        title: 'Splitpanes',
        icon: 'i-icon-park-outline:split-cells',
      },
    },
    {
      path: 'vxe-table',
      name: 'pluginExampleVxeTable',
      component: () => import('@/views/plugin_example/vxe-table.vue'),
      meta: {
        title: 'Vxe Table',
        icon: 'i-mdi:table-large',
        localeAuth: ['zh-cn'],
      },
    },
    {
      path: 'cropper',
      name: 'pluginExampleCropper',
      component: () => import('@/views/plugin_example/cropper.vue'),
      meta: {
        title: 'Cropper',
        icon: 'i-mdi:crop',
      },
    },
  ],
}

export default routes
