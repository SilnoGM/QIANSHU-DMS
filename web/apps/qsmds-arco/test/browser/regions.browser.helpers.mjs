import path from 'node:path'

export function readConfiguration(environment) {
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
    throw new Error('Browser regions test configuration is invalid')
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
    throw new Error('Browser regions test configuration is invalid')
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

/** 正式应用使用 hash history；测试必须通过真实 Router URL 进入页面。 */
export function appRouteUrl(baseUrl, routePath) {
  return `${baseUrl}/#${routePath}`
}

export function apiExpression(pathname, method = 'GET', body) {
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

export function authStoreExpression(body) {
  return `(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const store = app?.config?.globalProperties?.$pinia?._s?.get('appAccount')
    if (!store) throw new Error('account store unavailable')
    ${body}
  })()`
}

export function regionProviderExpression(body) {
  return `(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const provides = app?._context?.provides
    const provider = provides
      ? Reflect.ownKeys(provides)
          .map(key => provides[key])
          .find(value => (
            value
            && typeof value.listChildren === 'function'
            && typeof value.resolvePath === 'function'
            && typeof value.search === 'function'
          ))
      : undefined
    if (!provider) throw new Error('region provider unavailable')
    ${body}
  })()`
}

export async function waitForAuthState(page, state) {
  try {
    await page.waitFor(authStoreExpression(
      `return store.authState === ${JSON.stringify(state)}`,
    ))
  }
  catch (error) {
    const diagnostic = await page.evaluate(`(async () => {
      const app = document.querySelector('#app')
      const vue = app?.__vue_app__
      const stores = vue?.config?.globalProperties?.$pinia?._s
      const account = stores?.get('appAccount')
      const probe = async (pathname) => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3_000)
        try {
          const response = await fetch(pathname, {
            credentials: 'include',
            signal: controller.signal,
          })
          return {
            contentType: response.headers.get('content-type'),
            status: response.status,
          }
        }
        catch (probeError) {
          return {
            error: typeof probeError?.name === 'string'
              ? probeError.name
              : 'Error',
          }
        }
        finally {
          clearTimeout(timer)
        }
      }
      return {
        appMounted: Boolean(vue),
        authState: account?.authState ?? null,
        bodyText: document.body.innerText.slice(0, 240),
        hash: location.hash,
        healthProbe: await probe('/api/health'),
        meProbe: await probe('/api/auth/me'),
        resources: performance.getEntriesByType('resource')
          .filter(entry => entry.name.includes('/api/'))
          .slice(-8)
          .map(entry => ({
            duration: Math.round(entry.duration),
            name: new URL(entry.name).pathname,
            transferSize: entry.transferSize,
          })),
        storeIds: stores ? [...stores.keys()].sort() : [],
        title: document.title,
      }
    })()`).catch(() => ({ diagnosticUnavailable: true }))
    throw new Error(
      `Browser auth state timed out: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    )
  }
}

/**
 * 地区 E2E 不负责重复验证登录表单，但必须通过真实认证契约建立会话。
 * `vite build --mode test` 暴露了既有 authApi 循环初始化问题，因此这里只绕过
 * Axios 包装层：浏览器仍请求正式 Server、接收 HttpOnly Cookie，并把 Server
 * 返回的 AuthContext 交给 Store 的正式入口；测试端不构造身份或权限数据。
 */
export async function loginThroughRealHttp(page, credentials) {
  const loginPayload = JSON.stringify({
    password: credentials.password,
    username: credentials.username,
  })
  await page.waitFor(authStoreExpression(
    'return typeof store.applyAuthContext === \'function\'',
  ))
  const response = await page.evaluate(`(async () => {
    const loginResponse = await fetch('/api/auth/login', {
      body: JSON.stringify(${loginPayload}),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Qianshu-CSRF': '1',
      },
      method: 'POST',
    })
    const response = loginResponse.status === 409
      ? await fetch('/api/auth/me', { credentials: 'include' })
      : loginResponse
    return {
      body: await response.json(),
      ok: response.ok,
      status: response.status,
    }
  })()`)
  if (response?.ok !== true) {
    throw new Error(`Browser real HTTP login failed: ${JSON.stringify({
      code: typeof response?.body?.code === 'string'
        ? response.body.code
        : null,
      status: response?.status ?? null,
    })}`)
  }
  const result = await page.evaluate(authStoreExpression(`
    store.applyAuthContext(${JSON.stringify(response.body)})
    return {
      authState: store.authState,
      hasContext: store.authContext !== null,
    }
  `))
  if (result?.authState !== 'authenticated' || result.hasContext !== true) {
    throw new Error(
      `Browser real HTTP AuthContext apply failed: ${JSON.stringify(result)}`,
    )
  }
}

export async function loginThroughUi(
  page,
  credentials,
  expectedState = 'authenticated',
) {
  await page.waitFor(`document.querySelector('input[autocomplete="username"]') !== null`)
  await page.evaluate(`(() => {
    const credentials = ${JSON.stringify(credentials)}
    const username = document.querySelector('input[autocomplete="username"]')
    const password = document.querySelector('input[autocomplete="current-password"]')
    const button = [...document.querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === '登录')
    if (!username || !password || !button) {
      throw new Error('login form unavailable')
    }
    const setValue = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        .set.call(input, value)
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
      }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setValue(username, credentials.username)
    setValue(password, credentials.password)
    button.click()
    return true
  })()`)
  await waitForAuthState(page, expectedState)
}

export async function clickVisibleButton(page, text) {
  const serialized = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some(button => (
    button.textContent?.trim() === ${serialized}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.trim() === ${serialized}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible button unavailable')
    button.click()
    return true
  })()`)
}

export async function clickVisibleModalButton(page, text) {
  const serialized = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && [...dialog.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === ${serialized}
      && button.getClientRects().length > 0
      && !button.disabled
    ))
  )))()`)
  await page.bringToFront()
  await page.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(dialog => dialog.getClientRects().length > 0)
      .reverse()
    const button = dialogs
      .flatMap(dialog => [...dialog.querySelectorAll('button')])
      .find(candidate => (
        candidate.textContent?.trim() === ${serialized}
        && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('modal button unavailable')
    button.scrollIntoView({ block: 'center', inline: 'center' })
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
    if (!(hit === button || button.contains(hit))) {
      throw new Error('modal button center is obstructed')
    }

    /*
     * 仓库 Browser helpers 统一通过最终 DOM button.click() 触发 Vue handler。
     * CDP Input 的低层合成 click 在部分 Chrome/Vue 组合中携带旧时间戳，会被
     * Vue 的事件附着时间保护忽略，形成“原生监听收到但组件 handler 未执行”的假阴性。
     */
    button.click()
    return true
  })()`)
}

