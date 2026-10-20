/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'

const PRODUCT_NO = 'PRODUCT-MEDIA-BROWSER-001'
const IMAGE_FIXTURES = Object.freeze([
  ['browser-main.jpg', '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAAf//Z'],
  ['browser-detail.png', 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHElEQVQokWOoIBEwjGogAjAQowgZjGogBtA+lABjWWgQrlQ/lQAAAABJRU5ErkJggg=='],
  ['browser-side.webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoQABAAAUAmJaQAA3AA/twQAAA='],
  ['browser-package.webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoQABAAAUAmJaQAA3AA/twQAAA='],
])
const VIDEO_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAN1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAp90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAEAAABAAAAAAIXbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABwm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAYJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAHcQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAFAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAOGN0dHMAAAAAAAAABQAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAUAAAABAAAAKHN0c3oAAAAAAAAAAAAAAAUAAALKAAAADAAAAAwAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOlAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDEAAAAIZnJlZQAAAwJtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFGWIhAAz//7fMvgU1iXQdEJQhG/3AAAACEGaJGxCv/7AAAAACEGeQniF/8GBAAAACAGeYXRCv8SAAAAACAGeY2pCv8SB'
const ADDITIONAL_VIDEO_FIXTURES = Object.freeze([
  ['browser-camera.m4v', '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'],
  ['browser-camera.mov', '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'],
  ['browser-camera.webm', 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAa/EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggGMTbuMU6uEHFO7a1Osggap7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiECPgAAAAAAAFlSua0CurgEAAAAAAABA14EBc8WIkDYsxEIORqKcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QCe8hq4JGwggFAuoG0moECVbCEVbmBAa4BAAAAAAAAXNeBAnPFiEQzuanwGolOnIEAIrWcg3VuZIiBAIaGQV9PUFVTVqqDYy6gVruEBMS0AIOBAuGRn4ECtYhA53AAAAAAAGJkgRBjopNPcHVzSGVhZAECOAGAuwAAAAAAElTDZ0Dac3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2Mi4xMi4xMDFzc9pjwItjxYiQNizEQg5GomfIpUWjh0VOQ09ERVJEh5hMYXZjNjIuMjguMTAxIGxpYnZweC12cDlnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMABzc9djwItjxYhEM7mp8BqJTmfIokWjh0VOQ09ERVJEh5VMYXZjNjIuMjguMTAxIGxpYm9wdXNnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwODAwMDAwMAAfQ7Z1RDfngQCjh4IAAID8//6js4EAAICCSYNCABPwCzYAOCQcGEIAAFBh9jAAAGb5+7/////TLX/////sUwOoqUZuqIwBoKOHggAVgPz//qOHggApgPz//qOWgQAqAIYAQJKcAElAAAMgAABaNReuEKOHggA9gPz//qOHggBRgPz//qOWgQBTAIYAQJKcAFJgAAMgAABaNReuEKOHggBlgPz//qOHggB5gPz//qOWgQB9AIYAQJKcAEwgAAMgAABaNReuEKOHggCNgPz//qOHggChgPz//qOWgQCnAIYAQJKcAEsgAAMgAABaNReuEKOHggC1gPz//qOHggDJgPz//qOWgQDQAIYAQJKcAEoAAAMgAABaNReuEKOHggDdgPz//qOHggDxgPz//qOWgQD6AIYAQJKcAEjgAAMgAABaNReuEKOHggEFgPz//qOHggEZgPz//qOWgQEkAIYAQJKcAEegAAMgAABaNReuEKOHggEtgPz//qOHggFBgPz//qOWgQFNAIYAQJKcAEcAAAMgAABaNReuEKOHggFVgPz//qOHggFpgPz//qOHggF9gPz//qOWgQF3AIYAQJKcAEaAAAMgAABaNReuEKOHggGRgPz//qOHggGlgPz//qOWgQGhAIYAwJKcAENgAAMgAABaNReuEKOHggG5gPz//qOHggHNgPz//qOWgQHKAIYAQJKcAEXgAAMgAABaNReuEKOHggHhgPz//qOHggH1gPz//qOWgQH0AIYAQJKcAEVgAAMgAABaNReuEKOHggIJgPz//qOHggIdgPz//qOWgQIeAIYAQJKcAETgAAMgAABaNReuEKOHggIxgPz//qOHggJFgPz//qOWgQJHAIYAQJKcAESAAAMgAABaNReuEKOHggJZgPz//qOHggJtgPz//qOWgQJxAIYAQJKcAEQgAAMgAABaNReuEKOHggKBgPz//qOHggKVgPz//qOWgQKbAIYAQJKcAEPAAAMgAABaNReuEKOHggKpgPz//qOHggK9gPz//qOWgQLEAIYAQJKcAENgAAMgAABaNReuEKOHggLRgPz//qOHggLlgPz//qOWgQLuAIYAQJKcAEMAAAMgAABaNReuEKOHggL5gPz//qOHggMNgPz//qOWgQMYAIYAQJKcAELAAAMgAABaNReuEKOHggMhgPz//qOHggM1gPz//qOWgQNBAIYAwJKcAEFAAAMgAABaNReuEKOHggNJgPz//qOHggNdgPz//qOHggNxgPz//qOWgQNrAIYAQJKcAEKAAAMgAABaNReuEKOHggOFgPz//qOHggOZgPz//qOWgQOVAIYAQJKcAEJAAAMgAABaNReuEKOHggOtgPz//qOHggPBgPz//qOWgQO+AIYAQJKcAEIAAAMgAABaNReuEKOHggPVgPz//qCToYeCA+kA/P/+m4EHdaKEAM3+YBxTu2uRu4+zgQC3iveBAfGCAmzwgQw='],
])

function readConfiguration(environment) {
  const configuration = {
    baseUrl: environment.QIANSHU_BROWSER_AUTH_BASE_URL,
    chromeExecutable: environment.QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE,
    fixtureDirectory: environment.QIANSHU_BROWSER_AUTH_FIXTURE_DIRECTORY,
    password: environment.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD,
    profileDirectory: environment.QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY,
    username: environment.QIANSHU_BROWSER_AUTH_ADMIN_USERNAME,
  }
  let origin
  try {
    origin = new URL(configuration.baseUrl)
  }
  catch {
    throw new Error('Product media Browser configuration is invalid')
  }
  if (
    origin.protocol !== 'https:'
    || origin.hostname !== '127.0.0.1'
    || typeof configuration.chromeExecutable !== 'string'
    || !path.isAbsolute(configuration.chromeExecutable)
    || typeof configuration.fixtureDirectory !== 'string'
    || !path.isAbsolute(configuration.fixtureDirectory)
    || typeof configuration.profileDirectory !== 'string'
    || !path.isAbsolute(configuration.profileDirectory)
    || typeof configuration.username !== 'string'
    || typeof configuration.password !== 'string'
  ) {
    throw new Error('Product media Browser configuration is invalid')
  }
  return { ...configuration, baseUrl: origin.origin }
}

async function prepareOwnedFixtures(directory) {
  await mkdir(directory, { mode: 0o700, recursive: true })
  const fixtures = {}
  for (const [name, base64] of IMAGE_FIXTURES) {
    const target = path.join(directory, name)
    await writeFile(target, Buffer.from(base64, 'base64'), { mode: 0o600 })
    fixtures[name] = target
  }
  for (const name of ['browser-overview.mp4', 'browser-detail.mp4']) {
    const target = path.join(directory, name)
    await writeFile(target, Buffer.from(VIDEO_BASE64, 'base64'), { mode: 0o600 })
    fixtures[name] = target
  }
  for (const [name, base64] of ADDITIONAL_VIDEO_FIXTURES) {
    const target = path.join(directory, name)
    await writeFile(target, Buffer.from(base64, 'base64'), { mode: 0o600 })
    fixtures[name] = target
  }
  const replacement = path.join(directory, 'browser-replacement.png')
  await writeFile(replacement, Buffer.from(IMAGE_FIXTURES[1][1], 'base64'), {
    mode: 0o600,
  })
  fixtures['browser-replacement.png'] = replacement
  const document = path.join(directory, 'browser-document.pdf')
  await writeFile(document, Buffer.from('%PDF-1.4\nowned browser fixture\n%%EOF\n'), {
    mode: 0o600,
  })
  fixtures['browser-document.pdf'] = document
  return fixtures
}

function appRouteUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath}`
}

function apiExpression(pathname, method = 'GET', body) {
  const input = JSON.stringify({ body, method, pathname })
  return `(async () => {
    const input = ${input}
    const response = await fetch(input.pathname, {
      method: input.method,
      credentials: 'include',
      headers: input.method === 'GET' ? {} : {
        'Content-Type': 'application/json',
        'X-Qianshu-CSRF': '1',
      },
      ...(input.method === 'GET' ? {} : { body: JSON.stringify(input.body ?? {}) }),
    })
    const contentType = response.headers.get('content-type')
    return {
      body: contentType?.includes('application/json') ? await response.json() : null,
      status: response.status,
    }
  })()`
}

function storeSnapshotExpression() {
  return `(() => {
    const vue = document.querySelector('#app')?.__vue_app__
    const store = vue?.config?.globalProperties?.$pinia?._s?.get('appAccount')
    return store ? {
      permissions: [...(store.authContext?.permissions ?? [])].sort(),
      state: store.authState,
      username: store.authContext?.user?.username ?? null,
    } : null
  })()`
}

async function login(page, baseUrl, username, password) {
  await page.navigate(appRouteUrl(baseUrl, '/login'))
  await page.waitFor(`document.querySelector('input[autocomplete="username"]') !== null`)
  await page.evaluate(`(() => {
    const values = ${JSON.stringify({ password, username })}
    const usernameInput = document.querySelector('input[autocomplete="username"]')
    const passwordInput = document.querySelector('input[autocomplete="current-password"]')
    const button = [...document.querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === '登录系统')
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!usernameInput || !passwordInput || !button) throw new Error('login unavailable')
    setValue(usernameInput, values.username)
    setValue(passwordInput, values.password)
    button.click()
    return true
  })()`)
  await page.waitFor(`(() => {
    const snapshot = ${storeSnapshotExpression()}
    return snapshot?.state === 'authenticated'
      && snapshot.username === ${JSON.stringify(username)}
  })()`)
}

async function logout(page) {
  await page.evaluate(`(async () => {
    const vue = document.querySelector('#app')?.__vue_app__
    const store = vue?.config?.globalProperties?.$pinia?._s?.get('appAccount')
    if (!store) throw new Error('account store unavailable')
    await store.logout()
    return true
  })()`)
  await page.waitFor(`(${storeSnapshotExpression()})?.state === 'anonymous'`)
}

function requestPathname(event) {
  try {
    return new URL(event.request?.url ?? event.response?.url).pathname
  }
  catch {
    return ''
  }
}

async function clickVisibleButton(page, text) {
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.trim() === ${JSON.stringify(text)}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible button unavailable')
    button.click()
    return true
  })()`)
}

