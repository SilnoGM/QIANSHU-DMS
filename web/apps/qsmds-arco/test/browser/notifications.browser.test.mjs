/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
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

test('通知页、铃铛与桌面通知开关可用', {
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
        window.__browserNotifications.push({ title, body: options?.body ?? null })
        this.close = () => {}
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