export async function clickVisibleRowButton(page, marker, text) {
  const serializedMarker = JSON.stringify(marker)
  const serializedText = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('tr')].some(row => (
    row.textContent?.includes(${serializedMarker})
    && row.getClientRects().length > 0
    && [...row.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === ${serializedText}
      && button.getClientRects().length > 0
      && !button.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find(candidate => (
      candidate.textContent?.includes(${serializedMarker})
      && candidate.getClientRects().length > 0
    ))
    const button = [...(row?.querySelectorAll('button') ?? [])].find(candidate => (
      candidate.textContent?.trim() === ${serializedText}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('row button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

export async function fillVisibleInput(page, selector, value) {
  const serializedSelector = JSON.stringify(selector)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll(${serializedSelector})]
    .some(input => input.getClientRects().length > 0 && !input.disabled))()`)
  await page.evaluate(`(() => {
    const input = [...document.querySelectorAll(${serializedSelector})]
      .find(candidate => candidate.getClientRects().length > 0 && !candidate.disabled)
    if (!(input instanceof HTMLInputElement)) throw new Error('input unavailable')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${serializedValue})
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

export async function fillVisibleModalInput(page, placeholder, value) {
  const serializedPlaceholder = JSON.stringify(placeholder)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && [...dialog.querySelectorAll('input')].some(input => (
      input.placeholder === ${serializedPlaceholder}
      && input.getClientRects().length > 0
      && !input.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()[0]
    const input = [...(dialog?.querySelectorAll('input') ?? [])].find(candidate => (
      candidate.placeholder === ${serializedPlaceholder}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!(input instanceof HTMLInputElement)) throw new Error('modal input unavailable')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${serializedValue})
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

export async function waitForNoVisibleDialog(page, text) {
  await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes(${JSON.stringify(text)})
  ))`)
}

function regionLevelTriggerExpression(rootTestId, level) {
  return `document.querySelector(
    ${JSON.stringify(`[data-testid="${rootTestId}"]`)}
  )?.querySelector(
    ${JSON.stringify(
      `[data-region-level="${level}"] [data-slot="select-trigger"]`,
    )}
  )`
}

export async function openRegionLevelSelect(
  page,
  rootTestId,
  level,
) {
  const trigger = regionLevelTriggerExpression(rootTestId, level)
  await page.waitFor(`(() => {
    const target = ${trigger}
    return target instanceof HTMLButtonElement
      && target.getClientRects().length > 0
      && !target.disabled
  })()`)
  await page.evaluate(`(() => {
    const target = ${trigger}
    if (!(target instanceof HTMLButtonElement) || target.disabled) {
      throw new Error('region level trigger unavailable')
    }
    target.focus({ preventScroll: true })
    /*
     * Reka Select@2.10.1 公开支持 Enter 打开。直接把 keydown 发到已解析的
     * trigger，避免移动设备模拟在同文档导航后丢失 window focus 的 CDP 竞态。
     */
    target.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
    }))
    return true
  })()`)
  try {
    await page.waitFor(`(() => {
      const target = ${trigger}
      const contentId = target?.getAttribute('aria-controls')
      const content = contentId ? document.getElementById(contentId) : null
      return target?.getAttribute('aria-expanded') === 'true'
        && content?.getClientRects().length > 0
    })()`, 5_000)
  }
  catch (error) {
    /*
     * 失败诊断只记录公开 DOM 状态，不采集选值、请求体或认证信息。
     * 这样可以区分 trigger 未展开与 portal 已生成但不可见两类回归。
     */
    const diagnostic = await page.evaluate(`(() => {
      const target = ${trigger}
      const contentId = target?.getAttribute('aria-controls')
      const content = contentId ? document.getElementById(contentId) : null
      return {
        active: document.activeElement === target,
        contentFound: content !== null,
        contentState: content?.getAttribute('data-state') ?? null,
        contentVisible: Boolean(content?.getClientRects().length),
        expanded: target?.getAttribute('aria-expanded') ?? null,
        triggerState: target?.getAttribute('data-state') ?? null,
        visibleOpenContentCount: [...document.querySelectorAll(
          '[data-slot="select-content"][data-state="open"]',
        )].filter(candidate => candidate.getClientRects().length > 0).length,
      }
    })()`)
    throw new Error(
      `Region select did not open: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    )
  }
}

export async function waitForRegionSelectOptions(
  page,
  rootTestId,
  level,
  expectedLabels,
) {
  const trigger = regionLevelTriggerExpression(rootTestId, level)
  await page.waitFor(`(() => {
    const expected = ${JSON.stringify(expectedLabels)}
    const target = ${trigger}
    const contentId = target?.getAttribute('aria-controls')
    const content = contentId ? document.getElementById(contentId) : null
    const labels = [...(content?.querySelectorAll(
      '[data-slot="select-item"][role="option"]',
    ) ?? [])]
      .filter(item => item.getClientRects().length > 0)
      .map(item => item.textContent?.trim() ?? '')
    return labels.length === expected.length
      && labels.every((label, index) => label === expected[index])
  })()`)
}

export async function selectRegionOption(
  page,
  rootTestId,
  level,
  text,
) {
  const trigger = regionLevelTriggerExpression(rootTestId, level)
  const serializedText = JSON.stringify(text)
  const expanded = await page.evaluate(
    `${trigger}?.getAttribute('aria-expanded') === 'true'`,
  )
  if (!expanded) {
    await openRegionLevelSelect(page, rootTestId, level)
  }
  await page.waitFor(`(() => {
    const target = ${trigger}
    const contentId = target?.getAttribute('aria-controls')
    const content = contentId ? document.getElementById(contentId) : null
    const exact = [...(content?.querySelectorAll(
      '[data-slot="select-item"][role="option"]',
    ) ?? [])].filter(item => (
      item.getClientRects().length > 0
      && item.getAttribute('aria-disabled') !== 'true'
      && item.textContent?.trim() === ${serializedText}
    ))
    return exact.length === 1
  })()`)
  await page.evaluate(`(() => {
    const target = ${trigger}
    const contentId = target?.getAttribute('aria-controls')
    const content = contentId ? document.getElementById(contentId) : null
    const exact = [...(content?.querySelectorAll(
      '[data-slot="select-item"][role="option"]',
    ) ?? [])].filter(item => (
      item.getClientRects().length > 0
      && item.getAttribute('aria-disabled') !== 'true'
      && item.textContent?.trim() === ${serializedText}
    ))
    if (exact.length !== 1) {
      throw new Error('region option unavailable')
    }
    exact[0].focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`${trigger}?.getAttribute('aria-expanded') === 'false'`)
}

export async function pressKey(page, key, code = key) {
  await page.connection.send('Input.dispatchKeyEvent', {
    code,
    key,
    type: 'keyDown',
  })
  await page.connection.send('Input.dispatchKeyEvent', {
    code,
    key,
    type: 'keyUp',
  })
}

export function installBroadcastProbeScript() {
  return `(() => {
    const NativeBroadcastChannel = globalThis.BroadcastChannel
    globalThis.__regionBroadcastPayloads = []
    if (typeof NativeBroadcastChannel !== 'function') return
    globalThis.BroadcastChannel = class RegionProbeBroadcastChannel
      extends NativeBroadcastChannel {
      postMessage(message) {
        if (this.name === 'qianshu-regions-v1') {
          globalThis.__regionBroadcastPayloads.push(
            JSON.parse(JSON.stringify(message)),
          )
        }
        return super.postMessage(message)
      }
    }
  })()`
}

export async function subscribeToRegionInvalidation(page) {
  await page.evaluate(regionProviderExpression(`
    globalThis.__regionInvalidations = 0
    globalThis.__regionUnsubscribe?.()
    globalThis.__regionUnsubscribe = provider.subscribeInvalidation?.(() => {
      globalThis.__regionInvalidations += 1
    })
    return true
  `))
}

export async function broadcastRegionInvalidation(page) {
  await page.evaluate(`(() => {
    const channel = new BroadcastChannel('qianshu-regions-v1')
    channel.postMessage({ type: 'REGIONS_CHANGED' })
    setTimeout(() => channel.close(), 0)
    return true
  })()`)
}

export function startProviderCallExpression(key, operation, argument) {
  const serializedKey = JSON.stringify(key)
  const serializedArgument = JSON.stringify(argument)
  const calls = {
    children: `provider.listChildren({
      parentId: input,
      signal: controller.signal,
    })`,
    path: `provider.resolvePath({
      cityId: input,
      signal: controller.signal,
    })`,
    search: `provider.search({
      query: input,
      signal: controller.signal,
    })`,
  }
  return regionProviderExpression(`
    const input = ${serializedArgument}
    const controller = new AbortController()
    globalThis.__regionProviderPending ??= Object.create(null)
    globalThis.__regionProviderPending[${serializedKey}] = ${calls[operation]}
      .then(value => ({ ok: true, value }))
      .catch(error => ({
        code: typeof error?.code === 'string' ? error.code : null,
        name: typeof error?.name === 'string' ? error.name : 'Error',
        ok: false,
      }))
    return true
  `)
}

export function readProviderCallExpression(key) {
  return `(async () => {
    const pending = globalThis.__regionProviderPending?.[${JSON.stringify(key)}]
    if (!pending) throw new Error('provider pending call unavailable')
    return pending
  })()`
}

export async function failNextRequest(page, patterns, predicate, action) {
  await page.enableRequestInterception(patterns)
  let targetRequestId
  const removeListener = page.on('Fetch.requestPaused', (event) => {
    if (predicate(event)) {
      targetRequestId ??= event.requestId
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    const paused = page.waitForEvent('Fetch.requestPaused', predicate, 20_000)
      .then(
        event => ({ event, ok: true }),
        error => ({ error, ok: false }),
      )
    /*
     * 先等待负责触发请求的交互完成，再读取已经挂好的 DevTools wait。地区场景的
     * action 只等待 popup/输入等本地状态，不等待被拦截的 HTTP；因此 action
     * 失败时能保留首错。DevTools wait 在创建时就转换成 outcome，避免 action
     * 和 event 同时超时时出现 PromiseRejectionHandledWarning。
     */
    await action()
    const outcome = await paused
    if (!outcome.ok) {
      throw outcome.error
    }
    const { event } = outcome
    targetRequestId = event.requestId
    await page.failInterceptedRequest(event.requestId)
  }
  finally {
    removeListener()
    await page.disableRequestInterception()
  }
}

/**
 * 暂停一个真实 HTTP 请求，在响应到达前检查界面中间态，再原样放行。
 * 目标请求无论断言成功或失败都会在 finally 中恢复，避免把共享测试页留在挂起状态。
 */
export async function inspectNextPausedRequest(
  page,
  patterns,
  predicate,
  action,
  inspect,
) {
  await page.enableRequestInterception(patterns)
  let targetRequestId
  const removeListener = page.on('Fetch.requestPaused', (event) => {
    if (predicate(event)) {
      targetRequestId ??= event.requestId
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    const paused = page.waitForEvent('Fetch.requestPaused', predicate, 20_000)
      .then(
        event => ({ event, ok: true }),
        error => ({ error, ok: false }),
      )
    await action()
    const outcome = await paused
    if (!outcome.ok) {
      throw outcome.error
    }
    targetRequestId = outcome.event.requestId
    await inspect(outcome.event)
    await page.continueInterceptedRequest(outcome.event.requestId)
    targetRequestId = undefined
  }
  finally {
    if (targetRequestId) {
      await page.continueInterceptedRequest(targetRequestId)
        .catch(() => undefined)
    }
    removeListener()
    await page.disableRequestInterception()
  }
}

export function collectRuntimeIssues(page, { sensitiveValues = [] } = {}) {
  const issues = []
  let enabled = false
  /*
   * 凭据必须在归一化、截断和写入 issues 之前被替换。使用字符串 replaceAll
   * 而非动态正则，既保证重复出现的值全部遮罩，也避免密码中的正则元字符改变
   * 匹配语义；较长值优先可避免其前缀先被替换后残留后半段。
   */
  const secrets = [...new Set(sensitiveValues)]
    .filter(value => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)
  const redact = (value) => {
    let redacted = String(value)
    for (const secret of secrets) {
      redacted = redacted.replaceAll(secret, '[REDACTED]')
    }
    return redacted
  }
  const removeConsole = page.on('Runtime.consoleAPICalled', (event) => {
    if (enabled && ['error', 'warning'].includes(event.type)) {
      // 保留有界、单行的 DevTools 摘要，失败时能定位真实前端异常；不采集
      // Network payload、Cookie 或对象深层属性，避免把测试凭据带进日志。
      const detail = (event.args ?? [])
        .map(argument => (
          typeof argument.value === 'string'
            ? argument.value
            : typeof argument.description === 'string'
              ? argument.description
              : ''
        ))
        .filter(Boolean)
        .join(' ')
      const redactedDetail = redact(detail)
        .replaceAll(/\s+/gu, ' ')
        .slice(0, 360)
      issues.push(`console:${event.type}${redactedDetail ? `:${redactedDetail}` : ''}`)
    }
  })
  const removeException = page.on('Runtime.exceptionThrown', (event) => {
    if (enabled) {
      const detail = event.exceptionDetails?.exception?.description
        ?? event.exceptionDetails?.text
        ?? ''
      const redactedDetail = redact(detail).replaceAll(/\s+/gu, ' ').slice(0, 360)
      issues.push(
        `exception${redactedDetail
          ? `:${redactedDetail}`
          : ''}`,
      )
    }
  })
  return {
    issues,
    start() {
      enabled = true
    },
    stop() {
      enabled = false
      removeConsole()
      removeException()
    },
  }
}

export function requestPathname(event) {
  try {
    return new URL(event.request?.url).pathname
  }
  catch {
    return ''
  }
}

export function requestSearchParams(event) {
  try {
    return new URL(event.request?.url).searchParams
  }
  catch {
    return new URLSearchParams()
  }
}

/**
 * 生成地区管理页的响应式布局审计。只依赖稳定 testid 和实际几何，
 * 避免把 FaPageMain 的实现 class 或表格内部 DOM 当成业务契约。
 */
export function regionManagementLayoutAuditExpression({ mobile }) {
  if (typeof mobile !== 'boolean') {
    throw new TypeError('Region management layout audit mode is invalid')
  }
  return `(() => {
    const mobile = ${mobile}
    const workspace = document.querySelector(
      '[data-testid="region-management-workspace"]',
    )
    const scopePanel = document.querySelector(
      '[data-testid="region-scope-panel"]',
    )
    const scopeSummaryPanel = document.querySelector(
      '[data-testid="region-scope-summary-panel"]',
    )
    const tablePanel = document.querySelector(
      '[data-testid="region-table-panel"]',
    )
    const scopeDrawerTrigger = document.querySelector(
      '[data-testid="region-open-scope-drawer"]',
    )
    const isVisible = element =>
      (element?.getClientRects().length ?? 0) > 0
    const visiblePanels = [scopePanel, scopeSummaryPanel, tablePanel]
      .filter(isVisible)
    const workspaceRect = workspace?.getBoundingClientRect()
    const scopePanelRect = isVisible(scopePanel)
      ? scopePanel.getBoundingClientRect()
      : null
    const scopeSummaryPanelRect = isVisible(scopeSummaryPanel)
      ? scopeSummaryPanel.getBoundingClientRect()
      : null
    const tablePanelRect = isVisible(tablePanel)
      ? tablePanel.getBoundingClientRect()
      : null
    const viewportWidth = document.documentElement.clientWidth
    const horizontalPanelGap = scopePanelRect && scopeSummaryPanelRect
      ? scopeSummaryPanelRect.left - scopePanelRect.right
      : null
    const verticalPanelGap = scopeSummaryPanelRect && tablePanelRect
      ? tablePanelRect.top - scopeSummaryPanelRect.bottom
      : null
    const rightPanelsAligned = !!(
      scopeSummaryPanelRect
      && tablePanelRect
      && Math.abs(scopeSummaryPanelRect.left - tablePanelRect.left) <= 1
      && Math.abs(scopeSummaryPanelRect.right - tablePanelRect.right) <= 1
    )
    const scopeSpansRightStack = !!(
      scopePanelRect
      && scopeSummaryPanelRect
      && tablePanelRect
      && Math.abs(scopePanelRect.top - scopeSummaryPanelRect.top) <= 1
      && Math.abs(scopePanelRect.bottom - tablePanelRect.bottom) <= 1
    )
    const panelsFitWorkspace = !!workspaceRect && visiblePanels.every((panel) => {
      const rect = panel.getBoundingClientRect()
      return rect.left >= workspaceRect.left - 1
        && rect.right <= workspaceRect.right + 1
        && rect.top >= workspaceRect.top - 1
        && rect.bottom <= workspaceRect.bottom + 1
    })
    const cards = [...document.querySelectorAll('[data-testid="region-card"]')]
      .filter(isVisible)
    const desktopTables = [...document.querySelectorAll(
      '[data-testid="region-table"] table',
    )].filter(isVisible)
    const table = document.querySelector('[data-testid="region-table"]')
    return {
      cards: cards.length,
      desktopTables: desktopTables.length,
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalPanelGap,
      modeMatches: mobile
        ? viewportWidth === 390
          && !isVisible(scopePanel)
          && isVisible(scopeDrawerTrigger)
        : viewportWidth >= 768
          && isVisible(scopePanel)
          && !isVisible(scopeDrawerTrigger),
      panelsFitWorkspace,
      rightPanelsAligned,
      scopePanelWidth: scopePanelRect?.width ?? null,
      scopeSpansRightStack,
      tableVisible: isVisible(table),
      verticalPanelGap,
      viewportWidth,
      visiblePanelCount: visiblePanels.length,
      workspaceMounted: isVisible(workspace),
    }
  })()`
}

export async function waitForRegionTable(page) {
  await page.waitFor(`(() => {
    const table = document.querySelector('[data-testid="region-table"]')
    return table?.getClientRects().length > 0
      && table.querySelector('[aria-busy="false"]') !== null
      && document.body.innerText.includes('地区管理')
  })()`)
}

export async function clickVisibleTreeItem(page, text) {
  const serialized = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="treeitem"]')]
    .some(item => (
      item.getClientRects().length > 0
      && item.textContent?.includes(${serialized})
    )))()`)
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="treeitem"]')]
      .find(candidate => (
        candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${serialized})
      ))
    if (!item) throw new Error('tree item unavailable')
    const label = [...item.querySelectorAll('*')].find(candidate => (
      candidate.children.length === 0
      && candidate.textContent?.trim() === ${serialized}
    ))
    ;(label ?? item).click()
    return true
  })()`)
}

export async function selectVisibleFilter(page, label, option) {
  const serializedLabel = JSON.stringify(label)
  const serializedOption = JSON.stringify(option)
  try {
    await page.waitFor(`(() => [...document.querySelectorAll('label')].some(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${serializedLabel})
      && candidate.querySelector('[role="combobox"]')
    )))()`)
  }
  catch (error) {
    /*
     * Popover/Drawer 都把筛选面板传送到页面末尾；超时时保留有界 DOM 语义，
     * 以区分“面板未打开”和“Select 契约变化”，不采集输入值或网络数据。
     */
    const diagnostic = await page.evaluate(`(() => ({
      filterButtons: [...document.querySelectorAll('button')]
        .filter(button => (
          button.textContent?.trim() === '筛选'
          || button.textContent?.trim().startsWith('已筛选：')
        ))
        .map(button => ({
          expanded: button.getAttribute('aria-expanded'),
          visible: button.getClientRects().length > 0,
        })),
      labels: [...document.querySelectorAll('label')]
        .filter(candidate => candidate.getClientRects().length > 0)
        .map(candidate => candidate.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(-12),
      popovers: [...document.querySelectorAll('[data-reka-popper-content-wrapper]')]
        .map(candidate => ({
          hidden: candidate.getAttribute('data-state'),
          visible: candidate.getClientRects().length > 0,
        })),
    }))()`).catch(() => ({ diagnosticUnavailable: true }))
    throw new Error(
      `Browser filter panel timed out: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    )
  }
  await page.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${serializedLabel})
      && candidate.querySelector('[role="combobox"]')
    ))
    const trigger = label?.querySelector('[role="combobox"]')
    if (!trigger) throw new Error('filter trigger unavailable')
    /*
     * Reka Select@2.10.1 的 Trigger 只在 pointerdown/键盘时打开；DOM click()
     * 只聚焦。先聚焦真实 combobox，再由 DevTools 发送 Enter，覆盖公开键盘契约。
     */
    trigger.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${serializedOption}
      && candidate.getAttribute('aria-disabled') !== 'true'
    )))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => (
        candidate.getClientRects().length > 0
        && candidate.textContent?.trim() === ${serializedOption}
        && candidate.getAttribute('aria-disabled') !== 'true'
      ))
    if (!option) throw new Error('filter option unavailable')
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  // SelectItem 在 nextTick 中提交值；必须等 Trigger 显示新值再点击“应用筛选”。
  await page.waitFor(`(() => [...document.querySelectorAll('label')].some(candidate => (
    candidate.getClientRects().length > 0
    && candidate.textContent?.includes(${serializedLabel})
    && candidate.querySelector('[role="combobox"]')
      ?.textContent?.trim() === ${serializedOption}
  )))()`)
}

