/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'

function readConfiguration(environment) {
  const baseUrl = environment.QIANSHU_BROWSER_AUTH_BASE_URL
  const httpBaseUrl = environment.QIANSHU_BROWSER_AUTH_HTTP_BASE_URL
  const chromeExecutable = environment.QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE
  const profileDirectory = environment.QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY
  const username = environment.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME
  const password = environment.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD
  const passwordLength = typeof password === 'string'
    ? Array.from(password.normalize('NFC')).length
    : 0
  let production
  let development
  try {
    production = new URL(baseUrl)
    development = new URL(httpBaseUrl)
  }
  catch {
    throw new Error('Browser auth test configuration is invalid')
  }
  if (
    production.protocol !== 'https:'
    || development.protocol !== 'http:'
    || production.hostname !== '127.0.0.1'
    || development.hostname !== '127.0.0.1'
    || typeof chromeExecutable !== 'string'
    || !path.isAbsolute(chromeExecutable)
    || typeof profileDirectory !== 'string'
    || !path.isAbsolute(profileDirectory)
    || typeof username !== 'string'
    || !/^[a-z][a-z0-9_]{2,63}$/u.test(username)
    || typeof password !== 'string'
    || passwordLength < 8
    || passwordLength > 20
  ) {
    throw new Error('Browser auth test configuration is invalid')
  }
  return {
    baseUrl: production.origin,
    chromeExecutable,
    httpBaseUrl: development.origin,
    password,
    profileDirectory,
    username,
  }
}

/** 正式应用当前使用 hash history；浏览器场景必须按真实 Router URL 访问。 */
function appRouteUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath}`
}

function apiExpression(pathname, method, body) {
  const request = JSON.stringify({ body, method, pathname })
  return `(async () => {
    const input = ${request}
    const response = await fetch(input.pathname, {
      method: input.method,
      credentials: 'include',
      headers: input.method === 'GET' ? {} : {
        'Content-Type': 'application/json',
        'X-Qianshu-CSRF': '1',
      },
      ...(input.method === 'GET' ? {} : { body: JSON.stringify(input.body ?? {}) }),
    })
    let responseBody = null
    if (response.headers.get('content-type')?.includes('application/json')) {
      responseBody = await response.json()
    }
    return {
      body: responseBody,
      cacheControl: response.headers.get('cache-control'),
      status: response.status,
    }
  })()`
}

function storeSnapshotExpression() {
  return `(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const pinia = vue?.config?.globalProperties?.$pinia
    const store = pinia?._s?.get('appAccount')
    if (!store) return null
    return {
      state: store.authState,
      username: store.authContext?.user?.username ?? null,
    }
  })()`
}

function storeMethodExpression(method, argument) {
  return `(async () => {
    const vue = document.querySelector('#app')?.__vue_app__
    const store = vue?.config?.globalProperties?.$pinia?._s?.get('appAccount')
    if (!store || typeof store[${JSON.stringify(method)}] !== 'function') {
      throw new Error('account store unavailable')
    }
    await store[${JSON.stringify(method)}](${JSON.stringify(argument)})
    return true
  })()`
}

async function waitForAuthState(page, state) {
  await page.waitFor(`(() => {
    const value = ${storeSnapshotExpression()}
    return value?.state === ${JSON.stringify(state)}
  })()`)
}

async function loginThroughUi(
  page,
  configuration,
  expectedState = 'authenticated',
) {
  await page.waitFor(`document.querySelector('input[autocomplete="username"]') !== null`)
  const credentials = JSON.stringify({
    password: configuration.password,
    username: configuration.username,
  })
  await page.evaluate(`(() => {
    const credentials = ${credentials}
    const username = document.querySelector('input[autocomplete="username"]')
    const password = document.querySelector('input[autocomplete="current-password"]')
    const button = [...document.querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === '登录')
    if (!username || !password || !button) {
      throw new Error('login form unavailable')
    }
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setValue(username, credentials.username)
    setValue(password, credentials.password)
    button.click()
    return true
  })()`)
  await waitForAuthState(page, expectedState)
}

async function cookieNamed(page, name) {
  const cookies = await page.getCookies()
  return cookies.cookies.find(cookie => cookie.name === name)
}

async function clickVisibleButton(page, text) {
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some((button) => (
    button.textContent?.trim() === ${JSON.stringify(text)}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (
      candidate.textContent?.trim() === ${JSON.stringify(text)}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible button unavailable')
    button.click()
    return true
  })()`)
}

async function clickVisibleButtonContaining(page, text) {
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some((button) => (
    button.textContent?.includes(${JSON.stringify(text)})
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (
      candidate.textContent?.includes(${JSON.stringify(text)})
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible button unavailable')
    button.click()
    return true
  })()`)
}

async function clickVisibleText(page, text) {
  await page.waitFor(`(() => [...document.querySelectorAll('body *')].some((element) => (
    element.textContent?.trim() === ${JSON.stringify(text)}
    && element.getClientRects().length > 0
  )))()`)
  await page.evaluate(`(() => {
    const candidates = [...document.querySelectorAll('body *')].filter((element) => (
      element.textContent?.trim() === ${JSON.stringify(text)}
      && element.getClientRects().length > 0
    ))
    const target = candidates.find(element => (
      ![...element.children].some(child => child.textContent?.trim() === ${JSON.stringify(text)})
    )) ?? candidates.at(-1)
    if (!target) throw new Error('visible text unavailable')
    target.click()
    return true
  })()`)
}

async function clickVisibleDialogButton(page, dialogText, buttonText) {
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(dialogText)}))
    const button = [...(dialog?.querySelectorAll('button') ?? [])]
      .find(candidate => candidate.getClientRects().length > 0
        && !candidate.disabled
        && candidate.textContent?.trim() === ${JSON.stringify(buttonText)})
    if (!button) throw new Error('visible dialog button unavailable')
    button.click()
    return true
  })()`)
}

