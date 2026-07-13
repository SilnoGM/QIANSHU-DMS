import type { ApiError } from '../api-error'

import { faker } from '@faker-js/faker'
import { defineFakeRoute } from 'vite-plugin-fake-server/client'

export default defineFakeRoute([
  {
    url: '/fake/app/route/list',
    method: 'get',
    response: () => {
      return [
        // 主导航
        {
          meta: {
            title: '演示',
            icon: 'uim:box',
          },
          children: [
            // 次导航（一级路由）
            {
              path: '/multilevel_menu_example',
              component: 'Layout',
              name: 'multilevelMenuExample',
              meta: {
                title: 'route.multimenu.root',
                icon: 'heroicons-solid:menu-alt-3',
              },
              children: [
                // 次导航（二级路由）
                {
                  path: 'page',
                  name: 'multilevelMenuExample1',
                  component: 'multilevel_menu_example/page.vue',
                  meta: {
                    title: 'route.multimenu.page',
                  },
                },
                {
                  path: 'level2',
                  name: 'multilevelMenuExample2',
                  meta: {
                    title: 'route.multimenu.level2.root',
                  },
                  children: [
                    // 次导航（三级路由）
                    {
                      path: 'page',
                      name: 'multilevelMenuExample2-1',
                      component: 'multilevel_menu_example/level2/page.vue',
                      meta: {
                        title: 'route.multimenu.level2.page',
                      },
                    },
                    {
                      path: 'level3',
                      name: 'multilevelMenuExample2-2',
                      meta: {
                        title: 'route.multimenu.level2.level3.root',
                      },
                      children: [
                        // 次导航（四级路由）
                        {
                          path: 'page1',
                          name: 'multilevelMenuExample2-2-1',
                          component: 'multilevel_menu_example/level2/level3/page1.vue',
                          meta: {
                            title: 'route.multimenu.level2.level3.page1',
                          },
                        },
                        {
                          path: 'page2',
                          name: 'multilevelMenuExample2-2-2',
                          component: 'multilevel_menu_example/level2/level3/page2.vue',
                          meta: {
                            title: 'route.multimenu.level2.level3.page2',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]
    },
  },
  {
    url: '/fake/app/account/login',
    method: 'post',
    response: ({ body }) => {
      return {
        account: body.account,
        token: `${body.account}:${faker.internet.jwt()}`,
        avatar: `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${body.account}`,
      }
    },
  },
  {
    url: '/fake/app/account/login/expired',
    method: 'post',
    statusCode: 401,
    response: () => {
      return {
        code: 'UNAUTHORIZED',
        message: '未登录或登录已失效',
        requestId: `req_${faker.string.uuid()}`,
      } satisfies ApiError
    },
  },
  {
    url: '/fake/app/account/permission',
    method: 'get',
    response: ({ headers }) => {
      let permissions: string[] = []
      if (headers.token?.indexOf('admin') === 0) {
        permissions = [
          'pages.general:browse',
          'pages.form:browse',
          'pages.list:browse',
          'pages.shop:browse',
        ]
      }
      else if (headers.token?.indexOf('test') === 0) {
        permissions = [
          'pages.general:browse',
        ]
      }
      return {
        permissions,
      }
    },
  },
  {
    url: '/fake/app/account/password/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/preferences',
    method: 'get',
    response: ({ headers }) => {
      let preferences = ''
      if (headers.token?.indexOf('admin') === 0) {
        preferences = '{"theme":{"colorScheme":"light"}}'
      }
      else if (headers.token?.indexOf('test') === 0) {
        preferences = '{"theme":{"colorScheme":"dark","raduis":1},"menu":{"mode":"head","style":""},"layout":{"widthMode":"center"},"topbar":{"tabbar":false}}'
      }
      return {
        preferences,
      }
    },
  },
  {
    url: '/fake/app/preferences/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/tabbar',
    method: 'get',
    response: ({ headers }) => {
      let tabbar = ''
      if (headers.token?.indexOf('admin') === 0) {
        tabbar = ''
      }
      return {
        tabbar,
      }
    },
  },
  {
    url: '/fake/app/tabbar/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/toolbar/favorites',
    method: 'get',
    response: ({ headers }) => {
      let favorites = ''
      if (headers.token?.indexOf('admin') === 0) {
        favorites = '[{"fullPath":"/multilevel_menu_example/page","title":"导航1","i18n":"route.multimenu.page","icon":"heroicons-solid:menu-alt-3"}]'
      }
      return {
        favorites,
      }
    },
  },
  {
    url: '/fake/app/toolbar/favorites/edit',
    method: 'post',
    response: () => {
      return {
        isSuccess: true,
      }
    },
  },
  {
    url: '/fake/app/notification/unread',
    method: 'get',
    response: () => {
      return {
        message: 4,
        approval: 10,
        default: 0,
      }
    },
  },
  {
    url: '/fake/app/notification/list',
    method: 'get',
    response: () => {
      const messageList: any[] = []
      const approvalList: any[] = []
      const defaultList: any[] = []
      for (let i = 0; i < 4; i++) {
        messageList.push({
          id: i + 1,
          title: '你收到了 8 份日报',
          datetime: '2020-10-10 10:00:00',
          read: false,
        })
      }
      for (let i = 0; i < 10; i++) {
        approvalList.push({
          id: i + 1,
          title: '你的请假已通过',
          datetime: '2020-10-10 10:00:00',
          read: false,
        })
      }
      return {
        message: messageList,
        approval: approvalList,
        default: defaultList,
      }
    },
  },
])