/**
 * 页面权限矩阵只验证客户端按服务端 AuthContext 展示的可见操作；真实 Server
 * 403 另由无权限身份请求断言，不能把这项 DOM 断言冒充服务端授权证据。
 */
export function patchPermissionsExpression(permissions) {
  return authStoreExpression(`
    globalThis.__regionOriginalAuthContext ??= JSON.parse(
      JSON.stringify(store.authContext),
    )
    store.$patch({
      authContext: {
        ...store.authContext,
        permissions: ${JSON.stringify(permissions)},
      },
    })
    return [...store.permissions]
  `)
}

export function restorePermissionsExpression() {
  return authStoreExpression(`
    if (!globalThis.__regionOriginalAuthContext) {
      throw new Error('original auth context unavailable')
    }
    store.$patch({
      authContext: JSON.parse(JSON.stringify(
        globalThis.__regionOriginalAuthContext,
      )),
    })
    return [...store.permissions]
  `)
}

export async function failResponseAfterServerMutation(
  page,
  urlPattern,
  method,
  action,
) {
  await page.enableRequestInterception([{
    requestStage: 'Response',
    urlPattern,
  }])
  let targetRequestId
  const predicate = event => event.request?.method === method
    && Number(event.responseStatusCode) >= 200
    && Number(event.responseStatusCode) < 300
  const removeListener = page.on('Fetch.requestPaused', (event) => {
    if (predicate(event) && targetRequestId === undefined) {
      targetRequestId = event.requestId
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    const paused = page.waitForEvent('Fetch.requestPaused', predicate, 20_000)
    const [event] = await Promise.all([paused, action()])
    targetRequestId = event.requestId
    await page.failInterceptedRequest(event.requestId)
    // reconciliation GET 同样匹配 URL；保留 interception 直到页面开始对账。
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  finally {
    removeListener()
    await page.disableRequestInterception()
  }
}