async function fillPasswordModal(page, values) {
  const serialized = JSON.stringify(values)
  await page.evaluate(`(() => {
    const values = ${serialized}
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const modal = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.getAttribute('aria-label')?.includes('密码'))
    const current = [...(modal?.querySelectorAll('input[autocomplete="current-password"]') ?? [])]
      .find(input => input.getClientRects().length > 0)
    const next = [...(modal?.querySelectorAll('input[autocomplete="new-password"]') ?? [])]
      .filter(input => input.getClientRects().length > 0)
    if (values.currentPassword !== undefined) {
      if (!current) throw new Error('current password input unavailable')
      setValue(current, values.currentPassword)
    }
    if (next.length !== 2) throw new Error('new password inputs unavailable')
    setValue(next[0], values.newPassword)
    setValue(next[1], values.newPassword)
    return true
  })()`)
}

async function fillVisibleProfileForm(page, values) {
  const serialized = JSON.stringify(values)
  await page.evaluate(`(() => {
    const values = ${serialized}
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('个人资料'))
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    for (const [autocomplete, value] of Object.entries(values)) {
      const input = dialog?.querySelector('input[autocomplete="' + autocomplete + '"]')
      if (!input) throw new Error('profile input unavailable')
      setValue(input, value)
    }
    return true
  })()`)
}

function authStoreExpression(operation) {
  return `(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const store = vue?.config?.globalProperties?.$pinia?._s?.get('appAccount')
    if (!store) throw new Error('account store unavailable')
    ${operation}
  })()`
}

