import type { IncomingMessage, ServerResponse } from 'node:http'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import appFakeRouteConfig from '../../src/api/fake_modules/app.fake'

const routes = Array.isArray(appFakeRouteConfig)
  ? appFakeRouteConfig
  : [appFakeRouteConfig]

type Route = (typeof routes)[number]
type RequestContext = Parameters<NonNullable<Route['response']>>[0]

const emptyRequest: RequestContext = {
  body: {},
  headers: {},
  params: {},
  query: {},
  rawBody: '',
  url: '',
}

function findRoute(url: string): Route {
  const route = routes.find(item => item.url === url)
  assert.ok(route, `未找到 fake route: ${url}`)
  return route
}

function callRoute(
  url: string,
  request: Partial<RequestContext> = {},
): unknown {
  const route = findRoute(url)
  assert.ok(route.response, `fake route 缺少 response handler: ${url}`)

  return route.response(
    { ...emptyRequest, ...request },
    undefined as unknown as IncomingMessage,
    undefined as unknown as ServerResponse,
  )
}

/**
 * 成功响应必须直接返回业务 DTO。旧的 `{ status, error, data }` envelope
 * 会让 Axios 的 `response.data` 多嵌套一层，因而在这里作为统一回归条件禁止。
 */
function assertBareDto(value: unknown): void {
  assert.equal(Object.hasOwn(value as object, 'status'), false)
  assert.equal(Object.hasOwn(value as object, 'error'), false)
  assert.equal(Object.hasOwn(value as object, 'data'), false)
}

test('route/list 直接返回原路由数组', () => {
  const routeSignatures = routes.map(route => [
    route.url,
    route.method ?? 'get',
    route.statusCode ?? 200,
  ])

  assert.equal(routes.length, 9)
  assert.equal(new Set(routes.map(route => route.url)).size, 9)
  assert.deepEqual(routeSignatures, [
    ['/fake/app/route/list', 'get', 200],
    ['/fake/app/preferences', 'get', 200],
    ['/fake/app/preferences/edit', 'post', 200],
    ['/fake/app/tabbar', 'get', 200],
    ['/fake/app/tabbar/edit', 'post', 200],
    ['/fake/app/toolbar/favorites', 'get', 200],
    ['/fake/app/toolbar/favorites/edit', 'post', 200],
    ['/fake/app/notification/unread', 'get', 200],
    ['/fake/app/notification/list', 'get', 200],
  ])

  const body = callRoute('/fake/app/route/list')

  assertBareDto(body)
  assert.deepEqual(body, [
    {
      meta: {
        title: '演示',
        icon: 'uim:box',
      },
      children: [
        {
          path: '/multilevel_menu_example',
          component: 'Layout',
          name: 'multilevelMenuExample',
          meta: {
            title: 'route.multimenu.root',
            icon: 'heroicons-solid:menu-alt-3',
          },
          children: [
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
  ])
})

test('旧 fake 登录、权限和改密路由已删除', () => {
  assert.equal(
    routes.some(route => route.url.startsWith('/fake/app/account/')),
    false,
  )
})

test('preferences 不再依赖旧 Token', () => {
  const body = callRoute('/fake/app/preferences')

  assertBareDto(body)
  assert.deepEqual(body, { preferences: '' })
})

test('preferences/edit 直接返回成功 DTO', () => {
  const body = callRoute('/fake/app/preferences/edit')

  assertBareDto(body)
  assert.deepEqual(body, { isSuccess: true })
})

test('tabbar 直接返回 tabbar DTO', () => {
  const body = callRoute('/fake/app/tabbar', {
    headers: { token: 'admin:token' },
  })

  assertBareDto(body)
  assert.deepEqual(body, { tabbar: '' })
})

test('tabbar/edit 直接返回成功 DTO', () => {
  const body = callRoute('/fake/app/tabbar/edit')

  assertBareDto(body)
  assert.deepEqual(body, { isSuccess: true })
})

test('toolbar/favorites 不再依赖旧 Token', () => {
  const body = callRoute('/fake/app/toolbar/favorites')

  assertBareDto(body)
  assert.deepEqual(body, { favorites: '' })
})

test('toolbar/favorites/edit 直接返回成功 DTO', () => {
  const body = callRoute('/fake/app/toolbar/favorites/edit')

  assertBareDto(body)
  assert.deepEqual(body, { isSuccess: true })
})

test('notification/unread 直接返回未读统计 DTO', () => {
  const body = callRoute('/fake/app/notification/unread')

  assertBareDto(body)
  assert.deepEqual(body, {
    message: 4,
    approval: 10,
    default: 0,
  })
})

test('notification/list 直接返回三类通知列表 DTO', () => {
  const body = callRoute('/fake/app/notification/list')

  assertBareDto(body)
  assert.deepEqual(body, {
    message: Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      title: '你收到了 8 份日报',
      datetime: '2020-10-10 10:00:00',
      read: false,
    })),
    approval: Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      title: '你的请假已通过',
      datetime: '2020-10-10 10:00:00',
      read: false,
    })),
    default: [],
  })
})