async function clickVisibleAriaButton(page, label) {
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible aria button unavailable')
    button.click()
    return true
  })()`)
}

/**
 * 将预览按钮恢复到可重复观测的静止状态，并按当前浏览器的真实 Hover 能力验收。
 * Linux Headless Chrome 可能报告 `(hover: none)`，此时触控样式会让预览入口常驻；
 * 测试必须验证这项产品契约，而不能把桌面鼠标环境的 `opacity: 0` 当成唯一真相。
 */
async function verifyPreviewInteraction(page, label, overlayClass) {
  await page.connection.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 1,
    y: 1,
  })
  await page.evaluate(`(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      && candidate.getClientRects().length > 0
    ))
    if (!(button instanceof HTMLButtonElement)) throw new Error('preview trigger unavailable')
    button.scrollIntoView({ block: 'center', inline: 'center' })
    return true
  })()`)
  await page.waitFor(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      && candidate.getClientRects().length > 0
    ))
    const overlay = button?.querySelector(${JSON.stringify(`.${overlayClass}`)})
    if (!(button instanceof HTMLButtonElement) || !(overlay instanceof HTMLElement)) return false
    const expectedOpacity = matchMedia('(hover: hover)').matches ? '0' : '1'
    return document.activeElement !== button
      && !button.matches(':hover')
      && getComputedStyle(overlay).opacity === expectedOpacity
  })()`)
  const state = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      && candidate.getClientRects().length > 0
    ))
    const overlay = button?.querySelector(${JSON.stringify(`.${overlayClass}`)})
    if (!(button instanceof HTMLButtonElement) || !(overlay instanceof HTMLElement)) {
      throw new Error('preview trigger unavailable')
    }
    const bounds = button.getBoundingClientRect()
    return {
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      focused: document.activeElement === button,
      hoverCapable: matchMedia('(hover: hover)').matches,
      hovered: button.matches(':hover'),
      initialOpacity: getComputedStyle(overlay).opacity,
    }
  })()`)
  assert.equal(state.focused, false)
  assert.equal(state.hovered, false)
  assert.equal(state.initialOpacity, state.hoverCapable ? '0' : '1')

  if (state.hoverCapable) {
    await page.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: state.centerX,
      y: state.centerY,
    })
    await page.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')].find(candidate => (
        candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      ))
      const overlay = button?.querySelector(${JSON.stringify(`.${overlayClass}`)})
      return overlay instanceof HTMLElement && getComputedStyle(overlay).opacity === '1'
    })()`)
  }

  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
      && candidate.getClientRects().length > 0
    ))
    if (!(button instanceof HTMLButtonElement)) throw new Error('preview trigger unavailable')
    button.focus()
    return true
  })()`)
  await page.waitFor(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${JSON.stringify(label)}
    ))
    const overlay = button?.querySelector(${JSON.stringify(`.${overlayClass}`)})
    return button === document.activeElement
      && overlay instanceof HTMLElement
      && getComputedStyle(overlay).opacity === '1'
  })()`)
}

