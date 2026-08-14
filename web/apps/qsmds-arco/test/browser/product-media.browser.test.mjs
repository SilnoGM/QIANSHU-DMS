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
      .find(candidate => candidate.textContent?.trim() === '登录')
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

async function selectFileAndWait(page, baseUrl, productId, filePath, filename) {
  const response = page.waitForEvent(
    'Network.responseReceived',
    event => requestPathname(event) === `/api/products/${productId}/media`
      && event.response?.status === 201,
    30_000,
  )
  await page.setFiles('#product-media-upload-input', [filePath])
  await response
  await page.waitFor(`(() => {
    const panel = document.querySelector('.product-media-panel')
    return panel?.textContent?.includes(${JSON.stringify(filename)})
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
      contentRange: response.headers.get('content-range'),
      length: bytes.length,
      status: response.status,
    }
  })()`
}

test('真实 Chrome 覆盖产品媒体上传、布局、私有内容、响应式与 RBAC', {
  timeout: 120_000,
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
    ]) {
      await selectFileAndWait(page, configuration.baseUrl, product.id, fixtures[name], name)
    }
    await page.waitFor(`document.body.innerText.includes('4 / 20 张')
      && document.body.innerText.includes('2 / 5 个')`)

    // 键盘触发排序，设置主图并保存真实布局。
    await page.waitFor(`(() => {
      const button = document.querySelector('[aria-label="前移图片 browser-package.webp"]')
      return button instanceof HTMLButtonElement && !button.disabled
    })()`)
    await page.evaluate(`(() => {
      const button = document.querySelector('[aria-label="前移图片 browser-package.webp"]')
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        throw new Error('keyboard sort button unavailable')
      }
      button.focus({ preventScroll: true })
      return document.activeElement === button
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
    await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-media-id]')]
        .find(candidate => candidate.textContent?.includes('browser-detail.png'))
      const button = [...(card?.querySelectorAll('button') ?? [])]
        .find(candidate => candidate.textContent?.trim() === '设为主图')
      if (!button) throw new Error('primary button unavailable')
      button.click()
      return true
    })()`)
    await clickVisibleButton(page, '保存媒体布局')
    await page.waitFor(`document.body.innerText.includes('已同步')
      && !document.body.innerText.includes('媒体布局尚未保存')`)

    // 真实 Range、完整 GET 与 HEAD 均经授权领域路由和 internal alias。
    const latest = await page.evaluate(apiExpression(`/api/products/${product.id}`))
    const primary = latest.body?.media?.mainImage
    const firstVideo = latest.body?.media?.videos?.[0]
    assert.equal(primary?.originalFilename, 'browser-detail.png')
    assert.equal(typeof firstVideo?.contentUrl, 'string')
    const range = await page.evaluate(contentRequestExpression(firstVideo.contentUrl, 'bytes=0-3'))
    assert.deepEqual(range, {
      acceptRanges: 'bytes',
      contentRange: `bytes 0-3/${firstVideo.sizeBytes}`,
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
    await clickVisibleAriaButton(page, '预览视频 browser-overview.mp4')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
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
    await clickVisibleAriaButton(page, '前移图片 browser-side.webp')
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

    // 解除关联后重新上传，既覆盖删除交互，也为后续管理 Browser 回归保留 4/2。
    await clickVisibleAriaButton(page, '解除图片 browser-package.webp')
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
    assert.deepEqual(readPermissions.permissions, ['product-media:read', 'products:read'])
    assert.equal((await page.evaluate(apiExpression(`/api/products/${product.id}`))).status, 200)
    assert.equal((await page.evaluate(contentRequestExpression(contentUrl))).status, 200)
    await logout(page)

    await login(page, configuration.baseUrl, 'browser_products_update', configuration.password)
    assert.deepEqual((await page.evaluate(storeSnapshotExpression())).permissions, ['products:update'])
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
