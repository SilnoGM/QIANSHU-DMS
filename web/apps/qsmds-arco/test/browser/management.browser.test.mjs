/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
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

async function verifyFundAccountRoutes(page, baseUrl) {
  for (const [routePath, title] of [
    ['/qs-finance/fund-accounts/list', '资金账户列表'],
    ['/qs-finance/fund-accounts/transactions', '资金账户流水'],
  ]) {
    await page.navigate(appRouteUrl(baseUrl, routePath))
    await page.waitFor(`(() => (
      location.hash === ${JSON.stringify(`#${routePath}`)}
      && document.body.innerText.includes(${JSON.stringify(title)})
      && !document.body.innerText.includes('找不到页面')
    ))()`)
  }
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

async function clickVisibleCardButton(page, cardTestId, cardText, buttonText) {
  await page.waitFor(`(() => {
    const card = [...document.querySelectorAll(${JSON.stringify(`[data-testid="${cardTestId}"]`)})]
      .find(candidate => (
        candidate.textContent?.includes(${JSON.stringify(cardText)})
        && candidate.getClientRects().length > 0
      ))
    const actions = card?.parentElement?.querySelector('[data-slot="qs-generic-table-mobile-actions"]')
    return [...(actions?.querySelectorAll('button') ?? [])].some(button => (
      button.textContent?.trim() === ${JSON.stringify(buttonText)}
      && button.getClientRects().length > 0
      && !button.disabled
    ))
  })()`)
  await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(${JSON.stringify(`[data-testid="${cardTestId}"]`)})]
      .find(candidate => (
        candidate.textContent?.includes(${JSON.stringify(cardText)})
        && candidate.getClientRects().length > 0
      ))
    const actions = card?.parentElement?.querySelector('[data-slot="qs-generic-table-mobile-actions"]')
    const button = [...(actions?.querySelectorAll('button') ?? [])].find(candidate => (
      candidate.textContent?.trim() === ${JSON.stringify(buttonText)}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible card button unavailable')
    // DOM click 不会像真实键盘操作那样自动建立焦点；先聚焦触发器，才能验证
    // Drawer 关闭后把焦点恢复到用户原先操作的移动端按钮。
    button.focus({ preventScroll: true })
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

/**
 * 管理端表格的操作按钮必须绑定到目标行，避免同名“编辑/更多”按钮误操作
 * 其他用户或角色。marker 使用测试专属用户名/角色编码，不写入诊断日志。
 */
async function clickVisibleTableRowButton(page, marker, text) {
  const serializedMarker = JSON.stringify(marker)
  const serializedText = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('tr')].some((row) => (
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
    if (!button) throw new Error('table row button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

async function pressKey(page, key, code = key) {
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

async function clickVisibleAriaButton(page, label) {
  const serializedLabel = JSON.stringify(label)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some(button => (
    button.getAttribute('aria-label') === ${serializedLabel}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${serializedLabel}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('visible aria button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

/** 产品和地区筛选共享 QsGenericTable 的公开 label/combobox/option 键盘契约。 */
async function selectVisibleFilter(page, label, option) {
  const serializedLabel = JSON.stringify(label)
  const serializedOption = JSON.stringify(option)
  await page.waitFor(`(() => [...document.querySelectorAll('label')].some(candidate => (
    candidate.getClientRects().length > 0
    && candidate.textContent?.includes(${serializedLabel})
    && candidate.querySelector('[role="combobox"]')
  )))()`)
  await page.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${serializedLabel})
      && candidate.querySelector('[role="combobox"]')
    ))
    const trigger = label?.querySelector('[role="combobox"]')
    if (!trigger) throw new Error('filter trigger unavailable')
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
  await page.waitFor(`(() => [...document.querySelectorAll('label')].some(candidate => (
    candidate.getClientRects().length > 0
    && candidate.textContent?.includes(${serializedLabel})
    && candidate.querySelector('[role="combobox"]')
      ?.textContent?.trim() === ${serializedOption}
  )))()`)
}

function requestPathname(event) {
  try {
    return new URL(event.request?.url).pathname
  }
  catch {
    return ''
  }
}

/**
 * 原生 setter 驱动当前可见控件，避免依赖 FaInput/FaSelect 的私有 class。
 * Browser 场景只使用公开 placeholder、data-currency 与 label 文本定位。
 */
async function fillVisibleProductControl(page, selector, value, visibleIndex = 0) {
  const serializedSelector = JSON.stringify(selector)
  const serializedValue = JSON.stringify(value)
  const serializedVisibleIndex = JSON.stringify(visibleIndex)
  await page.waitFor(`(() => [...document.querySelectorAll(${serializedSelector})]
    .filter(control => control.getClientRects().length > 0 && !control.disabled)
    .length > ${serializedVisibleIndex})()`)
  await page.evaluate(`(() => {
    const control = [...document.querySelectorAll(${serializedSelector})]
      .filter(candidate => candidate.getClientRects().length > 0 && !candidate.disabled)
      [${serializedVisibleIndex}]
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
      throw new Error('visible product control unavailable')
    }
    control.focus({ preventScroll: true })
    control.select()
    return document.activeElement === control
  })()`)
  await page.connection.send('Input.insertText', { text: value })
  await page.waitFor(`(() => [...document.querySelectorAll(${serializedSelector})]
    .filter(control => control.getClientRects().length > 0 && !control.disabled)
    [${serializedVisibleIndex}]?.value === ${serializedValue})()`)
  // FaInput 的 passive useVModel 经 watcher 向上提交；等待两帧保证嵌套
  // MoneyInput 与页面 formModel 都已消费更新，不能只把原生 DOM 值当成完成。
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
}

async function selectVisibleComboboxOption(page, labelText, optionText) {
  const serializedLabel = JSON.stringify(labelText)
  const serializedOption = JSON.stringify(optionText)
  await page.waitFor(`(() => [...document.querySelectorAll('label')].some(label => (
    label.getClientRects().length > 0
    && label.textContent?.includes(${serializedLabel})
    && label.parentElement?.querySelector('[role="combobox"]')
  )))()`)
  await page.evaluate(`(() => {
    const label = [...document.querySelectorAll('label')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${serializedLabel})
      && candidate.parentElement?.querySelector('[role="combobox"]')
    ))
    const trigger = label?.parentElement?.querySelector('[role="combobox"]')
    if (!trigger) throw new Error('product combobox unavailable')
    trigger.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => option.getClientRects().length > 0
      && option.textContent?.trim() === ${serializedOption}
      && option.getAttribute('aria-disabled') !== 'true'))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${serializedOption}
      && candidate.getAttribute('aria-disabled') !== 'true'
    ))
    if (!option) throw new Error('product option unavailable')
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('label')].some(label => (
    label.getClientRects().length > 0
    && label.textContent?.includes(${serializedLabel})
    && (() => {
      const trigger = label.parentElement?.querySelector('[role="combobox"]')
      const displayValue = trigger instanceof HTMLInputElement
        ? trigger.value
        : trigger?.textContent?.trim()
      return displayValue === ${serializedOption}
    })()
  )))()`)
}

async function verifyProductCreate(page, baseUrl) {
  const productName = 'Browser 创建产品'

  // 受控失败首个 Currency Catalog 请求，页面必须进入可恢复错误态且保留草稿。
  await page.enableRequestInterception([{
    requestStage: 'Request',
    urlPattern: `${baseUrl}/api/currency-catalog`,
  }])
  let rejectCatalogRequests = true
  const removeCatalogListener = page.on('Fetch.requestPaused', (event) => {
    if (rejectCatalogRequests && requestPathname(event) === '/api/currency-catalog') {
      void page.failInterceptedRequest(event.requestId).catch(() => undefined)
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    await page.navigate(appRouteUrl(baseUrl, '/admin/products/create'))
    await page.waitFor(`document.body.innerText.includes('货币资料加载失败')`)
    rejectCatalogRequests = false
    await fillVisibleProductControl(
      page,
      'input[placeholder="请输入产品名称"]',
      productName,
    )
    await clickVisibleButton(page, '重试货币资料')
    await page.waitFor(`(() => {
      const input = document.querySelector('input[placeholder="请输入产品名称"]')
      const currencyReady = code => document.querySelector(
        'input[data-currency="' + code + '"][data-currency-enabled="true"]',
      ) !== null
      return input?.value === ${JSON.stringify(productName)}
        && !document.body.innerText.includes('货币资料加载失败')
        && !document.body.innerText.includes('正在加载货币资料')
        && ['CNY', 'MYR', 'TWD'].every(currencyReady)
    })()`)
  }
  finally {
    removeCatalogListener()
    await page.disableRequestInterception()
  }

  const defaultState = await page.evaluate(`(() => ({
    documentFits: document.documentElement.scrollWidth <= innerWidth,
    hasMediaInput: [...document.querySelectorAll('input')].some(input => (
      input.type === 'file' || input.placeholder?.includes('图片') || input.placeholder?.includes('视频')
    )),
    name: document.querySelector('input[placeholder="请输入产品名称"]')?.value ?? null,
    purchaseCurrency: document.querySelector('input[data-currency="CNY"]') !== null,
    showsDraft: document.body.innerText.includes('草稿（DRAFT）'),
  }))()`)
  assert.deepEqual(defaultState, {
    documentFits: true,
    hasMediaInput: false,
    name: productName,
    purchaseCurrency: true,
    showsDraft: true,
  })

  await selectVisibleComboboxOption(page, '产品状态', '启用（ACTIVE）')
  await selectVisibleComboboxOption(page, '供应商', 'Browser 有效供应商')
  await fillVisibleProductControl(page, 'input[data-currency="TWD"]', '1280.50')
  await fillVisibleProductControl(page, 'input[data-currency="MYR"]', '42.25')
  await fillVisibleProductControl(page, 'input[data-currency="CNY"]', '88.10')
  await clickVisibleAriaButton(page, '新增一项产品属性')
  await fillVisibleProductControl(page, 'input[placeholder="例如：颜色"]', '尺寸')
  await fillVisibleProductControl(page, 'input[placeholder="例如：墨黑"]', 'XL')
  await clickVisibleAriaButton(page, '新增一项产品属性')
  const titleInputs = await page.evaluate(`(() => [...document.querySelectorAll(
    'input[placeholder="例如：颜色"]',
  )].filter(input => input.getClientRects().length > 0).length)()`)
  assert.equal(titleInputs, 2)
  // 两个字段必须跨 Vue 的渲染周期写入；同栈连续写会让后一笔基于旧 props
  // 覆盖前一笔，浏览器验收必须遵循真实用户逐项输入的更新时序。
  await fillVisibleProductControl(page, 'input[placeholder="例如：颜色"]', '颜色', 1)
  await fillVisibleProductControl(page, 'input[placeholder="例如：墨黑"]', '墨黑', 1)
  await clickVisibleAriaButton(page, '上移第 2 项属性')

  // 提交前先核对用户可见值，避免把前端校验未通过误诊为网络超时。
  const filledForm = await page.evaluate(`(() => {
    const visibleValues = selector => [...document.querySelectorAll(selector)]
      .filter(input => input.getClientRects().length > 0)
      .map(input => input.value)
    const selectedValue = labelText => {
      const label = [...document.querySelectorAll('label')].find(candidate => (
        candidate.getClientRects().length > 0
        && candidate.textContent?.includes(labelText)
        && candidate.parentElement?.querySelector('[role="combobox"]')
      ))
      const trigger = label?.parentElement?.querySelector('[role="combobox"]')
      return trigger instanceof HTMLInputElement
        ? trigger.value
        : trigger?.textContent?.trim() ?? null
    }
    return {
      attributeTitles: visibleValues('input[placeholder="例如：颜色"]'),
      attributeValues: visibleValues('input[placeholder="例如：墨黑"]'),
      catalogErrors: ['货币资料加载失败', '供应商资料加载失败']
        .filter(message => document.body.innerText.includes(message)),
      money: {
        CNY: visibleValues('input[data-currency="CNY"]'),
        MYR: visibleValues('input[data-currency="MYR"]'),
        TWD: visibleValues('input[data-currency="TWD"]'),
      },
      name: visibleValues('input[placeholder="请输入产品名称"]'),
      status: selectedValue('产品状态'),
      supplier: selectedValue('供应商'),
    }
  })()`)
  assert.deepEqual(filledForm, {
    attributeTitles: ['颜色', '尺寸'],
    attributeValues: ['墨黑', 'XL'],
    catalogErrors: [],
    money: {
      CNY: ['88.10'],
      MYR: ['42.25'],
      TWD: ['1280.50'],
    },
    name: [productName],
    status: '启用（ACTIVE）',
    supplier: 'Browser 有效供应商',
  })

  // 请求拦截只把本次真实 HTTP body 的金额改为非法值；页面 snapshot 仍保持合法。
  // 这样可验证真实 Server 422 fieldErrors 被映射回金额控件并完整保留草稿。
  await page.enableRequestInterception([{
    requestStage: 'Request',
    urlPattern: `${baseUrl}/api/products`,
  }])
  let fieldErrorRequestId
  let fieldErrorOriginalBody
  const removeFieldErrorListener = page.on('Fetch.requestPaused', (event) => {
    if (
      fieldErrorRequestId === undefined
      && event.request?.method === 'POST'
      && requestPathname(event) === '/api/products'
    ) {
      fieldErrorRequestId = event.requestId
      const body = JSON.parse(event.request.postData)
      fieldErrorOriginalBody = structuredClone(body)
      body.twdSalePrice.amount = '-1'
      void page.connection.send('Fetch.continueRequest', {
        postData: Buffer.from(JSON.stringify(body)).toString('base64'),
        requestId: event.requestId,
      }).catch(() => undefined)
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    const fieldErrorResponse = page.waitForEvent(
      'Network.responseReceived',
      event => requestPathname({ request: { url: event.response?.url } }) === '/api/products',
      20_000,
    )
    await clickVisibleButton(page, '创建产品')
    const response = await fieldErrorResponse
    assert.equal(response.response?.status, 422)
    assert.deepEqual({
      myrSalePrice: fieldErrorOriginalBody?.myrSalePrice,
      purchaseCost: fieldErrorOriginalBody?.purchaseCost,
      twdSalePrice: fieldErrorOriginalBody?.twdSalePrice,
    }, {
      myrSalePrice: { amount: '42.25', currency: 'MYR' },
      purchaseCost: { amount: '88.10', currency: 'CNY' },
      twdSalePrice: { amount: '1280.50', currency: 'TWD' },
    })
    await page.waitFor(`(() => {
      const input = document.querySelector('input[data-currency="TWD"]')
      return document.body.innerText.includes('请求参数校验失败')
        && input?.getAttribute('aria-invalid') === 'true'
    })()`)
  }
  finally {
    removeFieldErrorListener()
    await page.disableRequestInterception()
  }
  assert.equal(await page.evaluate(`document.querySelector(
    'input[placeholder="请输入产品名称"]',
  )?.value`), productName)

  // 暂停真实 POST，在同一事件循环同步点击两次；按钮锁应保证只发出一条请求。
  await page.enableRequestInterception([{
    requestStage: 'Request',
    urlPattern: `${baseUrl}/api/products`,
  }])
  const heldProductRequests = new Map()
  const removeProductListener = page.on('Fetch.requestPaused', (event) => {
    if (event.request?.method === 'POST' && requestPathname(event) === '/api/products') {
      heldProductRequests.set(event.requestId, event)
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  try {
    const firstPaused = page.waitForEvent(
      'Fetch.requestPaused',
      event => event.request?.method === 'POST'
        && requestPathname(event) === '/api/products',
      20_000,
    )
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(candidate => (
        candidate.textContent?.trim() === '创建产品'
        && candidate.getClientRects().length > 0
        && !candidate.disabled
      ))
      if (!button) throw new Error('create product button unavailable')
      button.click()
      button.click()
      return true
    })()`)
    const first = await firstPaused
    const firstBody = JSON.parse(first.request.postData)
    assert.deepEqual({
      myrSalePrice: firstBody.myrSalePrice,
      purchaseCost: firstBody.purchaseCost,
      twdSalePrice: firstBody.twdSalePrice,
    }, {
      myrSalePrice: { amount: '42.25', currency: 'MYR' },
      purchaseCost: { amount: '88.10', currency: 'CNY' },
      twdSalePrice: { amount: '1280.50', currency: 'TWD' },
    })
    await page.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(candidate => candidate.textContent?.trim() === '创建产品')
      return button?.disabled === true && document.querySelector('[aria-busy="true"]') !== null
    })()`)
    assert.equal(heldProductRequests.size, 1)
    await page.failInterceptedRequest(first.requestId)
    heldProductRequests.delete(first.requestId)
    await page.waitFor(`document.body.innerText.includes('创建结果暂时无法确认')`)
    const frozenState = await page.evaluate(`(() => ({
      createButtonVisible: [...document.querySelectorAll('button')].some(button => (
        button.textContent?.trim() === '创建产品' && button.getClientRects().length > 0
      )),
      inputDisabled: document.querySelector('input[placeholder="请输入产品名称"]')?.disabled,
      name: document.querySelector('input[placeholder="请输入产品名称"]')?.value,
    }))()`)
    assert.deepEqual(frozenState, {
      createButtonVisible: false,
      inputDisabled: true,
      name: productName,
    })

    const replayPaused = page.waitForEvent(
      'Fetch.requestPaused',
      event => event.request?.method === 'POST'
        && requestPathname(event) === '/api/products',
      20_000,
    )
    await clickVisibleButton(page, '使用相同请求重新确认')
    const replay = await replayPaused
    const header = (event, name) => Object.entries(event.request.headers)
      .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())?.[1]
    assert.equal(header(replay, 'Idempotency-Key'), header(first, 'Idempotency-Key'))
    assert.equal(replay.request.postData, first.request.postData)
    await page.continueInterceptedRequest(replay.requestId)
    heldProductRequests.delete(replay.requestId)
  }
  finally {
    for (const requestId of heldProductRequests.keys()) {
      await page.continueInterceptedRequest(requestId).catch(() => undefined)
    }
    removeProductListener()
    await page.disableRequestInterception()
  }

  await page.waitFor(`(() => location.hash === '#/admin/products/list'
    && document.body.innerText.includes(${JSON.stringify(productName)}))()`)
  await page.waitFor(`document.body.innerText.includes('PRD-BRW-00000001')`)

  const productResponse = await page.evaluate(apiExpression(
    `/api/products?page=1&pageSize=20&keyword=${encodeURIComponent(productName)}`,
    'GET',
  ))
  assert.equal(productResponse.status, 200)
  const product = productResponse.body?.items?.find(item => item.name === productName)
  assert.deepEqual({
    attributes: product?.attributes,
    media: product?.media,
    myrSalePrice: product?.myrSalePrice,
    productNo: product?.productNo,
    purchaseCost: product?.purchaseCost,
    status: product?.status,
    supplierValue: product?.supplier?.value,
    twdSalePrice: product?.twdSalePrice,
  }, {
    attributes: [
      { title: '颜色', value: '墨黑' },
      { title: '尺寸', value: 'XL' },
    ],
    media: { images: [], mainImage: null, videos: [] },
    myrSalePrice: { amount: '42.25', currency: 'MYR' },
    productNo: 'PRD-BRW-00000001',
    purchaseCost: { amount: '88.1', currency: 'CNY' },
    status: 'ACTIVE',
    supplierValue: 'BROWSER_SUPPLIER_EFFECTIVE',
    twdSalePrice: { amount: '1280.5', currency: 'TWD' },
  })
  assert.equal(typeof product?.id, 'string')

  const audits = await page.evaluate(apiExpression(
    '/api/audit-events?page=1&pageSize=100',
    'GET',
  ))
  const productAudits = audits.body?.items?.filter(event => (
    event.eventType === 'PRODUCT_CREATED' && event.targetId === product.id
  ))
  assert.equal(productAudits?.length, 1)
  assert.deepEqual(productAudits[0]?.metadata, {
    attributeCount: 2,
    myrSalePriceProvided: true,
    productNo: product.productNo,
    purchaseCostProvided: true,
    status: 'ACTIVE',
    supplierSelected: true,
    twdSalePriceProvided: true,
  })

  const rules = await page.evaluate(apiExpression(
    '/api/numbering-rules?page=1&pageSize=20&keyword=PRODUCT',
    'GET',
  ))
  const productRule = rules.body?.items?.find(rule => rule.ruleCode === 'PRODUCT')
  assert.equal(typeof productRule?.id, 'string')
  const issuances = await page.evaluate(apiExpression(
    `/api/numbering-rules/${productRule.id}/issuances?page=1&pageSize=20&consumerCode=PRODUCT.CREATE`,
    'GET',
  ))
  assert.deepEqual(issuances.body?.items?.map(item => item.generatedNumber), [
    product.productNo,
  ])

  // 未保存离开、窄屏、dark 与 reduced-motion 在真实页面上共同验收。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(baseUrl, '/admin/products/create'))
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await fillVisibleProductControl(
    page,
    'input[placeholder="请输入产品名称"]',
    'Browser 未保存草稿',
  )
  await page.evaluate(`(() => {
    document.documentElement.classList.remove('light')
    document.documentElement.classList.add('dark')
    return true
  })()`)
  const mobileState = await page.evaluate(`(() => ({
    dark: document.documentElement.classList.contains('dark'),
    documentFits: document.documentElement.scrollWidth <= innerWidth,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    touchTargets: [...document.querySelectorAll('[data-testid="product-create-page"] button')]
      .filter(button => button.getClientRects().length > 0)
      .every(button => button.getBoundingClientRect().height >= 44),
  }))()`)
  assert.deepEqual(mobileState, {
    dark: true,
    documentFits: true,
    reducedMotion: true,
    touchTargets: true,
  })
  await clickVisibleButton(page, '取消')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('放弃未保存的产品？')))()`)
  assert.equal(locationHashPath(await page.evaluate('location.hash')), '/admin/products/create')
  await clickVisibleModalButton(page, '继续编辑')
  await waitForNoVisibleModal(page, '放弃未保存的产品？')
  assert.equal(await page.evaluate(`document.querySelector(
    'input[placeholder="请输入产品名称"]',
  )?.value`), 'Browser 未保存草稿')
  await clickVisibleButton(page, '取消')
  await clickVisibleModalButton(page, '确认放弃')
  await page.waitFor(`location.hash === '#/admin/products/list'`)
  await page.connection.send('Emulation.setEmulatedMedia', { features: [] })
  await page.evaluate(`(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
    return true
  })()`)
  await page.setViewport(1440, 900, false)
}