async function openImageActionMenu(page, filename) {
  await clickVisibleAriaButton(page, `更多图片操作 ${filename}`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="menuitem"]')].some((item) => (
    item.getClientRects().length > 0
  )))()`)
}

async function clickImageAction(page, filename, actionLabel) {
  await openImageActionMenu(page, filename)
  await page.evaluate(`(() => {
    const menuItem = [...document.querySelectorAll('[role="menuitem"]')].find(candidate => (
      candidate.textContent?.trim() === ${JSON.stringify(actionLabel)}
      && candidate.getClientRects().length > 0
      && candidate.getAttribute('data-disabled') === null
    ))
    if (!(menuItem instanceof HTMLElement)) throw new Error('image action unavailable')
    menuItem.click()
    return true
  })()`)
}

async function openVideoActionMenu(page, filename) {
  await clickVisibleAriaButton(page, `更多视频操作 ${filename}`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="menuitem"]')].some((item) => (
    item.getClientRects().length > 0
  )))()`)
}

async function clickVideoAction(page, filename, actionLabel) {
  await openVideoActionMenu(page, filename)
  await page.evaluate(`(() => {
    const menuItem = [...document.querySelectorAll('[role="menuitem"]')].find(candidate => (
      candidate.textContent?.trim() === ${JSON.stringify(actionLabel)}
      && candidate.getClientRects().length > 0
      && candidate.getAttribute('data-disabled') === null
    ))
    if (!(menuItem instanceof HTMLElement)) throw new Error('video action unavailable')
    menuItem.click()
    return true
  })()`)
}

