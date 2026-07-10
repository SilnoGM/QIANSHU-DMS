import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/link',
  component: Layout,
  name: 'externalLinkExample',
  meta: {
    title: $t('route.externalLink.root'),
    icon: 'i-ri:external-link-fill',
    badge: true,
  },
  children: [
    {
      path: 'iframe',
      name: 'linkExampleIframe',
      meta: {
        title: 'Iframe',
        badge: 'PRO',
      },
      children: [
        {
          path: 'iframeVueRouter',
          redirect: '',
          name: 'linkExampleIframeVueRouter',
          meta: {
            title: 'Vue-Router',
            iframe: 'https://router.vuejs.org/',
            keepAlive: true,
            copyright: false,
          },
        },
        {
          path: 'iframeVuePinia',
          redirect: '',
          name: 'linkExampleIframeVuePinia',
          meta: {
            title: 'Pinia',
            iframe: 'https://pinia.vuejs.org/',
            keepAlive: true,
            copyright: false,
          },
        },
        {
          path: 'iframeElement',
          redirect: '',
          name: 'linkExampleIframeElement',
          meta: {
            title: 'Element Plus',
            iframe: 'https://element-plus.org/',
            keepAlive: true,
            copyright: false,
          },
        },
        {
          path: 'dynamic',
          component: () => import('@/views/link_example/iframe.vue'),
          name: 'linkExampleIframeDynamic',
          meta: {
            title: $t('route.externalLink.dynamicIframe'),
            keepAlive: true,
          },
        },
        {
          path: 'dynamicTest',
          redirect: '',
          name: 'linkExampleIframeDynamicTest',
          meta: {
            menu: false,
            activeMenu: '/link/iframe/dynamic',
            iframe: true,
            keepAlive: true,
          },
        },
      ],
    },
    {
      path: 'window',
      name: 'linkExampleWindow',
      meta: {
        title: $t('route.externalLink.newwindow'),
      },
      children: [
        {
          path: 'github',
          redirect: '',
          name: 'linkExampleWindowGithub',
          meta: {
            title: 'Github',
            link: 'https://github.com/fantastic-admin/basic',
          },
        },
        {
          path: 'gitee',
          redirect: '',
          name: 'linkExampleWindowGitee',
          meta: {
            title: 'Gitee',
            link: 'https://gitee.com/fantastic-admin/basic',
            localeAuth: ['zh-cn'],
          },
        },
      ],
    },
  ],
}

export default routes
