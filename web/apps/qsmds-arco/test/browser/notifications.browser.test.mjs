/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'

function readConfiguration(environment) {
  const baseUrl = environment.QIANSHU_BROWSER_AUTH_BASE_URL
  const chromeExecutable = environment.QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE
  const profileDirectory = environment.QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY
  const username = environment.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME
  const password = environment.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD
  const passwordLength = typeof password === 'string'
    ? Array.from(password.normalize('NFC')).length
    : 0
  let base
  try {
    base = new URL(baseUrl)
  }
  catch {
    throw new Error('Notification browser test configuration is invalid')
  }
  if (
    base.protocol !== 'https:'
    || base.hostname !== '127.0.0.1'
    || typeof chromeExecutable !== 'string'
    || !path.isAbsolute(chromeExecutable)
    || typeof profileDirectory !== 'string'
    || !path.isAbsolute(profileDirectory)
    || typeof username !== 'string'
    || typeof password !== 'string'
    || passwordLength < 8
    || passwordLength > 20
  ) {
    throw new Error('Notification browser test configuration is invalid')
  }
  return {
    baseUrl: base.origin,
    chromeExecutable,
    password,
    profileDirectory,
    username,
  }
}

function cursorBefore(createdAt) {
  return Buffer.from(JSON.stringify({
    createdAt: new Date(new Date(createdAt).getTime() - 1).toISOString(),
    id: '00000000-0000-0000-0000-000000000000',
  })).toString('base64url')
}

function leaderExpression() {
  return `(() => {
    const root = document.querySelector('#app')
    const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia
    const store = pinia?._s?.get('appNotification')
    return typeof store?.isLeader === 'boolean' ? store.isLeader : null
  })()`
}

function desktopEnabledExpression() {
  return `(() => {
    const root = document.querySelector('#app')
    const pinia = root?.__vue_app__?.config?.globalProperties?.$pinia
    const store = pinia?._s?.get('appNotification')
    return typeof store?.desktopEnabled === 'boolean' ? store.desktopEnabled : null
  })()`
}

/**
 * 让桌面轮询的首个 cursor 落在夹具之前，后续轮询才能把夹具当作“新消息”。
 * 只在测试进程内改写响应，不触碰后端或数据库。
 */