async function waitForProductList(page, expectedText) {
  const serializedText = JSON.stringify(expectedText)
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="product-list-table"]')
    return root?.getClientRects().length > 0
      && root.querySelector('[aria-busy="false"]') !== null
      && root.textContent?.includes(${serializedText})
  })()`)
}

/**
 * 产品查询刷新会复用相同行内的 ImageGroup。管理场景的历史媒体夹具刻意没有
 * 物理文件，因此 loaded/error 都是合法终态，但刷新后绝不能永久退回 loading。
 */
async function waitForProductImagesSettled(page, productNo) {
  const serializedProductNo = JSON.stringify(productNo)
  await page.waitFor(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find(candidate => (
      candidate.textContent?.includes(${serializedProductNo})
    ))
    const images = [...(row?.querySelectorAll('[data-slot="image-group"] img') ?? [])]
      .filter(image => image.getClientRects().length > 0)
    return images.length > 0 && images.every(image => (
      ['loaded', 'error'].includes(image.parentElement?.getAttribute('data-image-state'))
    ))
  })()`)
}

async function verifyProductList(page, baseUrl) {
  const productNo = 'PRODUCT-BROWSER-001'
  const productRequests = []
  const stopRequestProbe = page.on('Network.requestWillBeSent', (event) => {
    try {
      const url = new URL(event.request?.url)
      if (url.pathname === '/api/products') {
        productRequests.push(url)
      }
    }
    catch {
      // 非 URL 的 DevTools 事件不属于产品请求，忽略且不进入诊断输出。
    }
  })

  try {
    await page.navigate(appRouteUrl(baseUrl, '/admin/products/list'))
    await waitForProductList(page, productNo)
    await page.waitFor(`document.body.innerText.includes('共 22 条')`)
    await waitForTableTools(page, 'product-list-table', '搜索产品名称或产品编号')

    const desktopState = await page.evaluate(`(() => {
      const root = document.querySelector('[data-testid="product-list-table"]')
      const headers = [...(root?.querySelectorAll('[data-slot="table-head"]') ?? [])]
      const header = text => headers.find(candidate => candidate.textContent?.includes(text))
      return {
        actionPinned: header('操作')?.getAttribute('data-pinned') ?? null,
        createVisible: [...document.querySelectorAll('button')].some(button => (
          button.textContent?.trim() === '新增产品'
          && button.getClientRects().length > 0
        )),
        productNoPinned: header('产品编号')?.getAttribute('data-pinned') ?? null,
        visibleDesktopTables: [...(root?.querySelectorAll('table') ?? [])]
          .filter(table => table.getClientRects().length > 0).length,
      }
    })()`)
    assert.deepEqual(desktopState, {
      actionPinned: 'right',
      createVisible: true,
      productNoPinned: 'left',
      visibleDesktopTables: 1,
    })

    // 列设置必须允许业务列显隐/固定，同时保持产品编号和操作列默认边界。
    await clickVisibleButton(page, '列设置')
    await page.waitFor(`document.querySelector(
      '[aria-label="产品编号：固定在左侧"][aria-pressed="true"]',
    ) !== null`)
    await clickVisibleAriaButton(page, '产品图片：固定在右侧')
    await page.waitFor(`document.querySelector(
      '[aria-label="产品图片：固定在右侧"][aria-pressed="true"]',
    ) !== null`)
    await clickVisibleButton(page, '恢复默认')

    const visibleText = await page.evaluate('document.body.innerText')
    for (const text of [
      'Browser 有效供应商',
      'Browser 停用供应商',
      '未知',
      'NT$1,234.57 TWD',
      '¥88.90 CNY',
      '10.5 ZZZ',
    ]) {
      assert.equal(visibleText.includes(text), true, `缺少产品展示文本：${text}`)
    }

    // 新增、查看与编辑都必须进入真实交互，不允许回退到占位轻提示。
    await clickVisibleButton(page, '新增产品')
    await page.waitFor(`(() => location.hash === '#/admin/products/create'
      && [...document.querySelectorAll('button')].some(button => (
        button.textContent?.trim() === '创建产品' && button.getClientRects().length > 0
      )))()`)
    await clickVisibleButton(page, '返回产品列表')
    await waitForProductList(page, productNo)
    await clickVisibleTableRowButton(page, productNo, '查看')
    await page.waitFor(`(() => {
      const drawer = document.querySelector('[data-testid="product-detail-drawer"]')
      return drawer?.getClientRects().length > 0
        && drawer.textContent?.includes(${JSON.stringify(productNo)})
        && drawer.textContent?.includes('价格资料')
        && drawer.textContent?.includes('数据版本')
    })()`)
    const productDetailLayout = await page.evaluate(`(() => {
      const drawer = document.querySelector('[data-testid="product-detail-drawer"]')
      const dialog = drawer?.closest('[role="dialog"]')
      const sections = [...(drawer?.querySelectorAll(':scope > section') ?? [])]
      const labels = sections.map(section => section.querySelector('h3, p')?.textContent?.trim())
      const leftEdges = sections.map(section => Math.round(section.getBoundingClientRect().left))
      const scrollContainer = [...(dialog?.querySelectorAll('*') ?? [])].find(element => {
        const overflowY = getComputedStyle(element).overflowY
        return ['auto', 'scroll'].includes(overflowY)
          && element.scrollHeight > element.clientHeight
      })
      return {
        fitsHorizontally: dialog !== null && dialog.scrollWidth <= dialog.clientWidth,
        labels,
        sectionCount: sections.length,
        singleColumn: new Set(leftEdges).size === 1,
        verticallyScrollable: scrollContainer !== undefined,
      }
    })()`)
    assert.deepEqual(productDetailLayout, {
      fitsHorizontally: true,
      labels: ['产品身份', '供应商', '价格资料', '产品属性（2）', '媒体资料', '审计信息'],
      sectionCount: 6,
      singleColumn: true,
      verticallyScrollable: true,
    })
    // Drawer 的 footer slot 必须从首次挂载起保持稳定，否则详情加载后会遗失
    // “编辑产品”入口；直接从真实详情进入编辑页覆盖该运行时边界。
    await clickVisibleButton(page, '编辑产品')
    await page.waitFor(`(() => (
      location.hash.startsWith('#/admin/products/')
      && location.hash.endsWith('/edit')
      && document.querySelector('[data-testid="product-edit-page"]')?.textContent?.includes(
        ${JSON.stringify(productNo)},
      )
      && [...document.querySelectorAll('button')].some(button => (
        button.textContent?.trim() === '保存修改'
        && button.getClientRects().length > 0
        && !button.disabled
      ))
    ))()`)
    // 该多媒体夹具刻意保留一项历史缺失金额，用于列表容错展示；编辑页应能
    // 真实读取它，但本场景不提交修复。当前表单无法规范化该历史快照时按
    // 保守脏状态处理，离开必须经过明确确认，避免误以为资料已安全保存。
    await clickVisibleButton(page, '返回产品列表')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes('放弃未保存的产品修改？')))()`)
    await clickVisibleModalButton(page, '确认放弃')
    await waitForProductList(page, productNo)

    // ImageGroup 第三个可见位是 +2，点击后从第三张进入完整四图预览。
    await clickVisibleAriaButton(page, '查看其余 2 张图片')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
      dialog.getClientRects().length > 0
      && dialog.textContent?.includes('3 / 4')
    )))()`)
    await pressKey(page, 'Escape')
    await waitForNoVisibleModal(page, '3 / 4')

    await clickVisibleTableRowButton(page, productNo, '2 项属性')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
      dialog.getClientRects().length > 0
      && dialog.textContent?.includes('颜色')
      && dialog.textContent?.includes('墨黑')
      && dialog.textContent?.includes('尺寸')
      && dialog.textContent?.includes('XL')
    )))()`)
    await pressKey(page, 'Escape')
    await waitForNoVisibleModal(page, '产品属性')
    await page.waitFor(`document.activeElement?.textContent?.trim() === '2 项属性'`)

    // 固定第一段能力错误的注入时机：夹具真实内容为 404，Linux 快速响应可能
    // 在两次 CDP 调用之间卸载 video。只暂停媒体请求，注入完成后立即恢复。
    await page.enableRequestInterception([{ resourceType: 'Media', requestStage: 'Request', urlPattern: '*' }])
    try {
      await clickVisibleTableRowButton(page, productNo, '2 个视频')
      await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('产品视频'))
      const link = dialog?.querySelector('a[target="_blank"]')
      return dialog?.querySelector('video[controls]') instanceof HTMLVideoElement
        && link?.getAttribute('rel') === 'noopener noreferrer'
    })()`)
      await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('产品视频'))
      const video = dialog?.querySelector('video')
      if (!(video instanceof HTMLVideoElement)) throw new Error('preview video unavailable')
      Object.defineProperty(video, 'error', {
        configurable: true,
        // 4 是规范定义的 MEDIA_ERR_SRC_NOT_SUPPORTED。使用协议常量可避免部分
        // Headless Chrome 环境没有暴露 MediaError 构造器而导致测试脚本自身失败。
        value: { code: 4 },
      })
      video.dispatchEvent(new Event('error'))
      return true
    })()`)
      await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('产品视频'))
      return dialog?.textContent?.includes('当前浏览器不支持此视频')
        && dialog.querySelector('[aria-label="下载视频 browser-management-overview.mp4"]') !== null
        && dialog.querySelector('a[target="_blank"]') !== null
    })()`)
    }
    finally {
      await page.disableRequestInterception()
    }
    // 历史媒体夹具只有数据库记录，没有物理文件。切换后应等待真实 404 驱动的
    // 用户可见失败态；瞬时 <video> 是否赶在 error 事件前被采样与机器速度有关，
    // 不能作为最终契约。下载入口和安全外链仍必须切换到第二个视频。
    await clickVisibleModalButton(page, 'browser-management-detail.mp4')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('产品视频'))
      const hasFailure = ['当前浏览器不支持此视频', '视频加载失败']
        .some(message => dialog?.textContent?.includes(message))
      return hasFailure
        && dialog.querySelector('[aria-label="下载视频 browser-management-detail.mp4"]') !== null
        && dialog.querySelector('a[target="_blank"]') !== null
        && !dialog.textContent?.includes('javascript:')
    })()`)
    await clickVisibleModalButton(page, '关闭视频')
    await waitForNoVisibleModal(page, '产品视频')

    // 第二页请求必须保持 Server 分页；从第二页搜索时回到第一页，并允许继续
    // 与启用状态、供应商 stable value 组合为同一次 Server 查询。
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('[data-slot="pagination-next"]')]
        .find(candidate => candidate.getClientRects().length > 0 && !candidate.disabled)
      if (!button) throw new Error('product next page unavailable')
      button.click()
      return true
    })()`)
    await waitForProductList(page, 'PRODUCT-BROWSER-FILLER-01')
    await fillVisibleInput(
      page,
      'input[placeholder="搜索产品名称或产品编号"]',
      productNo.toLowerCase(),
    )
    await clickVisibleButton(page, '查询')
    await waitForProductList(page, productNo)
    await page.waitFor(`document.body.innerText.includes('共 1 条')`)
    await clickVisibleButton(page, '筛选')
    await selectVisibleFilter(page, '启用状态', '已启用')
    await selectVisibleFilter(page, '供应商', 'Browser 有效供应商')
    await clickVisibleButton(page, '应用筛选')
    await waitForProductList(page, productNo)
    await page.waitFor(`document.body.innerText.includes('共 1 条')`)
    await waitForProductImagesSettled(page, productNo)
    assert.equal(await page.evaluate(`document.body.innerText.includes(
      'Browser 停用供应商产品',
    )`), false)
    assert.equal(productRequests.some(url => (
      url.searchParams.get('page') === '2'
      && url.searchParams.get('pageSize') === '20'
    )), true)
    assert.equal(productRequests.some(url => (
      url.searchParams.get('page') === '1'
      && url.searchParams.get('keyword') === productNo.toLowerCase()
      && url.searchParams.get('status') === 'ACTIVE'
      && url.searchParams.get('supplierValue') === 'BROWSER_SUPPLIER_EFFECTIVE'
    )), true)
    await clickVisibleButton(page, '清空筛选')
    await waitForProductList(page, productNo)
    await page.waitFor(`document.body.innerText.includes('共 1 条')`)
    await waitForProductImagesSettled(page, productNo)
    const clearedFilterRequest = productRequests.at(-1)
    assert.equal(clearedFilterRequest?.searchParams.get('keyword'), productNo.toLowerCase())
    assert.equal(clearedFilterRequest?.searchParams.has('status'), false)
    assert.equal(clearedFilterRequest?.searchParams.has('supplierValue'), false)
    await fillVisibleInput(
      page,
      'input[placeholder="搜索产品名称或产品编号"]',
      '',
    )
    await clickVisibleButton(page, '查询')
    await waitForProductList(page, productNo)
    await page.waitFor(`document.body.innerText.includes('共 22 条')`)

    // 移动端复用同一行数据，禁止页面级横向溢出，并维持 44px 触控下限。
    await page.setViewport(390, 844, true)
    await page.waitFor(`(() => {
      const actions = [...document.querySelectorAll(
        '[data-slot="qs-generic-table-mobile-actions"]',
      )].find(candidate => candidate.parentElement?.textContent?.includes(${JSON.stringify(productNo)}))
      const card = actions?.parentElement
      const rect = card?.getBoundingClientRect()
      return rect && rect.left >= 0 && rect.right <= innerWidth
    })()`)
    const lightBackground = await page.evaluate(`getComputedStyle(document.body).backgroundColor`)
    const mobileState = await page.evaluate(`(() => {
      const root = document.querySelector('[data-testid="product-list-table"]')
      const actions = [...document.querySelectorAll(
        '[data-slot="qs-generic-table-mobile-actions"]',
      )].find(candidate => candidate.parentElement?.textContent?.includes(${JSON.stringify(productNo)}))
      const card = actions?.parentElement
      const buttons = [...(card?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0)
      return {
        allTouchTargetsMeetMinimum: buttons.every(button => (
          button.getBoundingClientRect().height >= 44
        )),
        documentFits: document.documentElement.scrollWidth <= innerWidth,
        hasFourImages: card?.querySelector('[aria-label="图片组，共 4 张"]') !== null,
        hasMainImage: card?.querySelector('[aria-label="图片组，共 1 张"]') !== null,
        hasProductData: card?.textContent?.includes('2 项属性')
          && card.textContent?.includes('2 个视频')
          && card.textContent?.includes('NT$1,234.57 TWD'),
        visibleDesktopTables: [...(root?.querySelectorAll('table') ?? [])]
          .filter(table => table.getClientRects().length > 0).length,
      }
    })()`)
    assert.deepEqual(mobileState, {
      allTouchTargetsMeetMinimum: true,
      documentFits: true,
      hasFourImages: true,
      hasMainImage: true,
      hasProductData: true,
      visibleDesktopTables: 0,
    })

    await page.evaluate(`(() => {
      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
      return true
    })()`)
    const darkState = await page.evaluate(`(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      documentFits: document.documentElement.scrollWidth <= innerWidth,
      theme: document.documentElement.classList.contains('dark'),
    }))()`)
    assert.equal(darkState.theme, true)
    assert.equal(darkState.documentFits, true)
    assert.notEqual(darkState.background, lightBackground)

    await page.connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    assert.equal(await page.evaluate(`matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches`), true)
    await page.evaluate(`(() => {
      const actions = [...document.querySelectorAll(
        '[data-slot="qs-generic-table-mobile-actions"]',
      )].find(candidate => candidate.parentElement?.textContent?.includes(${JSON.stringify(productNo)}))
      const button = [...(actions?.parentElement?.querySelectorAll('button') ?? [])]
        .find(candidate => candidate.textContent?.trim() === '2 项属性')
      if (!button) throw new Error('mobile attributes button unavailable')
      button.focus({ preventScroll: true })
      button.click()
      return true
    })()`)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('产品属性'))
      return dialog?.querySelector('[aria-label="关闭模态框"]')
        ?.getBoundingClientRect().height >= 44
    })()`)
    await pressKey(page, 'Escape')
    await waitForNoVisibleModal(page, '产品属性')
    await page.waitFor(`document.activeElement?.textContent?.trim() === '2 项属性'`)
    await page.connection.send('Emulation.setEmulatedMedia', { features: [] })
    await page.evaluate(`(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
      return true
    })()`)
    await page.setViewport(1280, 800, false)
  }
  finally {
    stopRequestProbe()
  }
}

function locationHashPath(hash) {
  return typeof hash === 'string' ? hash.replace(/^#/u, '') : ''
}

/** 只在当前可见对话框中点击按钮，避免绑定具体组件库的私有 DOM class。 */
async function clickVisibleModalButton(page, text) {
  const serializedText = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some((dialog) => (
    dialog.getClientRects().length > 0
    && [...dialog.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === ${serializedText}
      && button.getClientRects().length > 0
      && !button.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
    const button = dialogs
      .flatMap(dialog => [...dialog.querySelectorAll('button')])
      .find(candidate => candidate.textContent?.trim() === ${serializedText}
        && candidate.getClientRects().length > 0
        && !candidate.disabled)
    if (!button) throw new Error('modal button unavailable')
    button.click()
    return true
  })()`)
}