async function selectFileAndWait(
  page,
  baseUrl,
  productId,
  filePath,
  filename,
  submissionFilename = filename,
) {
  await page.evaluate('performance.clearResourceTimings()')
  await page.setFiles('#product-media-upload-input', [filePath])
  await page.waitFor(`(() => {
    const panel = document.querySelector('.product-media-panel')
    const input = panel?.querySelector('input[id^="product-media-filename-"]')
    return panel?.textContent?.includes('待确认文件名')
      && input instanceof HTMLInputElement
      && panel.querySelector('[aria-label^="开始上传 "]') !== null
      && panel.querySelector('[aria-label$=" 上传进度"]') === null
  })()`)
  const requestCountBeforeConfirmation = await page.evaluate(`performance
    .getEntriesByType('resource')
    .filter(entry => new URL(entry.name).pathname === ${JSON.stringify(`/api/products/${productId}/media`)})
    .length`)
  assert.equal(requestCountBeforeConfirmation, 0)

  const separator = submissionFilename.lastIndexOf('.')
  const filenameStem = submissionFilename.slice(0, separator)
  if (submissionFilename !== filename) {
    await page.evaluate(`(() => {
      const input = document.querySelector('input[id^="product-media-filename-"]')
      if (!(input instanceof HTMLInputElement)) throw new Error('filename input unavailable')
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setValue.call(input, '../invalid-name')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return true
    })()`)
    await page.waitFor(`document.body.innerText.includes('文件名不能包含路径分隔符')
      && document.querySelector('[aria-label^="开始上传 "]')?.disabled === true`)
  }
  await page.evaluate(`(() => {
    const input = document.querySelector('input[id^="product-media-filename-"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('filename input unavailable')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, ${JSON.stringify(filenameStem)})
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    return true
  })()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(`[aria-label="开始上传 ${submissionFilename}"]`)})
    ?.disabled === false`)

  const response = page.waitForEvent(
    'Network.responseReceived',
    event => requestPathname(event) === `/api/products/${productId}/media`
      && event.response?.status === 201,
    30_000,
  )
  await clickVisibleAriaButton(page, `开始上传 ${submissionFilename}`)
  await response
  await page.waitFor(`(() => {
    const panel = document.querySelector('.product-media-panel')
    return panel?.textContent?.includes(${JSON.stringify(submissionFilename)})
      && !panel.textContent?.includes('正在上传')
      && !panel.textContent?.includes('服务端验证中')
  })()`, 30_000)
}

function contentRequestExpression(contentUrl, range) {
  return `(async () => {
    const response = await fetch(${JSON.stringify(contentUrl)}, {
      credentials: 'include',
      headers: ${range === undefined ? '{}' : `{ Range: ${JSON.stringify(range)} }`},
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      acceptRanges: response.headers.get('accept-ranges'),
      contentDisposition: response.headers.get('content-disposition'),
      contentRange: response.headers.get('content-range'),
      contentType: response.headers.get('content-type'),
      length: bytes.length,
      status: response.status,
    }
  })()`
}