async function interceptFirstNewItems(page, fixtureCreatedAt) {
  let resolveIntercepted
  let rejectIntercepted
  const intercepted = new Promise((resolve, reject) => {
    resolveIntercepted = resolve
    rejectIntercepted = reject
  })
  const unsubscribe = page.on('Fetch.requestPaused', (params) => {
    void (async () => {
      try {
        if (params.responseStatusCode !== 200) {
          throw new Error('Notification new-items response status was not 200')
        }
        const responseBody = await page.connection.send('Fetch.getResponseBody', {
          requestId: params.requestId,
        })
        const text = responseBody.base64Encoded
          ? Buffer.from(responseBody.body, 'base64').toString('utf8')
          : responseBody.body
        const payload = JSON.parse(text)
        payload.nextCursor = cursorBefore(fixtureCreatedAt)
        const responseHeaders = (params.responseHeaders ?? []).filter(({ name }) => (
          !['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())
        ))
        await page.connection.send('Fetch.fulfillRequest', {
          body: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
          requestId: params.requestId,
          responseCode: params.responseStatusCode,
          responseHeaders,
        })
        unsubscribe()
        await page.disableRequestInterception()
        resolveIntercepted()
      }
      catch (error) {
        rejectIntercepted(error)
      }
    })()
  })
  await page.enableRequestInterception([{
    requestStage: 'Response',
    urlPattern: '*inbox/new*',
  }])
  return { intercepted }
}

function apiExpression(pathname, method = 'GET', body = undefined) {
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
    const responseBody = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : null
    return { body: responseBody, status: response.status }
  })()`
}

async function clickVisibleButton(page, text) {
  const serialized = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some((button) => (
    button.textContent?.trim() === ${serialized}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (
      candidate.textContent?.trim() === ${serialized}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

async function clickVisibleAriaButton(page, label) {
  const serialized = JSON.stringify(label)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some((button) => (
    button.getAttribute('aria-label') === ${serialized}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((candidate) => (
      candidate.getAttribute('aria-label') === ${serialized}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible aria button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

test('通知页、铃铛、隐藏页桌面通知与多标签选主可用', {
  timeout: 120_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: configuration.profileDirectory,
  })
  t.after(async () => {
    await browser.close()
  })

  const page = await browser.newPage()
  await page.setViewport(1280, 900)
  await page.addScriptOnNewDocument(`
    window.__browserNotifications = []
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      constructor(title, options) {
        this.body = options?.body ?? null
        this.closed = false
        this.onclick = null
        this.title = title
        window.__browserNotifications.push(this)
      }
      close() {
        this.closed = true
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: FakeNotification,
    })
  `)

  await page.navigate(`${configuration.baseUrl}/`)
  const login = await page.evaluate(apiExpression('/api/auth/login', 'POST', {
    password: configuration.password,
    username: configuration.username,
  }))
  assert.equal(login.status, 200)

  const target = new URL(configuration.baseUrl)
  target.searchParams.set('__notification_browser', String(Date.now()))
  target.hash = '/notifications'
  await page.navigate(target.toString())
  await page.waitFor(`document.body.innerText.includes('通知中心')`)
  const inbox = await page.evaluate(apiExpression('/api/notifications/me/inbox'))
  assert.equal(inbox.status, 200)
  assert.equal(inbox.body.items.length, 1)
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify('[Browser] 通知夹具')})`)

  await clickVisibleAriaButton(page, '通知')
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify('[Browser] 通知夹具')})`)
  await clickVisibleButton(page, '查看全部')
  await page.waitFor(`location.hash === '#/notifications' && document.body.innerText.includes(${JSON.stringify('[Browser] 通知夹具')})`)

  await clickVisibleButton(page, '查看')
  await page.waitFor(`document.body.innerText.includes('Browser 通知正文')`)
  await clickVisibleButton(page, '归档')
  await page.waitFor(`!document.body.innerText.includes(${JSON.stringify('[Browser] 通知夹具')})`)

  const archived = await page.evaluate(apiExpression('/api/notifications/me/inbox?status=archived'))
  assert.equal(archived.status, 200)
  assert.equal(archived.body.items.length, 1)

  // 桌面轮询测试需要一个未读、未归档的条目；把它恢复到可被 newItems 返回的状态。
  const fixtureId = inbox.body.items[0].id
  const fixtureCreatedAt = inbox.body.items[0].createdAt
  const unarchive = await page.evaluate(apiExpression(`/api/notifications/me/inbox/${fixtureId}/unarchive`, 'POST'))
  assert.equal(unarchive.status, 200)
  const unread = await page.evaluate(apiExpression(`/api/notifications/me/inbox/${fixtureId}/unread`, 'POST'))
  assert.equal(unread.status, 200)

  const interception = await interceptFirstNewItems(page, fixtureCreatedAt)
  const desktopSwitch = await page.evaluate(`(() => {
    const section = [...document.querySelectorAll('section')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes('桌面通知')
    ))
    const button = section?.querySelector('[role="switch"]') ?? section?.querySelector('button')
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(desktopSwitch, true)
  await page.waitFor(`window.__browserNotifications.some(item => item.title === '通知中心')`)
  await interception.intercepted
  await page.waitFor(`${leaderExpression()} === true`)

  // 第二个标签页共享登录态和桌面开关，但 Web Locks 应让它保持 follower。
  const secondPage = await browser.newPage()
  await secondPage.setViewport(1280, 900)
  await secondPage.addScriptOnNewDocument(`
    window.__browserNotifications = []
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      constructor(title, options) {
        this.body = options?.body ?? null
        this.closed = false
        this.onclick = null
        this.title = title
        window.__browserNotifications.push(this)
      }
      close() {
        this.closed = true
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: FakeNotification,
    })
  `)
  const secondTarget = new URL(configuration.baseUrl)
  secondTarget.searchParams.set('__notification_browser', String(Date.now() + 2))
  secondTarget.hash = '/notifications'
  await secondPage.navigate(secondTarget.toString())
  await secondPage.waitFor(`document.body.innerText.includes('通知中心')`)
  await secondPage.waitFor(`${desktopEnabledExpression()} === true`)
  await secondPage.waitFor(`${leaderExpression()} === false`)

  // 模拟页面失焦；下一次 30 秒轮询必须弹出夹具，点击后跳到详情。
  const hidden = await page.evaluate(`(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.hasFocus = () => false
    return document.visibilityState === 'hidden' && !document.hasFocus()
  })()`)
  assert.equal(hidden, true)
  await page.waitFor(
    `window.__browserNotifications.some(item => item.title === ${JSON.stringify('[Browser] 通知夹具')})`,
    45_000,
  )
  const notificationCounts = await Promise.all([
    page.evaluate('window.__browserNotifications.length'),
    secondPage.evaluate('window.__browserNotifications.length'),
  ])
  assert.equal(notificationCounts[0], 2)
  assert.equal(notificationCounts[1], 0)

  const clicked = await page.evaluate(`(() => {
    const item = window.__browserNotifications.find(candidate => (
      candidate.title === ${JSON.stringify('[Browser] 通知夹具')}
    ))
    if (!item || typeof item.onclick !== 'function') {
      return false
    }
    item.onclick()
    return true
  })()`)
  assert.equal(clicked, true)
  await page.waitFor(`location.hash === ${JSON.stringify(`#/notifications?id=${fixtureId}`)}`)
  await page.waitFor(`document.body.innerText.includes('Browser 通知正文')`)

  const deniedPage = await browser.newPage()
  await deniedPage.setViewport(1280, 900)
  await deniedPage.addScriptOnNewDocument(`
    class DeniedNotification {
      static permission = 'denied'
      static requestPermission = async () => 'denied'
      constructor() {
        this.close = () => {}
      }
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: DeniedNotification,
    })
  `)
  const deniedTarget = new URL(configuration.baseUrl)
  deniedTarget.searchParams.set('__notification_browser', String(Date.now() + 1))
  deniedTarget.hash = '/notifications'
  await deniedPage.navigate(deniedTarget.toString())
  await deniedPage.waitFor(`document.body.innerText.includes('桌面通知已被浏览器阻止')`)
})