/**
 * 通过原生 value setter 驱动 Vue 的 input 事件；限定可见对话框后，测试不会
 * 误填页面筛选框或已进入离场动画的旧弹窗。
 */
async function fillVisibleModalControl(page, selector, value) {
  const serializedSelector = JSON.stringify(selector)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some((dialog) => (
    dialog.getClientRects().length > 0
    && [...dialog.querySelectorAll(${serializedSelector})].some(control => (
      control.getClientRects().length > 0
      && !control.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
    const control = dialogs
      .flatMap(dialog => [...dialog.querySelectorAll(${serializedSelector})])
      .find(candidate => candidate.getClientRects().length > 0 && !candidate.disabled)
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
      throw new Error('modal control unavailable')
    }
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${serializedValue})
    control.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

async function fillVisibleInput(page, selector, value) {
  const serializedSelector = JSON.stringify(selector)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll(${serializedSelector})].some(input => (
    input.getClientRects().length > 0 && !input.disabled
  )))()`)
  await page.evaluate(`(() => {
    const input = [...document.querySelectorAll(${serializedSelector})]
      .find(candidate => candidate.getClientRects().length > 0 && !candidate.disabled)
    if (!(input instanceof HTMLInputElement)) throw new Error('visible input unavailable')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${serializedValue})
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

async function waitForNoVisibleModal(page, dialogText) {
  const serializedText = JSON.stringify(dialogText)
  await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes(${serializedText}))`)
}

/**
 * Router 切页动画中的新页面已经拥有布局矩形，但仍可能整体平移在视口外。
 * 窄屏断言必须等待全部卡片真正进入视口，避免把动画中间态误判为横向溢出。
 */
async function waitForCardsInsideViewport(page, selector, expectedText) {
  const serializedSelector = JSON.stringify(selector)
  const serializedExpectedText = JSON.stringify(expectedText ?? null)
  await page.waitFor(`(() => {
    const expectedText = ${serializedExpectedText}
    const cards = [...document.querySelectorAll(${serializedSelector})]
      .filter(card => card.getClientRects().length > 0)
    return cards.length > 0
      && (expectedText === null || cards.some(card => card.textContent?.includes(expectedText)))
      && cards.every((card) => {
        const rect = card.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth
      })
  })()`)
}

/**
 * 四个系统管理页面统一由 QsGenericTable 提供搜索、筛选和列设置。
 * 断言限定在表格根节点内，避免页头业务按钮或其他输入控件造成误报。
 */
async function waitForTableTools(page, tableTestId, searchPlaceholder) {
  const serializedRootSelector = JSON.stringify(`[data-testid="${tableTestId}"]`)
  const serializedPlaceholder = JSON.stringify(searchPlaceholder)
  await page.waitFor(`(() => {
    const root = document.querySelector(${serializedRootSelector})
    if (!root || root.getClientRects().length === 0) return false
    const search = root.querySelector('input[placeholder=' + JSON.stringify(${serializedPlaceholder}) + ']')
    const buttonLabels = [...root.querySelectorAll('button')]
      .filter(button => button.getClientRects().length > 0)
      .map(button => button.textContent?.trim() ?? '')
    return search?.getClientRects().length > 0
      && buttonLabels.some(label => label === '筛选' || label.startsWith('已筛选：'))
      && buttonLabels.includes('列设置')
  })()`)
}

async function selectVisibleModalOption(page, text) {
  const serializedText = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some((dialog) => (
    dialog.getClientRects().length > 0
    && [...dialog.querySelectorAll('[role="checkbox"]')].some((option) => {
      const label = option.id
        ? dialog.querySelector('label[for="' + CSS.escape(option.id) + '"]')
        : null
      const optionText = [option.textContent, label?.textContent]
        .filter(Boolean)
        .join(' ')
      return optionText.includes(${serializedText})
        && option.getClientRects().length > 0
        && option.getAttribute('aria-disabled') !== 'true'
        && !option.disabled
    })
  )))()`)
  await page.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
    const option = dialogs
      .flatMap(dialog => [...dialog.querySelectorAll('[role="checkbox"]')].map(candidate => ({
        candidate,
        dialog,
      })))
      .find(({ candidate, dialog }) => {
        const label = candidate.id
          ? dialog.querySelector('label[for="' + CSS.escape(candidate.id) + '"]')
          : null
        const optionText = [candidate.textContent, label?.textContent]
          .filter(Boolean)
          .join(' ')
        return optionText.includes(${serializedText})
          && candidate.getClientRects().length > 0
          && candidate.getAttribute('aria-disabled') !== 'true'
          && !candidate.disabled
      })?.candidate
    if (!option) throw new Error('checkbox option unavailable')
    option.click()
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
    const current = document.querySelector('input[autocomplete="current-password"]')
    const next = [...document.querySelectorAll('input[autocomplete="new-password"]')]
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

test('真实 Chrome 覆盖管理员用户、角色、权限与审计 UI', {
  timeout: 240_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const passwordSeed = Array.from(configuration.password.normalize('NFC'))
    .slice(0, 8)
    .join('')
  const managedUsername = 'browser_ui_managed'
  const managedInitialPassword = `${passwordSeed}-UI6`
  const managedResetPassword = `${passwordSeed}-UR5`
  const roleCode = 'browser_ui_role'
  const initialRoleName = 'Browser UI Role'
  const editedRoleName = 'Browser UI Operator'
  const editedDisplayName = 'Browser UI Managed Edited'
  const editedEmail = 'browser.ui.managed@example.com'
  const editedMobile = '+8613900139000'
  const editedAvatarUrl = 'https://example.com/browser-ui-managed.png'
  const editedRemark = 'Browser UI administrator note'
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    // 独立 Profile 让本场景不依赖上一场景最终留下的 Cookie 状态。
    userDataDirectory: `${configuration.profileDirectory}-management`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  // 角色编辑先验证桌面表格；Chrome 默认视口可能落入移动端断点，只渲染卡片。
  await page.setViewport(1440, 900, false)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await waitForAuthState(page, 'anonymous')
  await loginThroughUi(page, configuration)

  // 管理员权限迁移必须在真实 AuthContext 中生效，并驱动顶部导航与两个叶子页面。
  await page.waitFor(`document.body.innerText.includes('管理员工作台')`)
  await verifyProductCreate(page, configuration.baseUrl)
  await verifyProductList(page, configuration.baseUrl)
  await verifyFundAccountRoutes(page, configuration.baseUrl)

  // 测试目标用户由受保护 API 准备；本场景关注的是管理员后续每项 UI 管理操作。
  const createdUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser UI Managed',
    mustChangePassword: false,
    password: managedInitialPassword,
    username: managedUsername,
  }))
  assert.equal(createdUser.status, 201)
  assert.equal(createdUser.body?.username, managedUsername)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/roles'))
  await page.waitFor(`(() => (
    document.body.innerText.includes('角色管理')
    && document.body.innerText.includes('system_admin')
  ))()`)
  await waitForTableTools(page, 'role-table', '搜索角色名称、编码或说明')

  // 创建角色后读取真实 API 状态，证明不是只验证了 Toast 或 Modal 动画。
  await clickVisibleButton(page, '创建角色')
  await fillVisibleModalControl(
    page,
    'input[placeholder="例如 warehouse_reader"]',
    roleCode,
  )
  await fillVisibleModalControl(
    page,
    'input[placeholder="请输入便于识别的名称"]',
    initialRoleName,
  )
  await fillVisibleModalControl(
    page,
    'textarea[placeholder="可选；清空后保存将移除原说明"]',
    'Browser UI role created through real Chrome',
  )
  await clickVisibleModalButton(page, '创建角色')
  await waitForNoVisibleModal(page, '创建角色')
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(roleCode)})`)

  let rolesResponse = await page.evaluate(apiExpression('/api/roles', 'GET'))
  assert.equal(rolesResponse.status, 200)
  let managedRole = rolesResponse.body?.find(role => role.code === roleCode)
  assert.equal(managedRole?.name, initialRoleName)
  assert.deepEqual(managedRole?.permissionIds, [])

  await clickVisibleTableRowButton(page, roleCode, '编辑')
  await fillVisibleModalControl(
    page,
    'input[placeholder="请输入便于识别的名称"]',
    editedRoleName,
  )
  await fillVisibleModalControl(
    page,
    'textarea[placeholder="可选；清空后保存将移除原说明"]',
    'Browser UI role edited through real Chrome',
  )
  await clickVisibleModalButton(page, '保存修改')
  await waitForNoVisibleModal(page, '编辑角色')
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(editedRoleName)})`)

  rolesResponse = await page.evaluate(apiExpression('/api/roles', 'GET'))
  assert.equal(rolesResponse.status, 200)
  managedRole = rolesResponse.body?.find(role => role.code === roleCode)
  assert.equal(managedRole?.name, editedRoleName)

  /*
   * 地区、货币、当前汇率、编号规则、唛头绑定、系统字典、包装费用、收款资料与资金账户权限均可分配给
   * 普通角色，同时不能让普通角色越权勾选 users/roles/audit 等系统专用权限。保存后以真实 API 结果
   * 确认完整替换已落库。
   */
  const permissionsResponse = await page.evaluate(
    apiExpression('/api/permissions', 'GET'),
  )
  assert.equal(permissionsResponse.status, 200)
  const regionReadPermission = permissionsResponse.body?.find(
    permission => permission.code === 'regions:read',
  )
  const fundAccountReadPermission = permissionsResponse.body?.find(
    permission => permission.code === 'fund-accounts:read',
  )
  const usersReadPermission = permissionsResponse.body?.find(
    permission => permission.code === 'users:read',
  )
  assert.equal(typeof regionReadPermission?.id, 'string')
  // 2026-10-01 起账户管理整组可委派（迁移 20261001140000），系统专用样本改用 users:read。
  assert.equal(fundAccountReadPermission?.systemOnly, false)
  assert.equal(usersReadPermission?.systemOnly, true)

  await clickVisibleTableRowButton(page, roleCode, '分配权限')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes('分配权限')
    && dialog.textContent?.includes('users:read')
  )))()`)
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('分配权限'))
    const rect = dialog?.getBoundingClientRect()
    return rect !== undefined && Math.abs(window.innerWidth - rect.right) <= 1
  })()`)
  const permissionDrawerState = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('分配权限'))
    const rect = dialog?.getBoundingClientRect()
    const footer = dialog?.querySelector('[data-slot="qs-generic-drawer-footer"]')
    const footerRect = footer?.getBoundingClientRect()
    const options = [...(dialog?.querySelectorAll('[role="checkbox"]') ?? [])]
      .filter(option => option.getClientRects().length > 0)
    return {
      contentUsesGenericDrawer: dialog?.querySelector(
        '[data-slot="qs-generic-drawer"]',
      ) !== null,
      enabledPermissionCodes: options
        .filter(option => (
          option.getAttribute('aria-disabled') !== 'true' && !option.disabled
        ))
        .map(option => option.querySelector('code')?.textContent?.trim())
        .filter(Boolean)
        .sort(),
      footerBottomGap: rect && footerRect ? Math.abs(rect.bottom - footerRect.bottom) : null,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      optionCount: options.length,
      rightGap: rect ? Math.abs(window.innerWidth - rect.right) : null,
      enablesFundAccountManagement: options.some(option => (
        option.textContent?.includes('fund-accounts:read')
        && option.getAttribute('aria-disabled') !== 'true'
        && !option.disabled
      )),
      showsDisabledUsersRead: options.some(option => (
        option.textContent?.includes('users:read')
        && (option.getAttribute('aria-disabled') === 'true' || option.disabled)
      )),
      showsUsersRead: options.some(option => option.textContent?.includes('users:read')),
      width: rect?.width ?? null,
    }
  })()`)
  assert.equal(permissionDrawerState.contentUsesGenericDrawer, true)
  assert.equal(permissionDrawerState.enablesFundAccountManagement, true)
  assert.equal(permissionDrawerState.showsDisabledUsersRead, true)
  assert.equal(permissionDrawerState.showsUsersRead, true)
  assert.ok(permissionDrawerState.optionCount > 0)
  // 可分配权限清单来自权限目录迁移，新增领域后必须同步这里（曾漏过 container-batches 与 slh-bills）。
  assert.deepEqual(permissionDrawerState.enabledPermissionCodes, [
    'container-batches:create',
    'container-batches:read',
    'container-batches:update',
    'currencies:create',
    'currencies:disable',
    'currencies:enable',
    'currencies:read',
    'currencies:update',
    'dictionaries:create',
    'dictionaries:disable',
    'dictionaries:enable',
    'dictionaries:read',
    'dictionaries:update',
    'exchange-rates:create',
    'exchange-rates:read',
    'exchange-rates:update',
    'fund-accounts:create',
    'fund-accounts:manual-adjust',
    'fund-accounts:read',
    'fund-accounts:update-share-rate',
    'fund-business-sources:manage',
    'fund-posting-types:manage',
    'fund-transactions:reverse',
    'numbering-rules:create',
    'numbering-rules:disable',
    'numbering-rules:enable',
    'numbering-rules:publish',
    'numbering-rules:read',
    'numbering-rules:read-issuances',
    'numbering-rules:update',
    'packaging-costs:create',
    'packaging-costs:pay',
    'packaging-costs:read',
    'product-media:read',
    'products:create',
    'products:read',
    'products:update',
    'purchase-orders:create',
    'purchase-orders:document',
    'purchase-orders:payment',
    'purchase-orders:read',
    'purchase-orders:review',
    'purchase-orders:update',
    'purchase-shipping-marks:read',
    'purchase-shipping-marks:update',
    'regions:create',
    'regions:disable',
    'regions:enable',
    'regions:read',
    'regions:update',
    'sales-orders:create',
    'sales-orders:document',
    'sales-orders:payment',
    'sales-orders:read',
    'sales-orders:update',
    'sales-receipts:read',
    'sales-receipts:review',
    'sales-receipts:void',
    'slh-bills:create',
    'slh-bills:read',
    'slh-bills:reconcile',
    'supplier-payment-profiles:read',
    'supplier-payment-profiles:update',
  ])
  assert.equal(Math.round(permissionDrawerState.width), 768)
  assert.ok(permissionDrawerState.rightGap <= 1)
  assert.ok(permissionDrawerState.footerBottomGap <= 2)
  assert.equal(permissionDrawerState.hasHorizontalOverflow, false)
  await selectVisibleModalOption(page, 'regions:read')
  await clickVisibleModalButton(page, '保存权限')
  await waitForNoVisibleModal(page, '分配权限')

  rolesResponse = await page.evaluate(apiExpression('/api/roles', 'GET'))
  managedRole = rolesResponse.body?.find(role => role.code === roleCode)
  assert.equal(rolesResponse.status, 200)
  assert.deepEqual(managedRole?.permissionIds, [regionReadPermission.id])
  assert.equal(typeof managedRole?.id, 'string')

  // 窄屏重新从角色卡片打开同一权限抽屉，证明它占满可用宽度、保留 44px
  // 关闭目标和纵向 Footer，关闭后再把焦点交还给原“分配权限”入口。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/roles'))
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(roleCode)})`)
  await clickVisibleCardButton(page, 'role-card', roleCode, '分配权限')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => {
    const rect = dialog.getBoundingClientRect()
    return dialog.getClientRects().length > 0
      && dialog.textContent?.includes('分配权限')
      && dialog.querySelector('[data-slot="qs-generic-drawer"]')
      && Math.abs(rect.left) <= 1
      && Math.abs(window.innerWidth - rect.right) <= 1
  }))()`)
  const narrowPermissionDrawer = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('分配权限'))
    const rect = dialog?.getBoundingClientRect()
    const closeButtonRect = dialog
      ?.querySelector('[aria-label="关闭抽屉"]')
      ?.getBoundingClientRect()
    const footerButtonWidths = [
      ...(dialog?.querySelectorAll('[data-slot="qs-generic-drawer-footer"] button') ?? []),
    ].map(button => button.getBoundingClientRect().width)
    return {
      closeButtonHeight: closeButtonRect?.height ?? null,
      footerButtonWidths,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      left: rect?.left ?? null,
      right: rect?.right ?? null,
      width: rect?.width ?? null,
    }
  })()`)
  assert.equal(Math.round(narrowPermissionDrawer.left), 0)
  assert.equal(Math.round(narrowPermissionDrawer.right), 390)
  assert.equal(Math.round(narrowPermissionDrawer.width), 390)
  assert.ok(narrowPermissionDrawer.closeButtonHeight >= 44)
  assert.deepEqual(
    narrowPermissionDrawer.footerButtonWidths.map(width => width > 300),
    [true, true],
  )
  assert.equal(narrowPermissionDrawer.hasHorizontalOverflow, false)
  await clickVisibleModalButton(page, '取消')
  await waitForNoVisibleModal(page, '分配权限')
  await page.waitFor(`document.activeElement?.textContent?.trim() === '分配权限'`)

  // 继续在 390px 真机指标下从用户卡片进入重置密码，验证 Drawer -> Modal 的
  // 关键操作链和弹窗宽度；之后再切回桌面表格完成编辑、角色与状态操作。
  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/users'))
  await page.waitFor(`document.body.innerText.includes('用户管理')`)
  await waitForTableTools(page, 'user-table', '输入完整用户名搜索')
  assert.equal(
    await page.evaluate(`document.querySelector('input[placeholder="精确用户名"]') === null`),
    true,
  )
  await fillVisibleInput(page, 'input[placeholder="输入完整用户名搜索"]', managedUsername)
  await clickVisibleButton(page, '查询')
  await page.waitFor(`(() => {
    const table = document.querySelector('[data-testid="user-table"]')
    const cards = [...document.querySelectorAll('[data-testid="user-card"]')]
      .filter(card => card.getClientRects().length > 0)
    return table?.querySelector('[aria-busy="false"]') !== null
      && cards.length === 1
      && cards[0].textContent?.includes(${JSON.stringify(managedUsername)})
  })()`)
  await clickVisibleCardButton(page, 'user-card', managedUsername, '操作')
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`用户操作 · ${managedUsername}`)})`)
  await clickVisibleButton(page, '设置或重置密码')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes('设置或重置密码')
    && dialog.querySelectorAll('input[autocomplete="new-password"]').length === 2
  )))()`)
  const narrowPasswordModal = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('设置或重置密码')
        && candidate.querySelectorAll('input[autocomplete="new-password"]').length === 2)
    const rect = dialog?.getBoundingClientRect()
    return rect === undefined ? null : {
      left: rect.left,
      right: rect.right,
      width: rect.width,
      viewportWidth: innerWidth,
    }
  })()`)
  assert.ok(narrowPasswordModal !== null)
  assert.ok(narrowPasswordModal.left >= 0)
  assert.ok(narrowPasswordModal.right <= narrowPasswordModal.viewportWidth)
  assert.ok(narrowPasswordModal.width <= narrowPasswordModal.viewportWidth - 20)
  await fillPasswordModal(page, { newPassword: managedResetPassword })
  await clickVisibleModalButton(page, '设置密码')
  await waitForNoVisibleModal(page, '设置或重置密码')

  let userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  let managedUser = userResponse.body?.items?.find(
    user => user.username === managedUsername,
  )
  assert.equal(userResponse.status, 200)
  assert.equal(managedUser?.mustChangePassword, true)

  await page.setViewport(1280, 800, false)
  await page.waitFor(`(() => [...document.querySelectorAll('tr')].some(row => (
    row.textContent?.includes(${JSON.stringify(managedUsername)})
    && row.getClientRects().length > 0
  )))()`)

  await clickVisibleTableRowButton(page, managedUsername, '编辑')
  let managedUserPatchRequests = 0
  const managedUserPatchUrl = `${configuration.baseUrl}/api/users/${createdUser.body.id}`
  const removeManagedUserPatchListener = page.on(
    'Network.requestWillBeSent',
    ({ request }) => {
      if (request?.method === 'PATCH' && request.url === managedUserPatchUrl) {
        managedUserPatchRequests += 1
      }
    },
  )
  await fillVisibleModalControl(
    page,
    'input[placeholder="请输入显示名称"]',
    editedDisplayName,
  )
  await fillVisibleModalControl(
    page,
    'input[placeholder="可选；清空后保存将移除邮箱"]',
    editedEmail,
  )
  await fillVisibleModalControl(
    page,
    'input[placeholder="例如 +8613800138000"]',
    editedMobile,
  )
  await fillVisibleModalControl(
    page,
    'input[placeholder="可选；请输入 HTTP 或 HTTPS 绝对地址"]',
    editedAvatarUrl,
  )
  await fillVisibleModalControl(
    page,
    'textarea[placeholder="可选；仅系统管理员可见"]',
    editedRemark,
  )
  await clickVisibleModalButton(page, '保存修改')
  await waitForNoVisibleModal(page, '编辑用户')
  removeManagedUserPatchListener()
  assert.equal(managedUserPatchRequests, 1)
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(editedDisplayName)})`)

  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.ok(managedUser)
  assert.deepEqual(managedUser?.profile, {
    avatarUrl: editedAvatarUrl,
    createdAt: managedUser.profile.createdAt,
    email: editedEmail,
    mobileE164: editedMobile,
    remark: editedRemark,
    updatedAt: managedUser.profile.updatedAt,
  })
  assert.equal('emailNormalized' in managedUser.profile, false)

  const updateAudits = await page.evaluate(apiExpression(
    '/api/audit-events?page=1&pageSize=100',
    'GET',
  ))
  const managedUserUpdateAudit = updateAudits.body?.items?.find(event => (
    event.eventType === 'USER_UPDATED'
    && event.targetId === createdUser.body.id
  ))
  assert.deepEqual(managedUserUpdateAudit?.metadata, {
    changedFields: 'avatarUrl,displayName,email,mobileE164,remark',
  })
  const serializedUpdateAudit = JSON.stringify(managedUserUpdateAudit?.metadata)
  for (const sensitiveValue of [
    editedEmail,
    editedMobile,
    editedAvatarUrl,
    editedRemark,
  ]) {
    assert.equal(serializedUpdateAudit.includes(sensitiveValue), false)
  }

  await clickVisibleTableRowButton(page, managedUsername, '分配角色')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes('分配角色')
  )))()`)
  await selectVisibleModalOption(page, editedRoleName)
  await clickVisibleModalButton(page, '替换角色集合')
  await waitForNoVisibleModal(page, '分配角色')

  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.ok(managedUser)
  assert.equal(managedUser?.displayName, editedDisplayName)
  assert.deepEqual(managedUser?.profile, {
    avatarUrl: editedAvatarUrl,
    createdAt: managedUser.profile.createdAt,
    email: editedEmail,
    mobileE164: editedMobile,
    remark: editedRemark,
    updatedAt: managedUser.profile.updatedAt,
  })
  assert.deepEqual(managedUser?.roleIds, [managedRole.id])

  await clickVisibleTableRowButton(page, managedUsername, '更多')
  await clickVisibleText(page, '禁用用户')
  await clickVisibleModalButton(page, '确认禁用')
  await waitForNoVisibleModal(page, '确认禁用用户')
  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.equal(managedUser?.status, 'DISABLED')

  await clickVisibleTableRowButton(page, managedUsername, '更多')
  await clickVisibleText(page, '启用用户')
  await clickVisibleModalButton(page, '确认启用')
  await waitForNoVisibleModal(page, '确认启用用户')
  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.equal(managedUser?.status, 'ACTIVE')

  // 角色、权限目录和审计都必须在窄屏切换为卡片；卡片边界不得跑出视口。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/roles'))
  await waitForTableTools(page, 'role-table', '搜索角色名称、编码或说明')
  await waitForCardsInsideViewport(page, '[data-testid="role-card"]', editedRoleName)
  assert.equal(await page.evaluate(`(() => (
    [...document.querySelectorAll('[data-testid="role-table"] table')]
      .some(element => element.getClientRects().length > 0)
  ))()`), false)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/permissions'))
  await waitForTableTools(page, 'permission-table', '搜索权限码、名称、说明或资源')
  await waitForCardsInsideViewport(page, '[data-testid="permission-card"]')
  // 权限目录分页后 users:read 不保证位于第一页；通过公开搜索交互定位目标卡片后再验证窄屏布局。
  await fillVisibleInput(page, 'input[placeholder="搜索权限码、名称、说明或资源"]', 'users:read')
  await clickVisibleButton(page, '查询')
  await waitForCardsInsideViewport(page, '[data-testid="permission-card"]', 'users:read')
  const narrowPermissionCatalog = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="permission-card"]')]
      .filter(card => card.getClientRects().length > 0)
    const cardRects = cards.map((card) => {
      const rect = card.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        text: card.textContent?.trim().slice(0, 120),
        width: rect.width,
      }
    })
    return {
      cardCount: cards.length,
      cardsInsideViewport: cardRects.every(rect => rect.left >= 0 && rect.right <= innerWidth),
      documentWidth: document.documentElement.scrollWidth,
      overflowCards: cardRects.filter(rect => rect.left < 0 || rect.right > innerWidth),
      tableRootCount: document.querySelectorAll('[data-testid="permission-table"]').length,
      viewportWidth: innerWidth,
      visibleTables: [...document.querySelectorAll('[data-testid="permission-table"] table')]
        .filter(element => element.getClientRects().length > 0).length,
    }
  })()`)
  assert.ok(narrowPermissionCatalog.cardCount > 0)
  assert.equal(
    narrowPermissionCatalog.cardsInsideViewport,
    true,
    JSON.stringify(narrowPermissionCatalog),
  )
  assert.equal(narrowPermissionCatalog.tableRootCount, 1)
  assert.equal(narrowPermissionCatalog.visibleTables, 0)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/audit'))
  await waitForTableTools(page, 'audit-table', '输入完整请求 ID 搜索')
  await waitForCardsInsideViewport(page, '[data-testid="audit-card"]')
  const narrowAudit = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('[data-testid="audit-card"]')]
      .filter(card => card.getClientRects().length > 0)
    const text = document.body.innerText
    return {
      cardCount: cards.length,
      cardsInsideViewport: cards.every((card) => {
        const rect = card.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth
      }),
      events: {
        roleCreated: text.includes('角色已创建'),
        rolePermissionsChanged: text.includes('角色权限已变更'),
        roleUpdated: text.includes('角色已更新'),
        userDisabled: text.includes('用户已禁用'),
        userEnabled: text.includes('用户已启用'),
        userPasswordReset: text.includes('用户密码已重置'),
        userRolesChanged: text.includes('用户角色已变更'),
        userUpdated: text.includes('用户已更新'),
      },
      visibleTables: [...document.querySelectorAll('[data-testid="audit-table"] table')]
        .filter(element => element.getClientRects().length > 0).length,
    }
  })()`)
  assert.ok(narrowAudit.cardCount > 0)
  assert.equal(narrowAudit.cardsInsideViewport, true)
  assert.equal(narrowAudit.visibleTables, 0)
  assert.deepEqual(narrowAudit.events, {
    roleCreated: true,
    rolePermissionsChanged: true,
    roleUpdated: true,
    userDisabled: true,
    userEnabled: true,
    userPasswordReset: true,
    userRolesChanged: true,
    userUpdated: true,
  })

  // 最后使用管理员 UI 设置的新密码登录，证明密码重置真实生效且改密勾选值
  // 已进入 AuthSession 流程，而不是只刷新了用户列表中的标记。
  await page.evaluate(storeMethodExpression('logout'))
  await waitForAuthState(page, 'anonymous')
  await loginThroughUi(page, {
    password: managedResetPassword,
    username: managedUsername,
  }, 'password_change_required')
  assert.deepEqual(await page.evaluate(storeSnapshotExpression()), {
    state: 'password_change_required',
    username: managedUsername,
  })
  await page.evaluate(storeMethodExpression('logout'))
  await waitForAuthState(page, 'anonymous')
  page.close()
})