test('真实 Chrome 覆盖产品媒体上传、布局、私有内容、响应式与 RBAC', {
  timeout: 180_000,
}, async () => {
  const configuration = readConfiguration(process.env)
  const fixtures = await prepareOwnedFixtures(configuration.fixtureDirectory)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: path.join(configuration.profileDirectory, 'product-media'),
  })
  const page = await browser.newPage()
  await page.setViewport(1440, 900, false)

  try {
    await login(page, configuration.baseUrl, configuration.username, configuration.password)
    const query = await page.evaluate(apiExpression(
      `/api/products?page=1&pageSize=20&keyword=${PRODUCT_NO}`,
    ))
    const product = query.body?.items?.find(item => item.productNo === PRODUCT_NO)
    assert.equal(typeof product?.id, 'string')
    assert.deepEqual(product?.media, { images: [], mainImage: null, videos: [] })

    await page.navigate(appRouteUrl(
      configuration.baseUrl,
      `/admin/products/${product.id}/edit`,
    ))
    await page.waitFor(`document.querySelector('.product-media-panel')?.textContent
      ?.includes('上传队列为空')`)

    // Product 客户端先拒绝 Document；随后直接 multipart 验证 Server 仍以 415 拒绝。
    await page.setFiles('#product-media-upload-input', [fixtures['browser-document.pdf']])
    await page.waitFor(`document.body.innerText.includes('产品媒体仅支持图片和视频')`)
    const serverDocumentRejection = await page.evaluate(`(async () => {
      const bytes = Uint8Array.from(atob('JVBERi0xLjQKb3duZWQgYnJvd3NlciBmaXh0dXJlCiUlRU9GCg=='), c => c.charCodeAt(0))
      const data = new FormData()
      data.append('kind', 'DOCUMENT')
      data.append('expectedVersion', ${JSON.stringify(String(product.version))})
      data.append('file', new File([bytes], 'server-document.pdf', { type: 'application/pdf' }))
      const response = await fetch('/api/products/${product.id}/media', {
        method: 'POST', credentials: 'include', headers: { 'X-Qianshu-CSRF': '1' }, body: data,
      })
      return { body: await response.json(), status: response.status }
    })()`)
    assert.equal(serverDocumentRejection.status, 415)
    assert.equal(serverDocumentRejection.body?.code, 'MEDIA_TYPE_UNSUPPORTED')

    // 仅降低真实 Chrome 的上传吞吐，保留 multipart 原始字节并稳定观察进度态。
    await page.connection.send('Network.emulateNetworkConditions', {
      downloadThroughput: -1,
      latency: 0,
      offline: false,
      uploadThroughput: 256,
    })
    try {
      const completed = page.waitForEvent(
        'Network.responseReceived',
        event => requestPathname(event) === `/api/products/${product.id}/media`,
        30_000,
      )
      await page.setFiles('#product-media-upload-input', [fixtures['browser-main.jpg']])
      await page.waitFor(`document.querySelector('[aria-label="开始上传 browser-main.jpg"]')
        ?.disabled === false`)
      await clickVisibleAriaButton(page, '开始上传 browser-main.jpg')
      await page.waitFor(`(() => {
        const text = document.querySelector('.product-media-panel')?.textContent ?? ''
        return text.includes('browser-main.jpg')
          && (text.includes('正在上传') || text.includes('服务端验证中'))
          && document.querySelector('[aria-label="browser-main.jpg 上传进度"]') !== null
      })()`)
      await page.connection.send('Network.emulateNetworkConditions', {
        downloadThroughput: -1,
        latency: 0,
        offline: false,
        uploadThroughput: -1,
      })
      const uploadResponse = await completed
      assert.equal(uploadResponse.response?.status, 201)
    }
    finally {
      await page.connection.send('Network.emulateNetworkConditions', {
        downloadThroughput: -1,
        latency: 0,
        offline: false,
        uploadThroughput: -1,
      })
    }
    await page.waitFor(`document.querySelector('.product-media-panel')?.textContent
      ?.includes('browser-main.jpg') && document.body.innerText.includes('1 / 20 张')`, 30_000)

    for (const name of [
      'browser-detail.png',
      'browser-side.webp',
      'browser-package.webp',
      'browser-overview.mp4',
      'browser-detail.mp4',
      'browser-camera.m4v',
      'browser-camera.mov',
      'browser-camera.webm',
    ]) {
      await selectFileAndWait(
        page,
        configuration.baseUrl,
        product.id,
        fixtures[name],
        name,
        name === 'browser-overview.mp4' ? '微耕机演示.mp4' : name,
      )
    }
    await page.waitFor(`document.body.innerText.includes('4 / 20 张')
      && document.body.innerText.includes('5 / 5 个')`)

    // 真实指针悬停图片时显示预览遮罩，并可直接打开现有预览器。
    await verifyPreviewInteraction(
      page,
      '预览图片 browser-main.jpg',
      'product-image-preview-overlay',
    )
    await clickVisibleAriaButton(page, '预览图片 browser-main.jpg')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes('预览图片')
        && dialog.textContent?.includes('browser-main.jpg')))()`)
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyDown',
      windowsVirtualKeyCode: 27,
    })
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyUp',
      windowsVirtualKeyCode: 27,
    })
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .every(dialog => dialog.getClientRects().length === 0))()`)

    // 视频卡片与图片卡片保持同一 Hover/Focus 预览语言，不再在卡片外露播放和管理实体按钮。
    await verifyPreviewInteraction(
      page,
      '预览视频 browser-camera.webm',
      'product-video-preview-overlay',
    )

    // 统一操作菜单保留键盘排序能力，设置主图后保存真实布局。
    await openImageActionMenu(page, 'browser-package.webp')
    await page.waitFor(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find(candidate => candidate.textContent?.trim() === '前移')
      return item instanceof HTMLElement && item.getAttribute('data-disabled') === null
    })()`)
    await page.evaluate(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')]
        .find(candidate => candidate.textContent?.trim() === '前移')
      if (!(item instanceof HTMLElement) || item.getAttribute('data-disabled') !== null) {
        throw new Error('keyboard sort menu item unavailable')
      }
      item.focus({ preventScroll: true })
      return document.activeElement === item
    })()`)
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Enter',
      key: 'Enter',
      nativeVirtualKeyCode: 13,
      text: '\r',
      type: 'keyDown',
      unmodifiedText: '\r',
      windowsVirtualKeyCode: 13,
    })
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Enter',
      key: 'Enter',
      nativeVirtualKeyCode: 13,
      type: 'keyUp',
      windowsVirtualKeyCode: 13,
    })
    await page.waitFor(`document.body.innerText.includes('媒体布局尚未保存')`)
    await clickImageAction(page, 'browser-detail.png', '设为主图')
    await clickVisibleButton(page, '保存媒体布局')
    await page.waitFor(`document.body.innerText.includes('已同步')
      && !document.body.innerText.includes('媒体布局尚未保存')`)

    // 真实 Range、完整 GET 与 HEAD 均经授权领域路由和 internal alias。
    const latest = await page.evaluate(apiExpression(`/api/products/${product.id}`))
    const primary = latest.body?.media?.mainImage
    const firstVideo = latest.body?.media?.videos?.[0]
    assert.equal(primary?.originalFilename, 'browser-detail.png')
    assert.equal(firstVideo?.originalFilename, '微耕机演示.mp4')
    assert.equal(typeof firstVideo?.contentUrl, 'string')
    const range = await page.evaluate(contentRequestExpression(firstVideo.contentUrl, 'bytes=0-3'))
    assert.deepEqual(range, {
      acceptRanges: 'bytes',
      contentDisposition: `inline; filename="_.mp4"; filename*=UTF-8''${encodeURIComponent('微耕机演示.mp4')}`,
      contentRange: `bytes 0-3/${firstVideo.sizeBytes}`,
      contentType: 'video/mp4',
      length: 4,
      status: 206,
    })
    const head = await page.evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(firstVideo.contentUrl)}, {
        method: 'HEAD', credentials: 'include',
      })
      return {
        acceptRanges: response.headers.get('accept-ranges'),
        length: response.headers.get('content-length'),
        status: response.status,
      }
    })()`)
    assert.deepEqual(head, {
      acceptRanges: 'bytes',
      length: firstVideo.sizeBytes,
      status: 200,
    })
    const additionalVideoExpectations = [
      ['browser-camera.m4v', 'video/x-m4v'],
      ['browser-camera.mov', 'video/quicktime'],
      ['browser-camera.webm', 'video/webm'],
    ]
    for (const [filename, mimeType] of additionalVideoExpectations) {
      const item = latest.body?.media?.videos?.find(video => video.originalFilename === filename)
      assert.equal(item?.mimeType, mimeType)
      assert.equal(typeof item?.contentUrl, 'string')
      const response = await page.evaluate(contentRequestExpression(item.contentUrl, 'bytes=0-3'))
      assert.deepEqual(response, {
        acceptRanges: 'bytes',
        contentDisposition: `inline; filename="${filename}"`,
        contentRange: `bytes 0-3/${item.sizeBytes}`,
        contentType: mimeType,
        length: 4,
        status: 206,
      })
    }

    // WebM 在真实 Chrome 中可加载 metadata；随后模拟解码能力不足，验证明确提示、
    // 同源私有下载与重新打开后的失败状态复位。
    await clickVisibleAriaButton(page, '预览视频 browser-camera.webm')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && (dialog.querySelector('video[controls]')?.readyState ?? 0) >= 1))()`)
    const fallback = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0)
      const video = dialog?.querySelector('video[controls]')
      if (!(video instanceof HTMLVideoElement)) throw new Error('preview video unavailable')
      Object.defineProperty(video, 'error', {
        configurable: true,
        value: { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED },
      })
      video.dispatchEvent(new Event('error'))
      return true
    })()`)
    assert.equal(fallback, true)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0)
      return dialog?.textContent?.includes('当前浏览器不支持此视频')
        && dialog.querySelector('[aria-label="下载视频 browser-camera.webm"]') !== null
    })()`)
    await page.waitFor(`(() => {
      const link = document.querySelector('[aria-label="下载视频 browser-camera.webm"]')
      return (link?.getBoundingClientRect().height ?? 0) >= 44
    })()`)
    const downloadFallback = await page.evaluate(`(() => {
      const link = document.querySelector('[aria-label="下载视频 browser-camera.webm"]')
      if (!(link instanceof HTMLAnchorElement)) throw new Error('download fallback unavailable')
      return {
        download: link.hasAttribute('download'),
        height: link.getBoundingClientRect().height,
        href: link.href,
        sameOrigin: link.origin === location.origin,
      }
    })()`)
    const webmVideo = latest.body?.media?.videos
      ?.find(video => video.originalFilename === 'browser-camera.webm')
    assert.deepEqual({
      download: downloadFallback.download,
      href: downloadFallback.href,
      sameOrigin: downloadFallback.sameOrigin,
    }, {
      download: true,
      href: new URL(webmVideo.contentUrl, configuration.baseUrl).href,
      sameOrigin: true,
    })
    assert.ok(downloadFallback.height >= 44)
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyDown',
      windowsVirtualKeyCode: 27,
    })
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyUp',
      windowsVirtualKeyCode: 27,
    })
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .every(dialog => dialog.getClientRects().length === 0))()`)
    await clickVisibleAriaButton(page, '预览视频 browser-camera.webm')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && !dialog.textContent?.includes('当前浏览器不支持此视频')
        && dialog.querySelector('video[controls]') !== null))()`)
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyDown',
      windowsVirtualKeyCode: 27,
    })
    await page.connection.send('Input.dispatchKeyEvent', {
      code: 'Escape',
      key: 'Escape',
      type: 'keyUp',
      windowsVirtualKeyCode: 27,
    })
    // 伪造 stale expectedVersion 触发真实 409，界面必须保留本地布局并人工收敛。
    await clickImageAction(page, 'browser-side.webp', '前移')
    await page.enableRequestInterception([{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/products/${product.id}/media/layout`,
    }])
    const removeConflictListener = page.on('Fetch.requestPaused', (event) => {
      if (event.request?.method === 'PUT') {
        const body = JSON.parse(event.request.postData)
        // 保持 DTO 的正整数类型，只改成确定过期的 v1，确保命中领域 409 而非参数 422。
        body.expectedVersion = 1
        void page.connection.send('Fetch.continueRequest', {
          postData: Buffer.from(JSON.stringify(body)).toString('base64'),
          requestId: event.requestId,
        }).catch(() => undefined)
        return
      }
      void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
    })
    try {
      await clickVisibleButton(page, '保存媒体布局')
      await page.waitFor(`document.body.innerText.includes('产品媒体版本需要人工确认')`)
      assert.equal(await page.evaluate(`document.body.innerText.includes('本地布局')`), true)
      await clickVisibleButton(page, '采用最新布局')
      await page.waitFor(`!document.body.innerText.includes('产品媒体版本需要人工确认')`)
    }
    finally {
      removeConflictListener()
      await page.disableRequestInterception()
    }

    // 视频解除成功后，确认弹窗必须真实关闭；随后重新上传，继续保留 5/5 的媒体上限场景。
    await clickVideoAction(page, 'browser-detail.mp4', '解除视频')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes('解除产品媒体')
        && dialog.textContent?.includes('browser-detail.mp4')))()`)
    await clickVisibleButton(page, '确认解除')
    await page.waitFor(`document.body.innerText.includes('4 / 5 个')`)
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .every(dialog => dialog.getClientRects().length === 0))()`)
    await selectFileAndWait(
      page,
      configuration.baseUrl,
      product.id,
      fixtures['browser-detail.mp4'],
      'browser-detail.mp4',
    )
    await page.waitFor(`document.body.innerText.includes('5 / 5 个')`)

    // 图片解除关联后重新上传，继续为后续管理 Browser 回归保留 4/20。
    await clickImageAction(page, 'browser-package.webp', '解除图片')
    await page.waitFor(`document.body.innerText.includes('解除产品媒体')`)
    await clickVisibleButton(page, '确认解除')
    await page.waitFor(`document.body.innerText.includes('3 / 20 张')`)
    await selectFileAndWait(
      page,
      configuration.baseUrl,
      product.id,
      fixtures['browser-replacement.png'],
      'browser-replacement.png',
    )
    await page.waitFor(`document.body.innerText.includes('4 / 20 张')`)

    await page.setViewport(390, 844, true)
    // Chrome 从桌面动态切换到 mobile emulation 时，不会为已经加载的页面重新应用
    // viewport meta。按当前地址重新加载，确保下面验证的是 390 CSS px 的真实移动端布局，
    // 而不是被缩放到手机屏幕的约 980 CSS px 桌面布局。
    await page.navigate(await page.evaluate('location.href'))
    await page.waitFor(`document.querySelector('.product-media-panel')?.textContent
      ?.includes('4 / 20 张')`)
    await page.connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    await page.evaluate(`(() => {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
      return true
    })()`)
    // 重新挂载后的首个渲染周期仍可能处于路由/响应式样式过渡中；触控尺寸
    // 验收应以稳定布局为准，但最终仍严格要求每个可见按钮不少于 44 CSS px。
    await page.waitFor(`(() => {
      const panel = document.querySelector('.product-media-panel')
      const buttons = [...(panel?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0)
      return buttons.length > 0
        && buttons.every(button => button.getBoundingClientRect().height >= 44)
    })()`)
    const mobile = await page.evaluate(`(() => {
      const panel = document.querySelector('.product-media-panel')
      const buttons = [...(panel?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0)
      const layout = panel?.querySelector('.product-media-layout')
      const undersizedButtons = buttons
        .map(button => ({
          ariaLabel: button.getAttribute('aria-label'),
          className: button.className,
          height: button.getBoundingClientRect().height,
          text: button.textContent?.trim(),
        }))
        .filter(button => button.height < 44)
      return {
        columns: layout ? getComputedStyle(layout).gridTemplateColumns.split(' ').length : 0,
        dark: document.documentElement.classList.contains('dark'),
        fits: document.documentElement.scrollWidth <= innerWidth,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        smallBreakpoint: matchMedia('(min-width: 640px)').matches,
        undersizedButtons,
        viewportWidth: innerWidth,
      }
    })()`)
    assert.deepEqual(mobile, {
      columns: 1,
      dark: true,
      fits: true,
      reduced: true,
      smallBreakpoint: false,
      undersizedButtons: [],
      viewportWidth: 390,
    })
    await page.connection.send('Emulation.setEmulatedMedia', { features: [] })
    await page.setViewport(1440, 900, false)
    await page.evaluate(`document.documentElement.classList.remove('dark')`)

    // 四种真实 RBAC 组合：产品只读、update-only、media-only、无媒体读取的可编辑身份。
    const finalProduct = await page.evaluate(apiExpression(`/api/products/${product.id}`))
    const contentUrl = finalProduct.body.media.mainImage.contentUrl
    await logout(page)

    await login(page, configuration.baseUrl, 'browser_products_read', configuration.password)
    const readPermissions = await page.evaluate(storeSnapshotExpression())
    assert.deepEqual(readPermissions.permissions, [
      'product-categories:read',
      'product-media:read',
      'products:read',
    ])
    assert.equal((await page.evaluate(apiExpression(`/api/products/${product.id}`))).status, 200)
    assert.equal((await page.evaluate(contentRequestExpression(contentUrl))).status, 200)
    await logout(page)

    await login(page, configuration.baseUrl, 'browser_products_update', configuration.password)
    assert.deepEqual((await page.evaluate(storeSnapshotExpression())).permissions, [
      'product-categories:create',
      'product-categories:read',
      'products:update',
    ])
    assert.equal((await page.evaluate(apiExpression(`/api/products/${product.id}`))).status, 403)
    assert.equal((await page.evaluate(contentRequestExpression(contentUrl))).status, 403)
    await logout(page)

    await login(page, configuration.baseUrl, 'browser_media_read', configuration.password)
    assert.deepEqual((await page.evaluate(storeSnapshotExpression())).permissions, ['product-media:read'])
    assert.equal((await page.evaluate(apiExpression(`/api/products/${product.id}`))).status, 403)
    assert.equal((await page.evaluate(contentRequestExpression(contentUrl))).status, 200)
    await logout(page)

    await login(
      page,
      configuration.baseUrl,
      'browser_products_manage_no_media',
      configuration.password,
    )
    await page.navigate(appRouteUrl(
      configuration.baseUrl,
      `/admin/products/${product.id}/edit`,
    ))
    await page.waitFor(`document.body.innerText.includes('媒体内容不可读取')`)
    const noMediaState = await page.evaluate(`(() => ({
      canUpload: document.querySelector('#product-media-upload-input') !== null,
      contentSources: [...document.querySelectorAll('.product-media-panel img, .product-media-panel video')]
        .filter(element => element.getAttribute('src')?.includes('/api/products/')).length,
      editable: [...document.querySelectorAll('button')].some(button => (
        button.textContent?.trim() === '保存修改' && !button.disabled
      )),
    }))()`)
    assert.deepEqual(noMediaState, {
      canUpload: true,
      contentSources: 0,
      editable: true,
    })
    await logout(page)
  }
  finally {
    await browser.close()
  }
})
