import type { IncomingMessage, ServerResponse } from 'node:http'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import { isApiError } from '../../src/api/api-error'
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

  assert.equal(routes.length, 13)
  assert.equal(new Set(routes.map(route => route.url)).size, 13)
  assert.deepEqual(routeSignatures, [
    ['/fake/app/route/list', 'get', 200],
    ['/fake/app/account/login', 'post', 200],
    ['/fake/app/account/login/expired', 'post', 401],
    ['/fake/app/account/permission', 'get', 200],
    ['/fake/app/account/password/edit', 'post', 200],
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

test('account/login 直接返回登录 DTO', () => {
  const body = callRoute('/fake/app/account/login', {
    body: {
      account: 'admin',
      password: 'secret',
    },
  })

  assertBareDto(body)
  assert.equal(typeof body, 'object')
  assert.ok(body)
  assert.equal(Reflect.get(body, 'account'), 'admin')
  assert.match(Reflect.get(body, 'token'), /^admin:.+$/)
  assert.equal(
    Reflect.get(body, 'avatar'),
    'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=admin',
  )
})

test('account/permission 直接返回按 Token 计算的 permissions', () => {
  const adminBody = callRoute('/fake/app/account/permission', {
    headers: { token: 'admin:token' },
  })
  const testBody = callRoute('/fake/app/account/permission', {
    headers: { token: 'test:token' },
  })
  const unknownBody = callRoute('/fake/app/account/permission', {
    headers: { token: 'unknown:token' },
  })

  assertBareDto(adminBody)
  assertBareDto(testBody)
  assertBareDto(unknownBody)
  assert.deepEqual(adminBody, {
    permissions: [
      'pages.general:browse',
      'pages.form:browse',
      'pages.list:browse',
      'pages.shop:browse',
    ],
  })
  assert.deepEqual(testBody, {
    permissions: ['pages.general:browse'],
  })
  assert.deepEqual(unknownBody, { permissions: [] })
})

test('account/password/edit 直接返回成功 DTO', () => {
  const body = callRoute('/fake/app/account/password/edit')

  assertBareDto(body)
  assert.deepEqual(body, { isSuccess: true })
})

test('preferences 直接返回按 Token 计算的 preferences', () => {
  const adminBody = callRoute('/fake/app/preferences', {
    headers: { token: 'admin:token' },
  })
  const testBody = callRoute('/fake/app/preferences', {
    headers: { token: 'test:token' },
  })
  const unknownBody = callRoute('/fake/app/preferences', {
    headers: { token: 'unknown:token' },
  })

  assertBareDto(adminBody)
  assertBareDto(testBody)
  assertBareDto(unknownBody)
  assert.deepEqual(adminBody, {
    preferences: '{"theme":{"colorScheme":"light"}}',
  })
  assert.deepEqual(testBody, {
    preferences: '{"theme":{"colorScheme":"dark","raduis":1},"menu":{"mode":"head","style":""},"layout":{"widthMode":"center"},"topbar":{"tabbar":false}}',
  })
  assert.deepEqual(unknownBody, { preferences: '' })
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

test('toolbar/favorites 直接返回按 Token 计算的 favorites', () => {
  const adminBody = callRoute('/fake/app/toolbar/favorites', {
    headers: { token: 'admin:token' },
  })
  const unknownBody = callRoute('/fake/app/toolbar/favorites', {
    headers: { token: 'unknown:token' },
  })

  assertBareDto(adminBody)
  assertBareDto(unknownBody)
  assert.deepEqual(adminBody, {
    favorites: '[{"fullPath":"/multilevel_menu_example/page","title":"导航1","i18n":"route.multimenu.page","icon":"heroicons-solid:menu-alt-3"}]',
  })
  assert.deepEqual(unknownBody, { favorites: '' })
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

test('account/login/expired 返回 HTTP 401 ApiError', () => {
  const route = findRoute('/fake/app/account/login/expired')
  const body = callRoute(route.url)
  const nextBody = callRoute(route.url)

  assert.equal(route.statusCode, 401)
  assertBareDto(body)
  assertBareDto(nextBody)
  assert.ok(isApiError(body))
  assert.ok(isApiError(nextBody))
  assert.equal(body.code, 'UNAUTHORIZED')
  assert.equal(body.message, '未登录或登录已失效')
  assert.match(
    body.requestId,
    /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  assert.match(
    nextBody.requestId,
    /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  assert.notEqual(nextBody.requestId, body.requestId)
})