test('真实 Chrome 覆盖 Cookie、持久 Session、多标签和缓存边界', {
  timeout: 240_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const passwordSeed = Array.from(configuration.password.normalize('NFC'))
    .slice(0, 8)
    .join('')
  const limitedCredentials = {
    username: 'browser_limited',
    password: `${passwordSeed}-I9`,
  }
  const forcedPassword = `${passwordSeed}-F8`
  const activePassword = `${passwordSeed}-A7`
  let browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: configuration.profileDirectory,
  })
  t.after(async () => {
    if (browser !== null) {
      await browser.close()
    }
  })

  const developmentPage = await browser.newPage()
  await developmentPage.navigate(appRouteUrl(configuration.httpBaseUrl, '/login'))
  const developmentLogin = await developmentPage.evaluate(apiExpression(
    '/api/auth/login',
    'POST',
    { password: configuration.password, username: configuration.username },
  ))
  assert.equal(developmentLogin.status, 200)
  assert.equal(developmentLogin.cacheControl, 'private, no-store')
  const developmentCookie = await cookieNamed(
    developmentPage,
    'qianshu_session_dev',
  )
  assert.equal(developmentCookie?.httpOnly, true)
  assert.equal(developmentCookie?.secure, false)
  assert.equal(developmentCookie?.sameSite, 'Strict')
  assert.ok(developmentCookie?.expires > Date.now() / 1_000 + 20 * 24 * 60 * 60)
  const developmentLogout = await developmentPage.evaluate(
    apiExpression('/api/auth/logout', 'POST', {}),
  )
  assert.equal(developmentLogout.status, 204)
  assert.equal(await cookieNamed(developmentPage, 'qianshu_session_dev'), undefined)
  developmentPage.close()

  const primaryPage = await browser.newPage()
  await primaryPage.addScriptOnNewDocument(`
    localStorage.setItem('token', 'legacy-sensitive-value')
    localStorage.setItem('qsdms_proappAccount', '{"token":"legacy"}')
    sessionStorage.setItem('account', 'legacy-account')
  `)
  await primaryPage.navigate(`${configuration.baseUrl}/`)
  await waitForAuthState(primaryPage, 'anonymous')
  const storageState = await primaryPage.evaluate(`({
    token: localStorage.getItem('token'),
    account: sessionStorage.getItem('account'),
    appAccount: localStorage.getItem('qsdms_proappAccount'),
  })`)
  assert.deepEqual(storageState, { account: null, appAccount: null, token: null })

  const htmlResponse = await primaryPage.evaluate(`(async () => {
    const response = await fetch('/', { cache: 'reload' })
    return {
      cacheControl: response.headers.get('cache-control'),
      html: await response.text(),
      status: response.status,
    }
  })()`)
  assert.equal(htmlResponse.status, 200)
  assert.equal(htmlResponse.cacheControl, 'no-cache, must-revalidate')
  const hashedAsset = (htmlResponse.html.match(/\/assets\/[^"'\s]+/gu) ?? [])
    .find((candidate) => {
      const fileName = candidate.split('/').at(-1)
      const extensionIndex = fileName?.lastIndexOf('.') ?? -1
      const hashSeparatorIndex = fileName?.lastIndexOf('-', extensionIndex) ?? -1
      const extension = fileName?.slice(extensionIndex + 1)
      const hash = fileName?.slice(hashSeparatorIndex + 1, extensionIndex) ?? ''
      return (extension === 'js' || extension === 'css')
        && hashSeparatorIndex > 0
        && /^[\w-]{8,}$/u.test(hash)
    })
  assert.equal(typeof hashedAsset, 'string')
  const assetCacheControl = await primaryPage.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(hashedAsset)}, { cache: 'reload' })
    return response.headers.get('cache-control')
  })()`)
  assert.equal(assetCacheControl, 'public, max-age=31536000, immutable')

  await loginThroughUi(primaryPage, configuration)
  const authenticated = await primaryPage.evaluate(storeSnapshotExpression())
  assert.deepEqual(authenticated, {
    state: 'authenticated',
    username: configuration.username,
  })
  const productionCookie = await cookieNamed(
    primaryPage,
    '__Host-qianshu_session',
  )
  assert.equal(productionCookie?.httpOnly, true)
  assert.equal(productionCookie?.secure, true)
  assert.equal(productionCookie?.sameSite, 'Strict')
  assert.equal(productionCookie?.path, '/')

  const limitedUser = await primaryPage.evaluate(apiExpression(
    '/api/users',
    'POST',
    {
      displayName: 'Browser Limited User',
      mustChangePassword: true,
      password: limitedCredentials.password,
      username: limitedCredentials.username,
    },
  ))
  assert.equal(limitedUser.status, 201)
  assert.equal(limitedUser.cacheControl, 'private, no-store')
  assert.equal(limitedUser.body?.username, limitedCredentials.username)
  assert.equal(limitedUser.body?.mustChangePassword, true)
  assert.equal(
    JSON.stringify(limitedUser.body).includes(limitedCredentials.password),
    false,
  )

  const secondaryPage = await browser.newPage()
  let secondaryMeRequests = 0
  secondaryPage.on('Network.requestWillBeSent', ({ request }) => {
    if (request?.url === `${configuration.baseUrl}/api/auth/me`) {
      secondaryMeRequests += 1
    }
  })
  await secondaryPage.navigate(`${configuration.baseUrl}/`)
  await waitForAuthState(secondaryPage, 'authenticated')
  secondaryMeRequests = 0
  await primaryPage.evaluate(storeMethodExpression('logout'))
  await waitForAuthState(primaryPage, 'anonymous')
  await waitForAuthState(secondaryPage, 'anonymous')
  await secondaryPage.waitFor(`location.hash.startsWith('#/login')`)
  assert.ok(secondaryMeRequests >= 1 && secondaryMeRequests <= 2)

  await primaryPage.evaluate(storeMethodExpression('login', {
    password: configuration.password,
    username: configuration.username,
  }))
  await waitForAuthState(primaryPage, 'authenticated')
  await waitForAuthState(secondaryPage, 'authenticated')
  await secondaryPage.waitFor(`(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const pinia = vue?.config?.globalProperties?.$pinia
    const routeStore = pinia?._s?.get('appRoute')
    const menuStore = pinia?._s?.get('appMenu')
    const router = vue?.config?.globalProperties?.$router
    return !location.hash.startsWith('#/login')
      && routeStore?.isGenerate === true
      && menuStore?.sidebarMenus?.length > 0
      && router?.currentRoute?.value?.name !== 'login'
      && document.body.innerText.includes('系统管理')
  })()`)

  // 模拟同一用户的 Session 轮换先清空身份域；随后服务端广播重新验证必须
  // 注册动态路由、重建菜单并恢复当前业务 Shell，而不是等待手动刷新。
  await secondaryPage.navigate(appRouteUrl(configuration.baseUrl, '/system/users'))
  await secondaryPage.waitFor(`document.body.innerText.includes('用户管理')`)
  await secondaryPage.evaluate(authStoreExpression(`
    const rotated = JSON.parse(JSON.stringify(store.authContext))
    rotated.session.createdAt = '2099-01-01T00:00:00.000Z'
    store.applyAuthContext(rotated)
    return true
  `))
  assert.equal(await secondaryPage.evaluate(`(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const pinia = vue?.config?.globalProperties?.$pinia
    const routeStore = pinia?._s?.get('appRoute')
    const menuStore = pinia?._s?.get('appMenu')
    const router = vue?.config?.globalProperties?.$router
    return routeStore?.isGenerate === false
      && menuStore?.sidebarMenus?.length === 0
      && router?.hasRoute?.('systemUsers') === false
  })()`), true)
  await primaryPage.evaluate(`(() => {
    const channel = new BroadcastChannel('qianshu-auth-v1')
    channel.postMessage({ type: 'AUTH_CONTEXT_CHANGED' })
    channel.close()
    return true
  })()`)
  await secondaryPage.waitFor(`(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const pinia = vue?.config?.globalProperties?.$pinia
    const routeStore = pinia?._s?.get('appRoute')
    const menuStore = pinia?._s?.get('appMenu')
    const router = vue?.config?.globalProperties?.$router
    return location.hash.startsWith('#/system/users')
      && routeStore?.isGenerate === true
      && menuStore?.sidebarMenus?.length > 0
      && router?.hasRoute?.('systemUsers') === true
      && document.body.innerText.includes('用户管理')
  })()`)
  secondaryMeRequests = 0
  await primaryPage.evaluate(`(() => {
    const channel = new BroadcastChannel('qianshu-auth-v1')
    for (const type of [
      'AUTH_INVALIDATED',
      'AUTH_CONTEXT_CHANGED',
      'AUTH_INVALIDATED',
      'AUTH_CONTEXT_CHANGED',
    ]) channel.postMessage({ type })
    channel.close()
    return true
  })()`)
  await secondaryPage.waitFor(`(${storeSnapshotExpression()})?.state === 'authenticated'`)
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.ok(secondaryMeRequests >= 1 && secondaryMeRequests <= 2)
  secondaryPage.close()

  primaryPage.close()
  await browser.close()
  browser = null
  browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: configuration.profileDirectory,
  })
  const restartedPage = await browser.newPage()
  await restartedPage.addScriptOnNewDocument(`
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
    })
  `)
  // 重启后直接恢复受保护深链接；页面内容和最终路由共同证明首轮 Router guard 已完成。
  await restartedPage.navigate(appRouteUrl(configuration.baseUrl, '/system/users'))
  await waitForAuthState(restartedPage, 'authenticated')
  assert.deepEqual(await restartedPage.evaluate(storeSnapshotExpression()), {
    state: 'authenticated',
    username: configuration.username,
  })

  // 先通过真实管理页发起业务请求，再在 Store 不知情时从服务端撤销 Cookie；
  // 随后的“查询”必须由 Axios 统一 401 拦截器清理身份并导航登录。
  await restartedPage.waitFor(`(() => {
    const router = document.querySelector('#app')?.__vue_app__
      ?.config?.globalProperties?.$router
    return router?.currentRoute?.value?.name === 'systemUsers'
      && router.currentRoute.value.fullPath === '/system/users'
      && document.body.innerText.includes('用户管理')
  })()`).catch(async () => {
    // 诊断只保留路由结构和固定页面标记，禁止把用户名、响应体或其他身份数据写入 CI 日志。
    const diagnostic = await restartedPage.evaluate(`(() => {
      const vue = document.querySelector('#app')?.__vue_app__
      const router = vue?.config?.globalProperties?.$router
      const current = router?.currentRoute?.value
      const body = document.body.innerText
      return {
        hasSystemUsersRoute: router?.hasRoute?.('systemUsers') === true,
        matchedRouteNames: current?.matched?.map(route => String(route.name ?? '')) ?? [],
        matchedRoutePaths: current?.matched?.map(route => route.path) ?? [],
        path: current?.fullPath ?? '',
        routeName: String(current?.name ?? ''),
        systemRoutes: router?.getRoutes?.()
          ?.filter(route => route.path.includes('/system'))
          ?.map(route => ({ name: String(route.name ?? ''), path: route.path })) ?? [],
        showsForbidden: body.includes('无权访问'),
        showsNotFound: body.includes('找不到页面'),
      }
    })()`)
    throw new Error(`User management route unavailable: ${JSON.stringify(diagnostic)}`)
  })
  await restartedPage.setViewport(390, 844, true)
  await restartedPage.waitFor(`(() => (
    [...document.querySelectorAll('[data-testid="user-card"]')]
      .some(card => card.getClientRects().length > 0)
    && ![...document.querySelectorAll('[data-testid="user-table"]')]
      .some(table => table.getClientRects().length > 0)
    && [...document.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === '操作'
      && button.getClientRects().length > 0
    ))
  ))()`)
  await clickVisibleButton(restartedPage, '操作')
  await restartedPage.waitFor(`document.body.innerText.includes('用户操作 ·')`)
  assert.equal(
    await restartedPage.evaluate(`(() => (
      document.body.innerText.includes('分配角色')
      && !document.body.innerText.includes('设置或重置密码')
      && !document.body.innerText.includes('禁用用户')
    ))()`),
    true,
  )
  await restartedPage.evaluate(`(() => {
    const drawerContent = document.querySelector('[data-testid="user-actions-drawer"]')
    const drawer = drawerContent?.closest('[role="dialog"]')
    if (!drawer || drawer.getClientRects().length === 0) {
      throw new Error('drawer unavailable')
    }
    window.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'Escape',
      key: 'Escape',
    }))
    return true
  })()`)
  await restartedPage.waitFor(`![...document.querySelectorAll('[data-testid="user-actions-drawer"]')]
    .some(content => content.getClientRects().length > 0)`)
  await restartedPage.setViewport(1280, 800, false)
  const detachedLogout = await restartedPage.evaluate(
    apiExpression('/api/auth/logout', 'POST', {}),
  )
  assert.equal(detachedLogout.status, 204)
  let businessUnauthorizedResponses = 0
  const removeBusinessResponseListener = restartedPage.on(
    'Network.responseReceived',
    ({ response }) => {
      if (
        response?.url.startsWith(`${configuration.baseUrl}/api/users`)
        && response.status === 401
      ) {
        businessUnauthorizedResponses += 1
      }
    },
  )
  await clickVisibleButton(restartedPage, '查询')
  await waitForAuthState(restartedPage, 'anonymous')
  await restartedPage.waitFor(`location.hash.startsWith('#/login')`)
  removeBusinessResponseListener()
  assert.equal(businessUnauthorizedResponses, 1)
  assert.equal(await cookieNamed(restartedPage, '__Host-qianshu_session'), undefined)

  // 制造 mutation transport unknown：一个 mutation 前开始的 passive /me 被悬停，
  // login 仍悬停时只能观察到旧 passive /me；注入 transport failure 后必须出现
  // 第二个 requestId。这样直接证明 fresh /me 未复用旧请求，不依赖 CDP 不同
  // 请求或不同 domain 的事件到达顺序。
  const pausedMeRequestIds = []
  const removePausedMeListener = restartedPage.on(
    'Fetch.requestPaused',
    (event) => {
      if (event.request?.url === `${configuration.baseUrl}/api/auth/me`) {
        pausedMeRequestIds.push(event.requestId)
      }
    },
  )
  await restartedPage.enableRequestInterception([
    { urlPattern: '*api/auth/login*' },
    { urlPattern: '*api/auth/me*' },
  ])
  let passiveRequest
  try {
    const passivePaused = restartedPage.waitForEvent(
      'Fetch.requestPaused',
      event => event.request?.url === `${configuration.baseUrl}/api/auth/me`,
    )
    await restartedPage.evaluate(authStoreExpression(`
      void store.revalidateAuth().catch(() => undefined)
      return true
    `))
    passiveRequest = await passivePaused
    assert.deepEqual(pausedMeRequestIds, [passiveRequest.requestId])

    const loginPaused = restartedPage.waitForEvent(
      'Fetch.requestPaused',
      event => event.request?.url === `${configuration.baseUrl}/api/auth/login`,
    )
    const unknownCredentials = JSON.stringify({
      password: configuration.password,
      username: configuration.username,
    })
    await restartedPage.evaluate(authStoreExpression(`
      globalThis.__qianshuBrowserUnknownDone = false
      void store.login(${unknownCredentials})
        .catch(() => undefined)
        .finally(() => { globalThis.__qianshuBrowserUnknownDone = true })
      return true
    `))
    const loginRequest = await loginPaused
    assert.deepEqual(pausedMeRequestIds, [passiveRequest.requestId])
    assert.equal(
      await restartedPage.evaluate(
        'globalThis.__qianshuBrowserUnknownDone === false',
      ),
      true,
    )
    const freshMePaused = restartedPage.waitForEvent(
      'Fetch.requestPaused',
      event => (
        event.request?.url === `${configuration.baseUrl}/api/auth/me`
        && event.requestId !== passiveRequest.requestId
      ),
    )
    await restartedPage.failInterceptedRequest(loginRequest.requestId)
    const freshMeRequest = await freshMePaused
    assert.notEqual(freshMeRequest.requestId, passiveRequest.requestId)
    assert.deepEqual(pausedMeRequestIds, [
      passiveRequest.requestId,
      freshMeRequest.requestId,
    ])
    assert.equal(
      await restartedPage.evaluate(
        'globalThis.__qianshuBrowserUnknownDone === false',
      ),
      true,
    )
    await restartedPage.continueInterceptedRequest(freshMeRequest.requestId)
    await restartedPage.waitFor('globalThis.__qianshuBrowserUnknownDone === true')
  }
  finally {
    if (passiveRequest !== undefined) {
      await restartedPage.failInterceptedRequest(passiveRequest.requestId)
        .catch(() => undefined)
    }
    await restartedPage.disableRequestInterception().catch(() => undefined)
    removePausedMeListener()
  }
  await waitForAuthState(restartedPage, 'anonymous')

  // 无角色用户首次登录必须停留在不可关闭的强制改密 Modal，且不挂载业务 Shell。
  await loginThroughUi(
    restartedPage,
    limitedCredentials,
    'password_change_required',
  )
  await restartedPage.waitFor(`document.body.innerText.includes('请先修改密码')`)
  const forcedModal = await restartedPage.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('请先修改密码'))
    const closeButtons = [...(dialog?.querySelectorAll('[aria-label="Close"], button') ?? [])]
      .filter(candidate => candidate.getAttribute('aria-label') === 'Close'
        || candidate.textContent?.trim() === 'Close')
    return {
      closeButtons: closeButtons.length,
      currentPasswordInputs: document.querySelectorAll('input[autocomplete="current-password"]').length,
      newPasswordInputs: document.querySelectorAll('input[autocomplete="new-password"]').length,
      showsBusinessMenu: document.body.innerText.includes('系统管理'),
      showsExit: document.body.innerText.includes('退出登录'),
    }
  })()`)
  assert.deepEqual(forcedModal, {
    closeButtons: 0,
    currentPasswordInputs: 0,
    newPasswordInputs: 2,
    showsBusinessMenu: false,
    showsExit: true,
  })
  await restartedPage.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'Escape',
      key: 'Escape',
    }))
    return true
  })()`)
  await new Promise(resolve => setTimeout(resolve, 100))
  await waitForAuthState(restartedPage, 'password_change_required')
  await fillPasswordModal(restartedPage, { newPassword: forcedPassword })
  await clickVisibleButton(restartedPage, '修改密码')
  await waitForAuthState(restartedPage, 'authenticated')
  assert.equal(
    await restartedPage.evaluate(
      `(${storeSnapshotExpression()})?.username === ${JSON.stringify(limitedCredentials.username)}`,
    ),
    true,
  )

  // 前端不展示管理菜单只是体验层；同一身份直接请求管理 API 仍必须由 Server 403。
  await restartedPage.waitFor(`document.body.innerText.includes(${JSON.stringify(limitedCredentials.username)})`)
  assert.equal(
    await restartedPage.evaluate(`document.body.innerText.includes('用户管理')`),
    false,
  )
  const forbiddenUsers = await restartedPage.evaluate(
    apiExpression('/api/users', 'GET'),
  )
  assert.equal(forbiddenUsers.status, 403)
  assert.equal(forbiddenUsers.cacheControl, 'private, no-store')
  assert.equal(forbiddenUsers.body?.code, 'FORBIDDEN')
  await waitForAuthState(restartedPage, 'authenticated')

  // 无管理权限用户通过账户菜单维护本人资料；真实 GET/PATCH、刷新持久化、
  // 头像失败 fallback、移动端单列与暗色主题必须同时成立。
  const profileRequests = []
  const profileApiUrl = `${configuration.baseUrl}/api/profile`
  const removeProfileRequestListener = restartedPage.on(
    'Network.requestWillBeSent',
    ({ request }) => {
      if (request?.url === profileApiUrl) {
        profileRequests.push({ method: request.method, postData: request.postData })
      }
    },
  )
  const profileValues = {
    email: 'browser.limited@example.com',
    tel: '+8613800138000',
    url: `${configuration.baseUrl}/missing-profile-avatar.png`,
  }
  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await clickVisibleText(restartedPage, '个人资料')
  await restartedPage.waitFor(`(() => (
    document.querySelector('input[autocomplete="email"]')?.getClientRects().length > 0
    && document.querySelector('input[autocomplete="tel"]')?.getClientRects().length > 0
    && document.querySelector('input[autocomplete="url"]')?.getClientRects().length > 0
  ))()`)
  await fillVisibleProfileForm(restartedPage, profileValues)
  await clickVisibleButton(restartedPage, '保存修改')
  await restartedPage.waitFor(`(() => ![...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('个人资料')))()`)
  await restartedPage.waitFor(authStoreExpression(`
    return store.profile?.email === ${JSON.stringify(profileValues.email)}
      && store.profile?.mobileE164 === ${JSON.stringify(profileValues.tel)}
      && store.profile?.avatarUrl === ${JSON.stringify(profileValues.url)}
  `))
  assert.equal(
    profileRequests.filter(request => request.method === 'PATCH').length,
    1,
  )
  const patchRequest = profileRequests.find(request => request.method === 'PATCH')
  const serializedPatch = patchRequest?.postData ?? ''
  assert.equal(serializedPatch.includes(profileValues.email), true)
  assert.equal(serializedPatch.includes(profileValues.tel), true)
  assert.equal(serializedPatch.includes(profileValues.url), true)

  const persistedProfile = await restartedPage.evaluate(
    apiExpression('/api/profile', 'GET'),
  )
  assert.equal(persistedProfile.status, 200)
  assert.equal(persistedProfile.cacheControl, 'private, no-store')
  assert.deepEqual(Object.keys(persistedProfile.body).sort(), [
    'avatarUrl',
    'createdAt',
    'email',
    'mobileE164',
    'updatedAt',
    'userId',
  ])

  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await clickVisibleText(restartedPage, '个人资料')
  await restartedPage.waitFor(`document.querySelector('input[autocomplete="email"]')?.value === ${JSON.stringify(profileValues.email)}`)
  await restartedPage.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('个人资料'))
    const fallback = dialog?.querySelector('[data-slot="avatar-fallback"]')
    return fallback?.getClientRects().length > 0
  })()`)

  await restartedPage.setViewport(390, 844, true)
  const mobileProfileLayout = await restartedPage.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('个人资料'))
    const grid = dialog?.querySelector('.grid-cols-1')
    if (!dialog || !grid) return null
    const columns = getComputedStyle(grid).gridTemplateColumns
      .split(' ')
      .filter(Boolean)
    return {
      columns: columns.length,
      dialogWidth: dialog.getBoundingClientRect().width,
      viewportWidth: innerWidth,
      documentFits: document.documentElement.scrollWidth <= innerWidth,
    }
  })()`)
  assert.equal(mobileProfileLayout?.columns, 1)
  assert.ok(mobileProfileLayout?.dialogWidth <= mobileProfileLayout?.viewportWidth)
  assert.equal(mobileProfileLayout?.documentFits, true)

  const lightProfileTheme = await restartedPage.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('个人资料'))
    if (!dialog) return null
    const style = getComputedStyle(dialog)
    return {
      background: style.backgroundColor,
      foreground: style.color,
    }
  })()`)

  await restartedPage.evaluate(`(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const store = vue?.config?.globalProperties?.$pinia?._s?.get('appSettings')
    store?.setColorScheme('dark')
    return true
  })()`)
  await restartedPage.waitFor(`document.documentElement.classList.contains('dark')`)
  const darkProfileTheme = await restartedPage.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('个人资料'))
    if (!dialog) return null
    const style = getComputedStyle(dialog)
    return {
      background: style.backgroundColor,
      foreground: style.color,
    }
  })()`)
  assert.notEqual(darkProfileTheme?.background, 'rgba(0, 0, 0, 0)')
  assert.notEqual(darkProfileTheme?.background, darkProfileTheme?.foreground)
  assert.notEqual(darkProfileTheme?.background, lightProfileTheme?.background)
  await restartedPage.evaluate(`(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    vue?.config?.globalProperties?.$pinia?._s?.get('appSettings')?.setColorScheme('light')
    return true
  })()`)
  await clickVisibleDialogButton(restartedPage, '个人资料', '取消')
  await restartedPage.waitFor(`(() => ![...document.querySelectorAll('[role="dialog"]')]
    .some(candidate => candidate.getClientRects().length > 0
      && candidate.textContent?.includes('个人资料')))()`)
  await restartedPage.setViewport(1280, 800, false)

  await restartedPage.navigate(appRouteUrl(configuration.baseUrl, '/'))
  await waitForAuthState(restartedPage, 'authenticated')
  await restartedPage.waitFor(authStoreExpression(`
    return store.profileState === 'ready'
      && store.profile?.email === ${JSON.stringify(profileValues.email)}
  `))
  removeProfileRequestListener()

  // 两个启用 BroadcastChannel 的真实标签页只交换无数据事件；接收端仅重新 GET
  // Profile，不应重跑 /auth/me，也不能在消息中夹带任何资料值。
  const profilePrimaryPage = await browser.newPage()
  const profileSecondaryPage = await browser.newPage()
  await profilePrimaryPage.addScriptOnNewDocument(`
    const NativeBroadcastChannel = globalThis.BroadcastChannel
    globalThis.__qianshuProfileMessages = []
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: class RecordingBroadcastChannel extends NativeBroadcastChannel {
        postMessage(value) {
          globalThis.__qianshuProfileMessages.push(value)
          return super.postMessage(value)
        }
      },
    })
  `)
  let profileSecondaryGets = 0
  let profileSecondaryMeGets = 0
  const removeProfileSecondaryListener = profileSecondaryPage.on(
    'Network.requestWillBeSent',
    ({ request }) => {
      if (request?.method !== 'GET') {
        return
      }
      if (request.url === profileApiUrl) {
        profileSecondaryGets += 1
      }
      if (request.url === `${configuration.baseUrl}/api/auth/me`) {
        profileSecondaryMeGets += 1
      }
    },
  )
  await profilePrimaryPage.navigate(appRouteUrl(configuration.baseUrl, '/'))
  await profileSecondaryPage.navigate(appRouteUrl(configuration.baseUrl, '/'))
  await waitForAuthState(profilePrimaryPage, 'authenticated')
  await waitForAuthState(profileSecondaryPage, 'authenticated')
  await profilePrimaryPage.waitFor(authStoreExpression(`
    return store.profileState === 'ready'
  `))
  await profileSecondaryPage.waitFor(authStoreExpression(`
    return store.profileState === 'ready'
  `))
  profileSecondaryGets = 0
  profileSecondaryMeGets = 0
  const synchronizedEmail = 'browser.limited.sync@example.com'
  await profilePrimaryPage.evaluate(storeMethodExpression('updateProfile', {
    email: synchronizedEmail,
  }))
  await profileSecondaryPage.waitFor(authStoreExpression(`
    return store.profile?.email === ${JSON.stringify(synchronizedEmail)}
  `))
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(profileSecondaryGets, 1)
  assert.equal(profileSecondaryMeGets, 0)
  const profileMessages = await profilePrimaryPage.evaluate(
    'globalThis.__qianshuProfileMessages',
  )
  assert.deepEqual(profileMessages, [{ type: 'PROFILE_CHANGED' }])
  assert.equal(
    JSON.stringify(profileMessages).includes(profileValues.tel)
    || JSON.stringify(profileMessages).includes(profileValues.url)
    || JSON.stringify(profileMessages).includes(synchronizedEmail),
    false,
  )
  removeProfileSecondaryListener()
  profilePrimaryPage.close()
  profileSecondaryPage.close()
  await restartedPage.bringToFront()

  // 普通主动改密从真实账户菜单打开可关闭 Modal，要求当前密码且不改变路由。
  const routeBeforeActivePasswordChange = await restartedPage.evaluate(
    'location.hash',
  )
  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await clickVisibleText(restartedPage, '修改密码')
  await restartedPage.waitFor(`(() => (
    [...document.querySelectorAll('[role="dialog"]')].some((modal) => (
      modal.getClientRects().length > 0
      && modal.getAttribute('aria-label') === '修改密码'
      && modal.querySelector('input[autocomplete="current-password"]')?.getClientRects().length > 0
    ))
  ))()`)
  const activeModal = await restartedPage.evaluate(`(() => {
    const modal = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.getAttribute('aria-label') === '修改密码')
    return {
      currentPasswordInputs: [...(modal?.querySelectorAll('input[autocomplete="current-password"]') ?? [])]
        .filter(input => input.getClientRects().length > 0).length,
      newPasswordInputs: [...(modal?.querySelectorAll('input[autocomplete="new-password"]') ?? [])]
        .filter(input => input.getClientRects().length > 0).length,
    }
  })()`)
  assert.deepEqual(activeModal, {
    currentPasswordInputs: 1,
    newPasswordInputs: 2,
  })
  await fillPasswordModal(restartedPage, {
    currentPassword: forcedPassword,
    newPassword: activePassword,
  })
  const activePasswordResponse = restartedPage.waitForEvent(
    'Network.responseReceived',
    event => event.response?.url === `${configuration.baseUrl}/api/auth/password/change`,
  )
  await clickVisibleButton(restartedPage, '修改密码')
  assert.equal((await activePasswordResponse).response?.status, 200)
  await waitForAuthState(restartedPage, 'authenticated')
  await restartedPage.waitFor(`(() => (
    ![...document.querySelectorAll('[role="dialog"]')].some((modal) => (
      modal.getClientRects().length > 0
      && modal.getAttribute('aria-label') === '修改密码'
    ))
  ))()`)
  assert.equal(
    await restartedPage.evaluate('location.hash'),
    routeBeforeActivePasswordChange,
  )

  // 账户菜单只保留一个退出入口，由同一弹窗明确选择当前 Session 或全部 Session。
  const logoutRequestUrls = []
  const currentLogoutUrl = `${configuration.baseUrl}/api/auth/logout`
  const allLogoutUrl = `${configuration.baseUrl}/api/auth/logout-all`
  restartedPage.on('Network.requestWillBeSent', ({ request }) => {
    if (request?.method === 'POST' && [currentLogoutUrl, allLogoutUrl].includes(request.url)) {
      logoutRequestUrls.push(request.url)
    }
  })
  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await restartedPage.waitFor(`(() => [...document.querySelectorAll('[role="menuitem"]')].some((item) => (
    item.textContent?.trim() === '退出登录'
    && item.getClientRects().length > 0
  )))()`)
  const logoutMenu = await restartedPage.evaluate(`(() => {
    const labels = [...document.querySelectorAll('[role="menuitem"]')]
      .filter(item => item.getClientRects().length > 0)
      .map(item => item.textContent?.trim())
    return {
      logoutEntryCount: labels.filter(label => label === '退出登录').length,
      showsLegacyLogoutAll: labels.includes('退出全部登录'),
    }
  })()`)
  assert.deepEqual(logoutMenu, {
    logoutEntryCount: 1,
    showsLegacyLogoutAll: false,
  })
  await clickVisibleText(restartedPage, '退出登录')
  await restartedPage.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some((dialog) => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes('退出当前登录')
    && dialog.textContent?.includes('退出所有登录')
  )))()`)
  const logoutDialog = await restartedPage.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0)
    const text = dialog?.textContent ?? ''
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      .filter(button => button.getClientRects().length > 0)
      .map(button => button.textContent?.trim())
    return {
      explainsCurrent: text.includes('只退出当前浏览器的这次登录，其他浏览器或电脑仍保持登录'),
      explainsAll: text.includes('撤销该账号的所有登录，包括当前浏览器、其他浏览器和其他电脑'),
      hasCancel: buttons.includes('取消'),
      hasCurrent: buttons.includes('退出当前登录'),
      hasAll: buttons.includes('退出所有登录'),
    }
  })()`)
  assert.deepEqual(logoutDialog, {
    explainsCurrent: true,
    explainsAll: true,
    hasCancel: true,
    hasCurrent: true,
    hasAll: true,
  })
  await clickVisibleButton(restartedPage, '取消')
  await restartedPage.waitFor(`(() => ![...document.querySelectorAll('[role="dialog"]')].some((dialog) => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes('退出当前登录')
  )))()`)
  await waitForAuthState(restartedPage, 'authenticated')

  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await clickVisibleText(restartedPage, '退出登录')
  await clickVisibleButton(restartedPage, '退出当前登录')
  await waitForAuthState(restartedPage, 'anonymous')
  assert.equal(await cookieNamed(restartedPage, '__Host-qianshu_session'), undefined)
  assert.deepEqual(logoutRequestUrls, [currentLogoutUrl])

  await loginThroughUi(restartedPage, {
    ...configuration,
    password: activePassword,
    username: limitedCredentials.username,
  })
  await clickVisibleButtonContaining(restartedPage, limitedCredentials.username)
  await clickVisibleText(restartedPage, '退出登录')
  await clickVisibleButton(restartedPage, '退出所有登录')
  await waitForAuthState(restartedPage, 'anonymous')
  assert.equal(await cookieNamed(restartedPage, '__Host-qianshu_session'), undefined)
  assert.deepEqual(logoutRequestUrls, [currentLogoutUrl, allLogoutUrl])

  // 首屏 /me 网络故障会中止原导航；重试得到确定 401 后必须显式进入登录页。
  const unavailablePage = await browser.newPage()
  await unavailablePage.enableRequestInterception([
    { urlPattern: '*api/auth/me*' },
  ])
  let unavailableFailures = 0
  const stopFailingMe = unavailablePage.on('Fetch.requestPaused', (event) => {
    if (event.request?.url === `${configuration.baseUrl}/api/auth/me`) {
      unavailableFailures += 1
      void unavailablePage.failInterceptedRequest(event.requestId)
        .catch(() => undefined)
    }
  })
  await unavailablePage.navigate(appRouteUrl(configuration.baseUrl, '/system/users'))
  await waitForAuthState(unavailablePage, 'unavailable')
  assert.ok(unavailableFailures >= 1)
  stopFailingMe()
  await unavailablePage.disableRequestInterception()
  await clickVisibleButton(unavailablePage, '重新检查身份')
  await waitForAuthState(unavailablePage, 'anonymous')
  await unavailablePage.waitFor(`location.hash.startsWith('#/login')`)
  assert.equal(
    await unavailablePage.evaluate(
      `new URLSearchParams(location.hash.split('?')[1] ?? '').get('redirect') === '/system/users'`,
    ),
    true,
  )
  unavailablePage.close()
  restartedPage.close()
})
