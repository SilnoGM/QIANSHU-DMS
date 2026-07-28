/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import {
  apiExpression,
  appRouteUrl,
  authStoreExpression,
  broadcastRegionInvalidation,
  clickVisibleButton,
  clickVisibleMenuItem,
  clickVisibleModalButton,
  clickVisibleRowButton,
  clickVisibleTreeItem,
  collectRuntimeIssues,
  failNextRequest,
  failResponseAfterServerMutation,
  fillVisibleInput,
  fillVisibleModalInput,
  installBroadcastProbeScript,
  loginThroughRealHttp,
  openSelector,
  patchPermissionsExpression,
  pressKey,
  readConfiguration,
  readProviderCallExpression,
  regionProviderExpression,
  requestPathname,
  requestSearchParams,
  restorePermissionsExpression,
  selectVisibleFilter,
  startProviderCallExpression,
  subscribeToRegionInvalidation,
  waitForNoVisibleDialog,
  waitForRegionTable,
} from './regions.browser.helpers.mjs'

const selectorRoute = '/__e2e/region-selector'
const managementRoute = '/system/basic-data/regions'

async function runBrowserStep(label, action) {
  process.stdout.write(`[regions-browser] ${label}\n`)
  try {
    return await action()
  }
  catch (error) {
    throw new Error(`Browser step failed: ${label}`, { cause: error })
  }
}

/**
 * AuthContext 建立后 Router 会补注册动态路由并 replace 当前地址；此时旧的
 * JavaScript execution context 会短暂失效。只在这个明确边界重试 DOM 探针，
 * 避免把正常的路由切换误判为业务失败。
 */
async function waitForAfterAuthentication(page, expression) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(expression)) {
        return
      }
    }
    catch {
      // Router replace 会销毁旧 context；下一轮必须在新页面上下文重新求值。
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Browser route did not settle after authentication')
}

/**
 * BroadcastChannel 的投递是异步任务。每个缓存失效断言先记录接收计数，再等待
 * 所有目标 tab 确认收到消息，避免测试误把旧缓存命中或迟到响应当作新一代结果。
 */
async function broadcastAndWaitForRegionInvalidation(sender, ...receivers) {
  const before = await Promise.all(receivers.map(receiver =>
    receiver.evaluate('globalThis.__regionInvalidations')))
  await broadcastRegionInvalidation(sender)
  await Promise.all(receivers.map((receiver, index) =>
    receiver.waitFor(`globalThis.__regionInvalidations > ${before[index]}`)))
}

test('真实 Chrome 覆盖 QsRegionSelector HTTP、交互、错误、缓存与表单语义', {
  timeout: 300_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-regions-selector`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const peer = await browser.newPage()
  await Promise.all([
    page.addScriptOnNewDocument(installBroadcastProbeScript()),
    peer.addScriptOnNewDocument(installBroadcastProbeScript()),
  ])
  const issues = collectRuntimeIssues(page)
  const peerIssues = collectRuntimeIssues(peer)
  await page.setViewport(1280, 800, false)
  await runBrowserStep('selector primary login route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runBrowserStep('selector primary real login', () =>
    loginThroughRealHttp(page, configuration))
  await runBrowserStep('selector primary target route', () => page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  )))
  await runBrowserStep('selector primary target ready', () =>
    waitForAfterAuthentication(page, `document.querySelector(
    '#region-selector-e2e-primary',
  ) !== null && document.querySelector(
    '[data-testid="region-selector-live-form"]',
  ) !== null`))
  await subscribeToRegionInvalidation(page)

  await runBrowserStep('selector peer login route', () =>
    peer.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runBrowserStep('selector peer real login', () =>
    loginThroughRealHttp(peer, configuration))
  await runBrowserStep('selector peer target route', () => peer.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  )))
  await runBrowserStep('selector peer target ready', () =>
    waitForAfterAuthentication(peer, `document.querySelector(
    '#region-selector-e2e-primary',
  ) !== null`))
  await subscribeToRegionInvalidation(peer)
  // 认证 bootstrap 由独立 Auth E2E 覆盖；从目标页稳定后开始收集地区交互异常。
  issues.start()
  peerIssues.start()
  // 空值 required 必须由真实 input 参加 Constraint Validation 与 FormData。
  const emptySemantics = await page.evaluate(`(() => {
    const input = document.querySelector('#region-selector-e2e-primary')
    const form = document.querySelector('[data-testid="region-selector-live-form"]')
    return {
      ariaRequired: input?.getAttribute('aria-required'),
      customValidity: input?.validationMessage,
      required: input?.required,
      valid: input?.checkValidity(),
      value: new FormData(form).get('regionCityId'),
    }
  })()`)
  assert.deepEqual(emptySemantics, {
    ariaRequired: 'true',
    customValidity: '请选择地区',
    required: true,
    valid: false,
    value: '',
  })

  // 所有基准 ID 均从隔离数据库的真实 selection API 按稳定 code/path 发现。
  const rootsResponse = await page.evaluate(
    apiExpression('/api/region-selection/options'),
  )
  assert.equal(rootsResponse.status, 200)
  assert.equal(rootsResponse.cacheControl, 'private, no-store')
  const taiwanCountry = rootsResponse.body?.find(region => region.code === 'TW')
  assert.equal(taiwanCountry?.name, '中国台湾')

  const taiwanProvinceResponse = await page.evaluate(apiExpression(
    `/api/region-selection/options?parentId=${encodeURIComponent(taiwanCountry.id)}`,
  ))
  assert.equal(taiwanProvinceResponse.status, 200)
  const taiwanProvince = taiwanProvinceResponse.body?.find(
    region => region.code === 'TW-TAIWAN',
  )
  assert.equal(taiwanProvince?.name, '台湾')

  const searchResponse = await page.evaluate(apiExpression(
    '/api/region-selection/search?query=%E9%AB%98%E9%9B%84%E5%B8%82&limit=50',
  ))
  assert.equal(searchResponse.status, 200)
  const kaohsiungItem = searchResponse.body?.items?.find(item =>
    item.path.map(region => region.name).join(' / ')
    === '中国台湾 / 台湾 / 高雄市')
  assert.equal(typeof kaohsiungItem?.cityId, 'string')
  const kaohsiungId = kaohsiungItem.cityId

  const pathResponse = await page.evaluate(apiExpression(
    `/api/region-selection/paths/${encodeURIComponent(kaohsiungId)}`,
  ))
  assert.equal(pathResponse.status, 200)
  assert.deepEqual(
    pathResponse.body?.path?.map(region => [region.level, region.name]),
    [
      ['COUNTRY_REGION', '中国台湾'],
      ['PROVINCE_STATE', '台湾'],
      ['CITY', '高雄市'],
    ],
  )

  // 冷启动 root 请求先失败，再从组件内联错误重试；失败响应不得进入缓存。
  await runBrowserStep('selector root failure interception', () => failNextRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/region-selection/options*`,
    }],
    event => requestPathname(event) === '/api/region-selection/options'
      && !requestSearchParams(event).has('parentId'),
    async () => {
      // 必须先启用 Fetch 拦截，再让被测页接收缓存失效；当前 standard 场景尚未
      // 打开 popup，直接复用已稳定挂载的选择器可避开 Router query 导航竞态。
      await runBrowserStep('selector root invalidate cache', () =>
        broadcastAndWaitForRegionInvalidation(peer, page))
      /*
       * 再推进真实 Store 的 auth generation，强制覆盖“Broadcast 已送达但旧请求
       * 同一任务完成回写”的极窄竞争；Provider 会按身份边界清缓存并推进 generation。
       * 随后由正式 Provider 建立 root in-flight，组件作为第二个 consumer 加入。
       */
      await runBrowserStep('selector root identity generation', async () => {
        const authEpochChange = await page.evaluate(authStoreExpression(`
          const previous = store.authEpoch
          const next = store.authEpoch + 1
          store.$patch({ authEpoch: next })
          return { current: store.authEpoch, previous }
        `))
        assert.equal(
          authEpochChange.current,
          authEpochChange.previous + 1,
        )
      })
      await runBrowserStep('selector root provider call', () =>
        page.evaluate(startProviderCallExpression(
          'selector-root-failure',
          'children',
          null,
        )))
      await runBrowserStep('selector root open control', () =>
        openSelector(page))
    },
  ))
  await page.waitFor(`document.querySelector(
    '[data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('地区列表加载失败')`)
  await clickVisibleButton(page, '重试加载')
  await clickVisibleMenuItem(page, '中国台湾')

  // 第一级 lazy 成功后，让第二级 lazy 失败；重试必须继续保留父路径。
  await page.waitFor(`(() => [...document.querySelectorAll(
    '.qs-region-selector-popup [role="menuitem"]',
  )].some(item => item.textContent?.trim() === '台湾'))()`)
  await runBrowserStep('selector lazy failure interception', () => failNextRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/region-selection/options*`,
    }],
    event => requestSearchParams(event).get('parentId') === taiwanProvince.id,
    () => clickVisibleMenuItem(page, '台湾'),
  ))
  await page.waitFor(`document.querySelector(
    '[data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('台湾的下级地区加载失败')`)
  await clickVisibleButton(page, '重试加载')
  await clickVisibleMenuItem(page, '高雄市')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-controlled-value"]',
  )?.textContent?.trim() === ${JSON.stringify(kaohsiungId)}`)
  await page.waitFor(`(() => {
    const input = document.querySelector('#region-selector-e2e-primary')
    return input?.getAttribute('aria-busy') !== 'true'
      && !input?.getAttribute('aria-describedby')?.includes('-loading')
  })()`)

  const selectedSemantics = await page.evaluate(`(() => {
    const input = document.querySelector('#region-selector-e2e-primary')
    const form = document.querySelector('[data-testid="region-selector-live-form"]')
    const label = document.querySelector('label[for="region-selector-e2e-primary"]')
    label?.click()
    return {
      activeInput: document.activeElement === input,
      autocomplete: input?.getAttribute('autocomplete'),
      describedBy: input?.getAttribute('aria-describedby'),
      ariaRequired: input?.getAttribute('aria-required'),
      expanded: input?.getAttribute('aria-expanded'),
      hasPopup: input?.getAttribute('aria-haspopup'),
      id: input?.id,
      name: input?.getAttribute('name'),
      required: input?.required,
      valid: input?.checkValidity(),
      value: new FormData(form).get('regionCityId'),
    }
  })()`)
  assert.deepEqual(selectedSemantics, {
    activeInput: true,
    autocomplete: 'address-level2',
    describedBy: 'region-selector-e2e-help',
    ariaRequired: 'true',
    expanded: 'false',
    hasPopup: 'menu',
    id: 'region-selector-e2e-primary',
    name: 'regionCityId',
    required: false,
    valid: true,
    value: kaohsiungId,
  })
  await clickVisibleButton(page, '验证 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-form-data"]',
  )?.textContent?.trim() === ${JSON.stringify(kaohsiungId)}`)

  // Tab 到公开 clear control 后用键盘清空，同时证明真实 focus-visible 状态。
  await page.evaluate(`(() => {
    const input = document.querySelector('#region-selector-e2e-primary')
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('region selector input unavailable')
    }
    input.focus({ preventScroll: true })
    return true
  })()`)
  try {
    await page.waitFor(`(() => {
      const clear = document.querySelector(
        '[data-slot="qs-region-selector"] .arco-select-view-clear-btn',
      )
      return clear?.getAttribute('tabindex') === '0'
        && getComputedStyle(clear).visibility === 'visible'
    })()`)
  }
  catch (error) {
    const diagnostic = await page.evaluate(`(() => {
      const root = document.querySelector('[data-slot="qs-region-selector"]')
      const clearControls = [...(root?.querySelectorAll(
        '.arco-select-view-clear-btn',
      ) ?? [])]
      return {
        clearControls: clearControls.map(clear => ({
          ariaLabel: clear.getAttribute('aria-label'),
          className: clear.getAttribute('class'),
          role: clear.getAttribute('role'),
          tabIndexAttribute: clear.getAttribute('tabindex'),
          tabIndexProperty: clear.tabIndex,
          visibility: getComputedStyle(clear).visibility,
        })),
        focusedId: document.activeElement?.id ?? null,
        rootConnected: root?.isConnected ?? false,
      }
    })()`)
    throw new Error(
      `Region selector clear bridge unavailable: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    )
  }
  await pressKey(page, 'Tab')
  const clearFocus = await page.evaluate(`(() => {
    const clear = document.activeElement
    return {
      focusVisible: clear?.matches(':focus-visible') ?? false,
      label: clear?.getAttribute('aria-label'),
      role: clear?.getAttribute('role'),
    }
  })()`)
  assert.deepEqual(clearFocus, {
    focusVisible: true,
    label: '清空地区选择',
    role: 'button',
  })
  await pressKey(page, 'Enter')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-controlled-value"]',
  )?.textContent?.trim() === 'null'`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-change"]',
    )?.textContent?.includes('clear · value=null')`),
    true,
  )
  const clearedSemantics = await page.evaluate(`(() => {
    const input = document.querySelector('#region-selector-e2e-primary')
    const form = document.querySelector('[data-testid="region-selector-live-form"]')
    return {
      ariaRequired: input?.getAttribute('aria-required'),
      customValidity: input?.validationMessage,
      required: input?.required,
      valid: input?.checkValidity(),
      value: new FormData(form).get('regionCityId'),
    }
  })()`)
  assert.deepEqual(clearedSemantics, emptySemantics)

  // 搜索失败、retry 和最终选择都由真实 API 驱动。
  await openSelector(page)
  await runBrowserStep('selector search failure interception', () => failNextRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/region-selection/search*`,
    }],
    event => requestPathname(event) === '/api/region-selection/search'
      && requestSearchParams(event).get('query') === '高雄市',
    () => fillVisibleInput(page, '#region-selector-e2e-primary', '高雄市'),
  ))
  await page.waitFor(`document.querySelector(
    '[data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('地区搜索失败')`)
  await clickVisibleButton(page, '重试搜索')
  await clickVisibleMenuItem(page, '高雄市')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-controlled-value"]',
  )?.textContent?.trim() === ${JSON.stringify(kaohsiungId)}`)

  // path 失败保留原 UUID，重试后恢复完整三级历史回显。
  await runBrowserStep('selector path failure interception', () => failNextRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/region-selection/paths/*`,
    }],
    event => requestPathname(event)
      === `/api/region-selection/paths/${kaohsiungId}`,
    async () => {
      /*
       * 组件当前保留已选 CITY。先推进真实 Auth generation，再用跨 tab 通知触发
       * 组件 resolveCurrentPath；Provider 因身份代际变化清空 path cache 并发 HTTP。
       */
      await page.evaluate(authStoreExpression(`
        const next = store.authEpoch + 1
        store.$patch({ authEpoch: next })
        return store.authEpoch
      `))
      await broadcastAndWaitForRegionInvalidation(peer, page)
    },
  ))
  await page.waitFor(`document.querySelector(
    '[data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('已选地区回显失败，原值已保留')`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-controlled-value"]',
    )?.textContent?.trim()`),
    kaohsiungId,
  )
  await clickVisibleButton(page, '重试回显')
  await page.waitFor(`document.querySelector(
    '[data-slot="qs-region-selector"]',
  )?.textContent?.includes('中国台湾 / 台湾 / 高雄市')`)

  // 加载过的三级树支持真实键盘导航；Escape 只关闭 popup，不改变选值。
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  ))
  await openSelector(page)
  await clickVisibleMenuItem(page, '中国台湾')
  await clickVisibleMenuItem(page, '台湾')
  await page.waitFor(`(() => [...document.querySelectorAll(
    '.qs-region-selector-popup [role="menuitem"]',
  )].some(item => item.textContent?.includes('高雄市')))()`)
  await pressKey(page, 'Escape')
  await page.waitFor(`document.querySelector(
    '#region-selector-e2e-primary',
  )?.getAttribute('aria-expanded') === 'false'`)
  await pressKey(page, 'Enter')
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'ArrowRight')
  await pressKey(page, 'ArrowRight')
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => /^[0-9a-f-]{36}$/u.test(
    document.querySelector(
      '[data-testid="region-selector-controlled-value"]',
    )?.textContent?.trim() ?? '',
  ))()`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-change"]',
    )?.textContent?.split(' / ').length === 3`),
    true,
  )
  // 选择会同步 v-model，再异步校验历史 path；后续失效场景不得叠加旧请求。
  await page.waitFor(`document.querySelector(
    '#region-selector-e2e-primary',
  )?.getAttribute('aria-busy') !== 'true'`)

  // readonly/disabled 仍解析已存路径；readonly 可聚焦但不能展开，disabled 不可聚焦。
  const statesPage = await browser.newPage()
  const statesIssues = collectRuntimeIssues(statesPage)
  await statesPage.setViewport(1280, 800, false)
  /*
   * test mode 的首屏 `/me` 仍受既有 authApi 循环初始化问题影响。新 page 必须与
   * primary/peer 使用同一条真实 HTTP 登录桥：Server 负责 Cookie 与 AuthContext，
   * Store 只接收 Server 返回值，不能假设共享 Profile 会完成应用认证 bootstrap。
   */
  await statesPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await loginThroughRealHttp(statesPage, configuration)
  // 登录桥已完成后再监听；地区目标页的挂载异常仍会被完整采集。
  statesIssues.start()
  await statesPage.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=states&value=${encodeURIComponent(kaohsiungId)}`,
  ))
  try {
    await waitForAfterAuthentication(statesPage, `(() => (
      document.querySelector('#region-selector-e2e-readonly')
        ?.closest('[data-slot="qs-region-selector"]')
        ?.textContent?.includes('中国台湾 / 台湾 / 高雄市')
      && document.querySelector('#region-selector-e2e-disabled')
        ?.closest('[data-slot="qs-region-selector"]')
        ?.textContent?.includes('中国台湾 / 台湾 / 高雄市')
    ))()`)
  }
  catch (error) {
    const diagnostic = await statesPage.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      const stores = app?.config?.globalProperties?.$pinia?._s
      const account = stores?.get('appAccount')
      const routeStore = stores?.get('appRoute')
      const readText = (id) => document.querySelector(id)
        ?.closest('[data-slot="qs-region-selector"]')
        ?.textContent?.replaceAll(/\\s+/gu, ' ').trim().slice(0, 240) ?? null
      return {
        authState: account?.authState ?? null,
        body: document.body.innerText.replaceAll(/\\s+/gu, ' ').trim().slice(0, 400),
        disabledText: readText('#region-selector-e2e-disabled'),
        hash: location.hash,
        readonlyText: readText('#region-selector-e2e-readonly'),
        routesGenerated: routeStore?.isGenerate ?? null,
      }
    })()`)
    throw new Error(
      `Region selector states route unavailable: ${JSON.stringify({
        ...diagnostic,
        issues: statesIssues.issues,
      })}`,
      { cause: error },
    )
  }
  const stateSemantics = await statesPage.evaluate(`(() => {
    const readonly = document.querySelector('#region-selector-e2e-readonly')
    const disabled = document.querySelector('#region-selector-e2e-disabled')
    readonly?.focus()
    readonly?.click()
    return {
      disabled: disabled?.disabled,
      disabledStatus: disabled
        ?.closest('[data-slot="qs-region-selector"]')
        ?.textContent?.includes('已禁用'),
      readonlyActive: document.activeElement === readonly,
      readonlyAria: readonly?.getAttribute('aria-readonly'),
      readonlyExpanded: readonly?.getAttribute('aria-expanded'),
      readonlyStatus: readonly
        ?.closest('[data-slot="qs-region-selector"]')
        ?.textContent?.includes('只读'),
    }
  })()`)
  assert.deepEqual(stateSemantics, {
    disabled: true,
    disabledStatus: true,
    readonlyActive: true,
    readonlyAria: 'true',
    readonlyExpanded: 'false',
    readonlyStatus: true,
  })
  statesIssues.stop()
  assert.deepEqual(statesIssues.issues, [])
  statesPage.close()

  // 使用真实管理 API 停用种子城市，再由正式 Provider 与组件验证历史路径回显。
  // finally 恢复启用，保证后续选择、管理页与 runner 终态探针共享稳定种子状态。
  let kaohsiungDisabled = false
  try {
    await subscribeToRegionInvalidation(page)
    const disableKaohsiung = await page.evaluate(apiExpression(
      `/api/regions/${encodeURIComponent(kaohsiungId)}/disable`,
      'POST',
      {},
    ))
    assert.equal(disableKaohsiung.status, 200)
    assert.equal(disableKaohsiung.body?.region?.enabled, false)
    kaohsiungDisabled = true
    await broadcastAndWaitForRegionInvalidation(peer, page)
    // Broadcast 的接收计数早于组件异步 path 恢复完成，先等当前代际稳定再切场景。
    await page.waitFor(`document.querySelector(
      '#region-selector-e2e-primary',
    )?.getAttribute('aria-busy') !== 'true'`)

    const stoppedPath = await page.evaluate(regionProviderExpression(`
      return provider.resolvePath({
        cityId: ${JSON.stringify(kaohsiungId)},
        signal: new AbortController().signal,
      })
    `))
    assert.deepEqual(
      stoppedPath.map(region => ({
        effectiveEnabled: region.effectiveEnabled,
        enabled: region.enabled,
        name: region.name,
      })),
      [
        { effectiveEnabled: true, enabled: true, name: '中国台湾' },
        { effectiveEnabled: true, enabled: true, name: '台湾' },
        { effectiveEnabled: false, enabled: false, name: '高雄市' },
      ],
    )
    const stoppedSearch = await page.evaluate(regionProviderExpression(`
      return provider.search({
        query: '高雄市',
        signal: new AbortController().signal,
      })
    `))
    assert.equal(
      stoppedSearch.paths.some(path =>
        path[2]?.id === kaohsiungId),
      false,
    )
    const stoppedOptions = await page.evaluate(regionProviderExpression(`
      return provider.listChildren({
        parentId: ${JSON.stringify(taiwanProvince.id)},
        signal: new AbortController().signal,
      })
    `))
    assert.equal(
      stoppedOptions.some(region => region.id === kaohsiungId),
      false,
    )

    /*
     * 前序故障场景为强制触发 HTTP 曾手工推进 authEpoch。历史停用 UI 使用独立
     * 真实会话冷启动，避免让该非生产身份状态与组件回显验收互相污染；主 page
     * 已在上方继续证明 Broadcast 后正式 Provider 返回停用新值。
     */
    const stoppedPage = await browser.newPage()
    const stoppedIssues = collectRuntimeIssues(stoppedPage)
    try {
      await stoppedPage.setViewport(1280, 800, false)
      await stoppedPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
      await loginThroughRealHttp(stoppedPage, configuration)
      stoppedIssues.start()
      await stoppedPage.navigate(appRouteUrl(
        configuration.baseUrl,
        `${selectorRoute}?case=path&value=${encodeURIComponent(kaohsiungId)}`,
      ))
      await waitForAfterAuthentication(stoppedPage, `(() => {
        const selector = document.querySelector('[data-slot="qs-region-selector"]')
        const state = document.querySelector(
          '[data-slot="qs-region-selector-state"]',
        )
        return selector?.textContent?.includes('中国台湾 / 台湾 / 高雄市')
          && state?.textContent?.includes('当前历史地区已停用，仅供回显')
      })()`)
      assert.equal(
        await stoppedPage.evaluate(`document.querySelector(
          '[data-testid="region-selector-controlled-value"]',
        )?.textContent?.trim()`),
        kaohsiungId,
      )
      assert.deepEqual(stoppedIssues.issues, [])
    }
    finally {
      stoppedIssues.stop()
      stoppedPage.close()
    }
  }
  finally {
    if (kaohsiungDisabled) {
      const enableKaohsiung = await page.evaluate(apiExpression(
        `/api/regions/${encodeURIComponent(kaohsiungId)}/enable`,
        'POST',
        {},
      ))
      assert.equal(enableKaohsiung.status, 200)
      assert.equal(enableKaohsiung.body?.region?.enabled, true)
      await subscribeToRegionInvalidation(page)
      await broadcastAndWaitForRegionInvalidation(peer, page)
      const enabledPath = await page.evaluate(regionProviderExpression(`
        return provider.resolvePath({
          cityId: ${JSON.stringify(kaohsiungId)},
          signal: new AbortController().signal,
        })
      `))
      assert.equal(enabledPath[2]?.enabled, true)
      assert.equal(enabledPath[2]?.effectiveEnabled, true)
    }
  }

  // 两个真实组件同时冷开 root，只产生一条 HTTP。
  const dedupePage = await browser.newPage()
  const dedupeIssues = collectRuntimeIssues(dedupePage)
  const rootRequests = []
  const removeNetworkListener = dedupePage.on(
    'Network.requestWillBeSent',
    (event) => {
      const url = new URL(event.request.url)
      if (
        url.pathname === '/api/region-selection/options'
        && !url.searchParams.has('parentId')
      ) {
        rootRequests.push(event.requestId)
      }
    },
  )
  try {
    await dedupePage.setViewport(1280, 800, false)
    await dedupePage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(dedupePage, configuration)
    dedupeIssues.start()
    await dedupePage.navigate(appRouteUrl(
      configuration.baseUrl,
      `${selectorRoute}?case=dedupe`,
    ))
    await waitForAfterAuthentication(dedupePage, `[
      'region-selector-e2e-primary',
      'region-selector-e2e-secondary',
    ].every(id => document.getElementById(id) !== null)`)
    await dedupePage.evaluate(`(() => {
      for (const id of [
        'region-selector-e2e-primary',
        'region-selector-e2e-secondary',
      ]) {
        const input = document.getElementById(id)
        input?.focus({ preventScroll: true })
        input?.click()
      }
      return true
    })()`)
    await dedupePage.waitFor(`document.querySelectorAll(
      '.qs-region-selector-popup [role="menuitem"]',
    ).length > 0`)
    assert.equal(new Set(rootRequests).size, 1)
    assert.deepEqual(dedupeIssues.issues, [])
  }
  finally {
    dedupeIssues.stop()
    removeNetworkListener()
    dedupePage.close()
  }

  // 迟到请求在跨 tab 失效后必须被废弃，下一次读取重新发 HTTP。
  // 先切到不挂载选择器的 Provider-only 场景，避免组件收到失效事件后自动发起
  // root reload，与本测试显式创建的 stale 请求竞争同一个 cache key。
  const providerPage = await browser.newPage()
  const providerIssues = collectRuntimeIssues(providerPage)
  await providerPage.setViewport(1280, 800, false)
  await providerPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await loginThroughRealHttp(providerPage, configuration)
  providerIssues.start()
  await runBrowserStep('selector provider-only route', () => providerPage.navigate(
    appRouteUrl(
      configuration.baseUrl,
      `${selectorRoute}?case=provider-only`,
    ),
  ))
  await runBrowserStep('selector provider-only ready', () => providerPage.waitFor(
    `document.querySelector(
      '[data-testid="region-selector-browser-harness"]',
    )?.getAttribute('data-e2e-case') === 'provider-only'
      && document.querySelector('#region-selector-e2e-primary') === null`,
  ))
  await subscribeToRegionInvalidation(providerPage)
  await broadcastAndWaitForRegionInvalidation(peer, providerPage)
  const staleKey = 'stale-search'
  const staleQuery = 'stale-e2e-no-match'
  await providerPage.enableRequestInterception([{
    requestStage: 'Response',
    urlPattern: `${configuration.baseUrl}/api/region-selection/search*`,
  }])
  const staleEvent = await runBrowserStep(
    'selector stale response interception',
    async () => {
      const paused = providerPage.waitForEvent(
        'Fetch.requestPaused',
        event => requestPathname(event) === '/api/region-selection/search'
          && requestSearchParams(event).get('query') === staleQuery
          && Number(event.responseStatusCode) === 200,
        20_000,
      )
      await providerPage.evaluate(startProviderCallExpression(
        staleKey,
        'search',
        staleQuery,
      ))
      return paused
    },
  )
  await broadcastAndWaitForRegionInvalidation(peer, providerPage)
  await providerPage.continueInterceptedRequest(staleEvent.requestId)
    .catch(() => undefined)
  await providerPage.disableRequestInterception()
  const staleResult = await providerPage.evaluate(
    readProviderCallExpression(staleKey),
  )
  assert.deepEqual(
    { name: staleResult.name, ok: staleResult.ok },
    { name: 'AbortError', ok: false },
  )
  const freshSearchRequests = []
  const removeFreshSearchListener = providerPage.on(
    'Network.requestWillBeSent',
    (event) => {
      if (
        requestPathname(event) === '/api/region-selection/search'
        && requestSearchParams(event).get('query') === staleQuery
      ) {
        freshSearchRequests.push(event.requestId)
      }
    },
  )
  const freshSearch = await providerPage.evaluate(regionProviderExpression(`
    return provider.search({
      query: ${JSON.stringify(staleQuery)},
      signal: new AbortController().signal,
    })
  `))
  removeFreshSearchListener()
  assert.deepEqual(freshSearch, {
    hasMore: false,
    paths: [],
  })
  assert.equal(new Set(freshSearchRequests).size, 1)

  // 窄屏 popup 只在内部滚动，文档本身不产生横向溢出；reduced motion 生效。
  await providerPage.setViewport(390, 844, true)
  await providerPage.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  ))
  await openSelector(providerPage)
  await fillVisibleInput(
    providerPage,
    '#region-selector-e2e-primary',
    '市',
  )
  await providerPage.waitFor(`(() => {
    const panel = document.querySelector(
      '.qs-region-selector-popup .arco-cascader-search-panel',
    )
    return panel?.getClientRects().length > 0
      && panel.querySelectorAll('[role="menuitem"]').length > 5
      && panel.scrollHeight > panel.clientHeight
  })()`)
  const mobilePopup = await providerPage.evaluate(`(() => {
    const popup = document.querySelector('.qs-region-selector-popup')
    const panel = popup?.querySelector('.arco-cascader-panel')
    const scrollPanel = popup?.querySelector('.arco-cascader-search-panel')
    if (scrollPanel) {
      scrollPanel.scrollTop = scrollPanel.scrollHeight
    }
    const viewportWidth = document.documentElement.clientWidth
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      panelMaxHeight: panel ? getComputedStyle(panel).maxHeight : '',
      popupInsideViewport: popup
        ? popup.getBoundingClientRect().left >= 0
          && popup.getBoundingClientRect().right <= viewportWidth
        : false,
      scrollablePanel: scrollPanel
        ? ['auto', 'scroll'].includes(getComputedStyle(scrollPanel).overflowY)
        : false,
      scrollHeight: scrollPanel?.scrollHeight ?? 0,
      scrollTop: scrollPanel?.scrollTop ?? 0,
      visibleHeight: scrollPanel?.clientHeight ?? 0,
    }
  })()`)
  assert.equal(mobilePopup.documentFits, true)
  assert.notEqual(mobilePopup.panelMaxHeight, 'none')
  assert.equal(mobilePopup.popupInsideViewport, true)
  assert.equal(mobilePopup.scrollablePanel, true)
  assert.ok(mobilePopup.scrollHeight > mobilePopup.visibleHeight)
  assert.ok(mobilePopup.scrollTop > 0)
  await providerPage.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const selectorMotion = await providerPage.evaluate(`(() => {
    const target = document.querySelector(
      '.qs-region-selector-popup [role="menuitem"]',
    )
    const seconds = (value) => value.split(',').map((part) => {
      const text = part.trim()
      return text.endsWith('ms')
        ? Number.parseFloat(text) / 1000
        : Number.parseFloat(text)
    })
    const style = target ? getComputedStyle(target) : null
    return {
      animationSeconds: style ? seconds(style.animationDuration) : [],
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      targetVisible: (target?.getClientRects().length ?? 0) > 0,
      transitionSeconds: style ? seconds(style.transitionDuration) : [],
    }
  })()`)
  assert.equal(selectorMotion.matches, true)
  assert.equal(selectorMotion.targetVisible, true)
  assert.equal(
    [
      ...selectorMotion.animationSeconds,
      ...selectorMotion.transitionSeconds,
    ].every(value => Number.isFinite(value) && value <= 0.001),
    true,
  )

  // Showcase 的停用历史路径只作为固定视觉契约，不冒充正式 HTTP。
  await providerPage.navigate(appRouteUrl(
    configuration.baseUrl,
    '/component-library/business/region-selector',
  ))
  await providerPage.waitFor(`document.body.innerText.includes(
    '当前历史地区已停用，仅供回显',
  )`)

  providerIssues.stop()
  issues.stop()
  peerIssues.stop()
  assert.deepEqual(providerIssues.issues, [])
  assert.deepEqual(issues.issues, [])
  assert.deepEqual(peerIssues.issues, [])
  providerPage.close()
  page.close()
  peer.close()
})

test('真实 Chrome 覆盖地区管理查询、权限、写入、双标签失效与响应式页面', {
  timeout: 420_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const regionCode = 'E2E-BROWSER-REGION'
  const initialName = '浏览器地区待编辑'
  const editedName = '浏览器地区已编辑'
  const limitedUsername = 'browser_region_limited'
  const limitedPassword = `${
    Array.from(configuration.password.normalize('NFC')).slice(0, 8).join('')
  }-R6`
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-regions-management`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const peer = await browser.newPage()
  await Promise.all([
    page.addScriptOnNewDocument(installBroadcastProbeScript()),
    peer.addScriptOnNewDocument(installBroadcastProbeScript()),
  ])
  const issues = collectRuntimeIssues(page)
  const peerIssues = collectRuntimeIssues(peer)
  await page.setViewport(1280, 800, false)
  await runBrowserStep('management primary login route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runBrowserStep('management primary real login', () =>
    loginThroughRealHttp(page, configuration))
  await runBrowserStep('management primary target route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, managementRoute)))
  await runBrowserStep('management primary target ready', () =>
    waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-table"]',
  ) !== null`))
  await waitForRegionTable(page)
  issues.start()

  // 真实无地区权限用户用于 Server 403；普通身份仍能使用 selection API。
  const limitedUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser Region Limited',
    mustChangePassword: false,
    password: limitedPassword,
    username: limitedUsername,
  }))
  assert.equal(limitedUser.status, 201)
  assert.equal(limitedUser.body?.username, limitedUsername)
  const permissionCatalog = await page.evaluate(
    apiExpression('/api/permissions'),
  )
  assert.equal(permissionCatalog.status, 200)
  const regionPermissionIdByCode = Object.fromEntries(
    permissionCatalog.body
      ?.filter(permission => permission.code.startsWith('regions:'))
      .map(permission => [permission.code, permission.id]),
  )
  assert.deepEqual(
    Object.keys(regionPermissionIdByCode).sort(),
    [
      'regions:create',
      'regions:disable',
      'regions:enable',
      'regions:read',
      'regions:update',
    ],
  )
  const matrixRole = await page.evaluate(apiExpression('/api/roles', 'POST', {
    code: 'browser_region_matrix',
    description: 'Browser regions permission matrix',
    name: 'Browser Region Matrix',
  }))
  assert.equal(matrixRole.status, 201)
  const assignedRole = await page.evaluate(apiExpression(
    `/api/users/${encodeURIComponent(limitedUser.body.id)}/roles`,
    'PUT',
    { roleIds: [matrixRole.body.id] },
  ))
  assert.equal(assignedRole.status, 200)
  assert.deepEqual(assignedRole.body?.roleIds, [matrixRole.body.id])

  await peer.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await loginThroughRealHttp(peer, configuration)
  await peer.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  ))
  await waitForAfterAuthentication(peer, `document.querySelector(
    '#region-selector-e2e-primary',
  ) !== null`)
  await subscribeToRegionInvalidation(peer)
  peerIssues.start()

  await page.navigate(appRouteUrl(configuration.baseUrl, managementRoute))
  await waitForRegionTable(page)
  await subscribeToRegionInvalidation(page)
  const desktopLayout = await page.evaluate(`(() => {
    const pageRoot = document.querySelector('.region-management-page')
    const mainPanels = [...(pageRoot?.children ?? [])].filter(element =>
      element.querySelector('[data-testid="region-table"]'))
    const viewportWidth = document.documentElement.clientWidth
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      mainPanelCount: mainPanels.length,
      tableVisible: (document.querySelector(
        '[data-testid="region-table"]',
      )?.getClientRects().length ?? 0) > 0,
    }
  })()`)
  assert.deepEqual(desktopLayout, {
    documentFits: true,
    mainPanelCount: 1,
    tableVisible: true,
  })

  const requestLog = []
  const removeRequestListener = page.on('Network.requestWillBeSent', (event) => {
    const url = new URL(event.request.url)
    if (url.pathname.startsWith('/api/regions')) {
      requestLog.push({
        method: event.request.method,
        pathname: url.pathname,
        search: url.search,
      })
    }
  })

  const navigationResponse = await page.evaluate(
    apiExpression('/api/regions/navigation'),
  )
  assert.equal(navigationResponse.status, 200)
  assert.equal(navigationResponse.cacheControl, 'private, no-store')
  const chinaRegion = navigationResponse.body?.find(region => region.code === 'CN')
  assert.equal(typeof chinaRegion?.id, 'string')

  const initialPageResponse = await page.evaluate(
    apiExpression('/api/regions?page=1&pageSize=20&sortBy=sortOrder&sortOrder=asc'),
  )
  assert.equal(initialPageResponse.status, 200)
  assert.ok(initialPageResponse.body?.total >= 3)
  assert.deepEqual(
    initialPageResponse.body?.items?.map(region => region.level)
      .filter((value, index, values) => values.indexOf(value) === index),
    ['COUNTRY_REGION'],
  )

  // 预热两个 tab 的正式 Provider；管理写成功后两边都必须立即失效。
  await Promise.all([
    page.evaluate(regionProviderExpression(`
      return provider.listChildren({
        parentId: null,
        signal: new AbortController().signal,
      })
    `)),
    peer.evaluate(regionProviderExpression(`
      return provider.listChildren({
        parentId: null,
        signal: new AbortController().signal,
      })
    `)),
  ])
  const invalidationsBeforeCreate = await Promise.all([
    page.evaluate('globalThis.__regionInvalidations'),
    peer.evaluate('globalThis.__regionInvalidations'),
  ])

  // 创建固定 root 对象，保留给 runner 的独立数据库终态 probe。
  await clickVisibleButton(page, '新增国家/地区')
  await fillVisibleModalInput(page, '请输入默认显示名称', initialName)
  await fillVisibleModalInput(page, '可选；留空表示不设置', 'Browser Region Pending')
  await fillVisibleModalInput(page, '例如 TW-64000', regionCode)
  await fillVisibleModalInput(page, '请输入 0 到 2147483647', '9900')
  await clickVisibleModalButton(page, '创建地区')
  try {
    await waitForNoVisibleDialog(page, '新增地区')
  }
  catch (error) {
    const diagnostic = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => (
          candidate.getClientRects().length > 0
          && candidate.textContent?.includes('新增地区')
        ))
      const submit = [...(dialog?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.trim() === '创建地区')
      const ancestors = []
      let ancestor = submit
      while (ancestor && ancestor !== dialog) {
        ancestors.push({
          className: typeof ancestor.className === 'string'
            ? ancestor.className.slice(0, 160)
            : '',
          onClick: Array.isArray(ancestor.__vnode?.props?.onClick)
            ? 'array:' + ancestor.__vnode.props.onClick.length
            : typeof ancestor.__vnode?.props?.onClick,
          tagName: ancestor.tagName,
        })
        ancestor = ancestor.parentElement
      }
      return {
        alertText: dialog?.querySelector('[role="alert"]')
          ?.textContent?.replaceAll(/\\s+/gu, ' ').trim().slice(0, 360) ?? null,
        buttons: [...(dialog?.querySelectorAll('button') ?? [])].map(button => ({
          disabled: button.disabled,
          text: button.textContent?.trim() ?? '',
        })),
        fields: [...(dialog?.querySelectorAll('input') ?? [])].map(input => ({
          ariaInvalid: input.getAttribute('aria-invalid'),
          placeholder: input.getAttribute('placeholder'),
          valid: input.checkValidity(),
          value: input.value,
        })),
        text: dialog?.textContent?.replaceAll(/\\s+/gu, ' ').trim().slice(0, 500)
          ?? null,
        ancestors,
        buttonForm: submit?.getAttribute('form') ?? null,
        buttonType: submit?.getAttribute('type') ?? null,
        vnodeOnClick: Array.isArray(submit?.__vnode?.props?.onClick)
          ? 'array:' + submit.__vnode.props.onClick.length
          : typeof submit?.__vnode?.props?.onClick,
      }
    })()`)
    throw new Error(`Create region dialog remained open: ${JSON.stringify({
      ...diagnostic,
      issues: issues.issues,
      requests: requestLog.slice(-8),
    })}`, { cause: error })
  }

  const createdQuery = `/api/regions?code=${encodeURIComponent(
    regionCode,
  )}&page=1&pageSize=20&sortBy=sortOrder&sortOrder=asc`
  let regionResponse = await page.evaluate(apiExpression(createdQuery))
  assert.equal(regionResponse.status, 200)
  assert.equal(regionResponse.body?.total, 1)
  let managedRegion = regionResponse.body?.items?.[0]
  assert.deepEqual(
    {
      code: managedRegion?.code,
      enabled: managedRegion?.enabled,
      level: managedRegion?.level,
      name: managedRegion?.name,
      parentId: managedRegion?.parentId,
    },
    {
      code: regionCode,
      enabled: true,
      level: 'COUNTRY_REGION',
      name: initialName,
      parentId: null,
    },
  )

  await page.waitFor(`globalThis.__regionInvalidations > ${
    invalidationsBeforeCreate[0]
  }`)
  await peer.waitFor(`globalThis.__regionInvalidations > ${
    invalidationsBeforeCreate[1]
  }`)
  const broadcastPayloads = await page.evaluate(
    'globalThis.__regionBroadcastPayloads',
  )
  assert.ok(broadcastPayloads.length >= 1)
  assert.deepEqual(broadcastPayloads.at(-1), { type: 'REGIONS_CHANGED' })
  const serializedBroadcasts = JSON.stringify(broadcastPayloads)
  assert.equal(serializedBroadcasts.includes(regionCode), false)
  assert.equal(serializedBroadcasts.includes(initialName), false)
  assert.equal(serializedBroadcasts.includes('"name"'), false)

  const rootsAfterCreate = await Promise.all([
    page.evaluate(regionProviderExpression(`
      return provider.listChildren({
        parentId: null,
        signal: new AbortController().signal,
      })
    `)),
    peer.evaluate(regionProviderExpression(`
      return provider.listChildren({
        parentId: null,
        signal: new AbortController().signal,
      })
    `)),
  ])
  assert.deepEqual(
    rootsAfterCreate.map(roots =>
      roots.some(region => region.code === regionCode)),
    [true, true],
  )

  // 搜索和 sorting 必须通过真实 list 请求，并把当前范围留在 root。
  const rootSearchPlaceholder
    = '搜索当前直属国家/地区的名称、英文名或 Code'
  await fillVisibleInput(
    page,
    `input[placeholder="${rootSearchPlaceholder}"]`,
    regionCode,
  )
  await clickVisibleButton(page, '查询')
  await page.waitFor(`(() => {
    const rows = [...document.querySelectorAll(
      '[data-testid="region-table"] tbody tr',
    )].filter(row => row.getClientRects().length > 0)
    return rows.length === 1 && rows[0].textContent?.includes(${JSON.stringify(regionCode)})
  })()`)
  await page.evaluate(`(() => {
    const header = [...document.querySelectorAll(
      '[data-testid="region-table"] th[data-sortable]',
    )].find(candidate => candidate.textContent?.includes('名称'))
    if (!header) throw new Error('sortable name header unavailable')
    header.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll(
    '[data-testid="region-table"] th[data-sortable]',
  )].some(header => (
    header.textContent?.includes('名称')
    && ['ascending', 'descending'].includes(header.getAttribute('aria-sort'))
  )))()`)
  assert.equal(
    requestLog.some(request =>
      request.pathname === '/api/regions'
      && request.search.includes('query=E2E-BROWSER-REGION')),
    true,
  )
  assert.equal(
    requestLog.some(request =>
      request.pathname === '/api/regions'
      && request.search.includes('sortBy=name')),
    true,
  )

  // 编辑在 Server 已成功返回后注入 transport failure；页面必须通过 GET 对账收敛。
  await clickVisibleRowButton(page, regionCode, '编辑')
  await fillVisibleModalInput(page, '请输入默认显示名称', editedName)
  await failResponseAfterServerMutation(
    page,
    `${configuration.baseUrl}/api/regions/${managedRegion.id}`,
    'PATCH',
    () => clickVisibleModalButton(page, '保存修改'),
  )
  await waitForNoVisibleDialog(page, '编辑地区')
  regionResponse = await page.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
  ))
  assert.equal(regionResponse.status, 200)
  assert.equal(regionResponse.body?.name, editedName)
  managedRegion = regionResponse.body
  await page.waitFor(`document.body.innerText.includes(
    '已通过最终状态核对确认',
  )`)

  // 停用后先验证 ownStatus 筛选与 read+enable 可见权限，再恢复全权限启用。
  await clickVisibleRowButton(page, regionCode, '停用')
  await page.waitFor(`document.body.innerText.includes(
    '该地区及全部后代将退出业务地区选择器',
  )`)
  await clickVisibleModalButton(page, '确认停用')
  await waitForNoVisibleDialog(page, '确认停用地区')
  regionResponse = await page.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
  ))
  assert.equal(regionResponse.body?.enabled, false)

  await clickVisibleButton(page, '筛选')
  await selectVisibleFilter(page, '自身状态', '停用')
  await clickVisibleButton(page, '应用筛选')
  await page.waitFor(`document.body.innerText.includes('自身状态：停用')`)
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(regionCode)})`)

  await page.evaluate(patchPermissionsExpression([
    'regions:read',
    'regions:enable',
  ]))
  await page.waitFor(`(() => {
    const row = [...document.querySelectorAll('tr')]
      .find(candidate => candidate.textContent?.includes(${JSON.stringify(regionCode)}))
    const labels = [...(row?.querySelectorAll('button') ?? [])]
      .filter(button => button.getClientRects().length > 0)
      .map(button => button.textContent?.trim())
    return labels.includes('启用')
      && !labels.includes('编辑')
      && !labels.includes('停用')
      && !document.body.innerText.includes('新增国家/地区')
  })()`)
  await page.evaluate(restorePermissionsExpression())
  await page.waitFor(`document.body.innerText.includes('新增国家/地区')`)
  await clickVisibleRowButton(page, regionCode, '启用')
  await clickVisibleModalButton(page, '确认启用')
  await waitForNoVisibleDialog(page, '确认启用地区')
  regionResponse = await page.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
  ))
  assert.equal(regionResponse.body?.enabled, true)
  assert.equal(regionResponse.body?.name, editedName)

  // 两个状态筛选分别发送互斥且可解释的查询；随后清空筛选。
  await clickVisibleButton(page, '清空筛选')
  await clickVisibleButton(page, '筛选')
  await selectVisibleFilter(page, '有效状态', '有效')
  await clickVisibleButton(page, '应用筛选')
  await page.waitFor(`document.body.innerText.includes('有效状态：有效')`)
  assert.equal(
    requestLog.some(request =>
      request.search.includes('ownStatus=DISABLED')),
    true,
  )
  assert.equal(
    requestLog.some(request =>
      request.search.includes('availability=EFFECTIVE')),
    true,
  )
  await clickVisibleButton(page, '清空筛选')

  // 客户端操作可见性逐项验证；Server 授权由后面的真实无权限身份 403 独立证明。
  const permissionExpectations = [
    {
      absent: ['新增国家/地区', '启用', '停用'],
      label: 'read',
      permissions: ['regions:read'],
      present: ['仅查看'],
    },
    {
      absent: ['编辑', '启用', '停用'],
      label: 'create',
      permissions: ['regions:read', 'regions:create'],
      present: ['新增国家/地区'],
    },
    {
      absent: ['新增国家/地区', '启用', '停用'],
      label: 'update',
      permissions: ['regions:read', 'regions:update'],
      present: ['编辑'],
    },
    {
      absent: ['新增国家/地区', '编辑', '启用'],
      label: 'disable',
      permissions: ['regions:read', 'regions:disable'],
      present: ['停用'],
    },
  ]
  for (const expectation of permissionExpectations) {
    await runBrowserStep(
      `management permission matrix ${expectation.label}`,
      async () => {
        await page.evaluate(patchPermissionsExpression(expectation.permissions))
        await page.waitFor(`(() => {
          const marker = ${JSON.stringify(regionCode)}
          const row = [...document.querySelectorAll('tr')].find(candidate => (
            candidate.getClientRects().length > 0
            && candidate.textContent?.includes(marker)
          ))
          if (!row) return false
          const rowButtons = [...row.querySelectorAll('button')]
            .filter(button => button.getClientRects().length > 0)
            .map(button => button.textContent?.trim() ?? '')
          const globalButtons = [...document.querySelectorAll('button')]
            .filter(button => button.getClientRects().length > 0)
            .map(button => button.textContent?.trim() ?? '')
          const hasAction = (text) => {
            if (text === '新增国家/地区') return globalButtons.includes(text)
            if (text === '仅查看') {
              return [...row.querySelectorAll('*')].some(candidate => (
                candidate.children.length === 0
                && candidate.getClientRects().length > 0
                && candidate.textContent?.trim() === text
              ))
            }
            return rowButtons.includes(text)
          }
          return ${JSON.stringify(expectation.present)}.every(hasAction)
            && ${JSON.stringify(expectation.absent)}
              .every(text => !hasAction(text))
        })()`)
      },
    )
  }
  await runBrowserStep('management permission matrix none', async () => {
    const permissions = await page.evaluate(patchPermissionsExpression([]))
    assert.deepEqual(permissions, [])
    /*
     * 当前路由本身声明 regions:read；动态撤权后 Router 的统一权限边界优先于
     * 页面内 fallback，正式行为应进入全局 403，且不能继续保留地区表格。
     */
    await page.waitFor(`(() => {
      const body = document.body.innerText
      return body.includes('403')
        && body.includes('无权访问该页面')
        && document.querySelector('[data-testid="region-table"]') === null
    })()`)

    /*
     * 基础数据父级保持权限中立。失去地区权限后直接访问父路径，Router 应跳过
     * 地区叶子并进入第一个仍可访问的货币页面，同时保留另外三个空页面入口。
     */
    await page.navigate(appRouteUrl(configuration.baseUrl, '/system/basic-data'))
    await page.waitFor(`(() => {
      const body = document.body.innerText
      return location.hash === '#/system/basic-data/currencies'
        && ['货币管理', '汇率管理', '编号管理', '字典管理']
          .every(title => body.includes(title))
        && !body.includes('地区管理')
    })()`)
  })
  await page.evaluate(restorePermissionsExpression())
  await page.navigate(appRouteUrl(configuration.baseUrl, managementRoute))
  await waitForRegionTable(page)

  // 导航到中国直属省州，证明 pagination、范围隔离和 next page 使用真实 API。
  await clickVisibleTreeItem(page, '中国')
  await page.waitFor(`document.querySelector(
    '#region-list-title',
  )?.textContent?.trim() === '中国'`)
  await page.waitFor(`document.body.innerText.includes('正在查看直属省/州')`)
  await page.waitFor(`(() => [...document.querySelectorAll(
    '[data-testid="region-table"] *',
  )].some(element => /^共 [2-9]\\d+ 条$/u.test(
    element.textContent?.trim() ?? '',
  )))()`)
  await page.waitFor(`document.querySelector(
    '[data-slot="pagination-next"]',
  )?.disabled === false`)
  const paginationState = await page.evaluate(`(() => {
    const next = document.querySelector('[data-slot="pagination-next"]')
    const totalText = [...document.querySelectorAll(
      '[data-testid="region-table"] *',
    )].find(element => /^共 \\d+ 条$/u.test(element.textContent?.trim() ?? ''))
    return {
      nextDisabled: next?.disabled ?? true,
      totalText: totalText?.textContent?.trim() ?? '',
    }
  })()`)
  assert.equal(paginationState.nextDisabled, false)
  assert.match(paginationState.totalText, /^共 [2-9]\d+ 条$/u)
  await page.evaluate(`(() => {
    const next = document.querySelector('[data-slot="pagination-next"]')
    if (!(next instanceof HTMLButtonElement) || next.disabled) {
      throw new Error('pagination next unavailable')
    }
    next.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll(
    '[data-slot="pagination-item"]',
  )].some(item => item.getAttribute('data-selected') !== null
    && item.textContent?.trim() === '2'))()`)
  assert.equal(
    requestLog.some(request =>
      request.pathname === '/api/regions'
      && request.search.includes('page=2')),
    true,
  )

  // 390x844 只显示移动卡片；scope Drawer 关闭后恢复焦点，Modal 不横向溢出。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, managementRoute))
  await page.waitFor(`(() => (
    [...document.querySelectorAll('[data-testid="region-card"]')]
      .some(card => card.getClientRects().length > 0)
    && ![...document.querySelectorAll('[data-testid="region-table"] table')]
      .some(table => table.getClientRects().length > 0)
  ))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.includes('选择地区范围')
      && candidate.getClientRects().length > 0
    ))
    if (!button) throw new Error('scope drawer trigger unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => (
      dialog.getClientRects().length > 0
      && dialog.textContent?.includes('选择地区范围')
    )))()`)
  await pressKey(page, 'Escape')
  await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('选择地区范围'))`)
  await page.waitFor(`document.activeElement?.textContent?.includes(
    '选择地区范围',
  )`)

  /*
   * Page.navigate 到相同 hash 时 Chrome 可以复用当前 Vue 实例，因此上一阶段的
   * “中国”范围可能仍保留。移动端显式选择虚拟根，避免把路由实现细节误当成页面前置。
   */
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.includes('选择地区范围')
      && candidate.getClientRects().length > 0
    ))
    if (!button) throw new Error('scope drawer trigger unavailable')
    button.click()
    return true
  })()`)
  await clickVisibleTreeItem(page, '全部地区')
  await page.waitFor(`document.querySelector(
    '#region-list-title',
  )?.textContent?.trim() === '全部地区'`)
  await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('选择地区范围'))`)

  // 搜索固定 E2E 对象后，从移动卡片打开编辑 Modal 验证尺寸与 44px Footer。
  await fillVisibleInput(
    page,
    `input[placeholder="${rootSearchPlaceholder}"]`,
    regionCode,
  )
  await clickVisibleButton(page, '查询')
  await page.waitFor(`(() => [...document.querySelectorAll(
    '[data-testid="region-card"]',
  )].some(card => (
    card.getClientRects().length > 0
    && card.textContent?.includes(${JSON.stringify(regionCode)})
  )))()`)
  await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="region-card"]')]
      .find(candidate => candidate.textContent?.includes(${JSON.stringify(regionCode)}))
    const actions = card?.parentElement?.querySelector(
      '[data-slot="qs-generic-table-mobile-actions"]',
    )
    const button = [...(actions?.querySelectorAll('button') ?? [])]
      .find(candidate => candidate.textContent?.trim() === '编辑')
    if (!button) throw new Error('mobile edit unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
  await page.waitFor(`document.body.innerText.includes('编辑地区')`)
  // QsGenericModal 进入动画包含 scale；等待动画后的真实命中区再测量。
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('编辑地区'))
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      .filter(button => ['取消', '保存修改'].includes(button.textContent?.trim()))
    return buttons.length === 2 && buttons.every((button) => {
      const rect = button.getBoundingClientRect()
      return rect.height >= 44 && rect.width >= 300
    })
  })()`)
  const mobileModal = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('编辑地区'))
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      .filter(button => ['取消', '保存修改'].includes(button.textContent?.trim()))
    const rect = dialog?.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const pageRoot = document.querySelector('.region-management-page')
    const mainPanels = [...(pageRoot?.children ?? [])].filter(element =>
      element.querySelector('[data-testid="region-table"]'))
    return {
      buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
      buttonWidths: buttons.map(button => button.getBoundingClientRect().width),
      dialogInsideViewport: rect
        ? rect.left >= 0 && rect.right <= viewportWidth
        : false,
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      mainPanelCount: mainPanels.length,
    }
  })()`)
  assert.equal(mobileModal.dialogInsideViewport, true)
  assert.equal(mobileModal.documentFits, true)
  assert.equal(mobileModal.mainPanelCount, 1)
  assert.deepEqual(
    mobileModal.buttonHeights.map(value => value >= 44),
    [true, true],
  )
  assert.deepEqual(
    mobileModal.buttonWidths.map(value => value >= 300),
    [true, true],
  )
  await clickVisibleModalButton(page, '取消')
  await waitForNoVisibleDialog(page, '编辑地区')
  await page.waitFor(`document.activeElement?.textContent?.trim() === '编辑'`)

  // light/dark 对比真实移动卡片表面，并保留可独立理解的状态值文案。
  const lightTheme = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="region-card"]')]
      .find(candidate => candidate.getClientRects().length > 0)
    const surface = card?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    const text = card?.textContent ?? ''
    return {
      background: style?.backgroundColor ?? '',
      color: style?.color ?? '',
      hasStatusText: text.includes('自身状态')
        && text.includes('启用')
        && text.includes('有效状态')
        && text.includes('有效'),
      surfaceVisible: (surface?.getClientRects().length ?? 0) > 0,
    }
  })()`)
  await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    app?.config?.globalProperties?.$pinia?._s
      ?.get('appSettings')?.setColorScheme('dark')
    return true
  })()`)
  await page.waitFor(`document.documentElement.classList.contains('dark')`)
  const darkTheme = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-testid="region-card"]')]
      .find(candidate => candidate.getClientRects().length > 0)
    const surface = card?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    const text = card?.textContent ?? ''
    return {
      background: style?.backgroundColor ?? '',
      color: style?.color ?? '',
      hasStatusText: text.includes('自身状态')
        && text.includes('启用')
        && text.includes('有效状态')
        && text.includes('有效'),
      surfaceVisible: (surface?.getClientRects().length ?? 0) > 0,
    }
  })()`)
  assert.equal(lightTheme.surfaceVisible, true)
  assert.equal(darkTheme.surfaceVisible, true)
  assert.equal(lightTheme.hasStatusText, true)
  assert.equal(darkTheme.hasStatusText, true)
  assert.notEqual(darkTheme.background, lightTheme.background)
  assert.notEqual(darkTheme.color, lightTheme.color)

  // 暂停一次真实初始列表请求，使 skeleton 必然存在，再检查页面局部
  // prefers-reduced-motion 规则确实关闭无限 pulse，而不是“元素不存在即通过”。
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await page.enableRequestInterception([{
    requestStage: 'Request',
    urlPattern: `${configuration.baseUrl}/api/regions*`,
  }])
  let heldListRequestId
  const isChinaListRequest = event =>
    event.request?.method === 'GET'
    && requestPathname(event) === '/api/regions'
    && requestSearchParams(event).get('parentId') === chinaRegion.id
  const removeReducedMotionListener = page.on(
    'Fetch.requestPaused',
    (event) => {
      if (isChinaListRequest(event) && heldListRequestId === undefined) {
        heldListRequestId = event.requestId
        return
      }
      void page.continueInterceptedRequest(event.requestId)
        .catch(() => undefined)
    },
  )
  const heldListRequest = page.waitForEvent(
    'Fetch.requestPaused',
    isChinaListRequest,
    20_000,
  )
  /*
   * 移动端当前已归位“全部地区”。打开真实范围 Drawer 并切换到中国，确保产生
   * parentId 可识别的 list 请求；selectScope 会先清空 rows 并进入 skeleton。
   */
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.includes('选择地区范围')
      && candidate.getClientRects().length > 0
    ))
    if (!button) throw new Error('scope drawer trigger unavailable')
    button.click()
    return true
  })()`)
  await clickVisibleTreeItem(page, '中国')
  const heldListEvent = await heldListRequest
  heldListRequestId = heldListEvent.requestId
  try {
    await page.waitFor(`document.querySelectorAll(
      '.region-management-page .qs-generic-table .animate-pulse',
    ).length > 0`)
    const reducedMotion = await page.evaluate(`(() => {
      const pulses = [...document.querySelectorAll(
        '.region-management-page .qs-generic-table .animate-pulse',
      )].filter(element => element.getClientRects().length > 0)
      return {
        animationNames: pulses.map(element =>
          getComputedStyle(element).animationName),
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        pulseCount: pulses.length,
      }
    })()`)
    assert.equal(reducedMotion.matches, true)
    assert.ok(reducedMotion.pulseCount > 0)
    assert.equal(
      reducedMotion.animationNames.every(name => name === 'none'),
      true,
    )
  }
  finally {
    await page.continueInterceptedRequest(heldListEvent.requestId)
      .catch(() => undefined)
    removeReducedMotionListener()
    await page.disableRequestInterception()
  }
  await waitForRegionTable(page)

  // 最终 API 与 Audit 同时证明主验收对象状态；请求日志也确认测试未调用 DELETE。
  regionResponse = await page.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
  ))
  assert.deepEqual(
    {
      code: regionResponse.body?.code,
      enabled: regionResponse.body?.enabled,
      level: regionResponse.body?.level,
      name: regionResponse.body?.name,
      parentId: regionResponse.body?.parentId,
    },
    {
      code: regionCode,
      enabled: true,
      level: 'COUNTRY_REGION',
      name: editedName,
      parentId: null,
    },
  )
  const auditResponse = await page.evaluate(
    apiExpression('/api/audit-events?page=1&pageSize=100'),
  )
  assert.equal(auditResponse.status, 200)
  const regionAuditEvents = new Set(
    auditResponse.body?.items
      ?.filter(event =>
        event.targetType === 'Region'
        && event.targetId === managedRegion.id
        && event.outcome === 'SUCCESS')
      .map(event => event.eventType),
  )
  assert.deepEqual(
    [...regionAuditEvents].filter(event => event.startsWith('REGION_')).sort(),
    [
      'REGION_CREATED',
      'REGION_DISABLED',
      'REGION_ENABLED',
      'REGION_UPDATED',
    ],
  )
  assert.equal(requestLog.some(request => request.method === 'DELETE'), false)

  issues.stop()
  peerIssues.stop()
  assert.deepEqual(issues.issues, [])
  assert.deepEqual(peerIssues.issues, [])
  removeRequestListener()

  // 独立 Profile + 普通 Role 逐次真实换权并重新登录。每一组都同时验证
  // Server allowed action、相邻 forbidden action 与页面操作可见性。
  const limitedBrowser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-regions-limited`,
  })
  t.after(async () => limitedBrowser.close())
  const limitedPage = await limitedBrowser.newPage()
  await limitedPage.setViewport(1280, 800, false)
  let limitedIssues = collectRuntimeIssues(limitedPage)
  let limitedIssuesStarted = false

  const matrixCredentials = {
    password: limitedPassword,
    username: limitedUsername,
  }
  const permissionTargetCode = 'E2E-PERMISSION-TARGET'
  const forbiddenCreatePayload = {
    code: 'E2E-PERMISSION-FORBIDDEN',
    enabled: true,
    englishName: 'Forbidden permission matrix region',
    name: '权限矩阵禁止创建',
    parentId: null,
    sortOrder: 9999,
  }
  let matrixAuthenticated = false
  let matrixSessionSequence = 0
  const matrixRouteUrl = routePath =>
    `${configuration.baseUrl}/?regions-matrix-session=${
      matrixSessionSequence
    }#${routePath}`

  const setMatrixPermissions = async (codes) => {
    const permissionIds = codes.map((code) => {
      const id = regionPermissionIdByCode[code]
      assert.equal(typeof id, 'string')
      return id
    })
    const response = await page.evaluate(apiExpression(
      `/api/roles/${encodeURIComponent(matrixRole.body.id)}/permissions`,
      'PUT',
      { permissionIds },
    ))
    assert.equal(response.status, 200)
    assert.deepEqual(
      [...(response.body?.permissionIds ?? [])].sort(),
      [...permissionIds].sort(),
    )
  }

  const openMatrixSession = async (codes) => {
    if (limitedIssuesStarted) {
      limitedIssues.stop()
      assert.deepEqual(
        limitedIssues.issues,
        [],
        '上一组地区权限页面不得产生 Runtime 异常',
      )
      limitedIssuesStarted = false
    }
    else {
      // 首组尚未启用的 collector 也必须解绑，避免留下失活 DevTools listener。
      limitedIssues.stop()
    }
    if (matrixAuthenticated) {
      const logoutResponse = await limitedPage.evaluate(
        apiExpression('/api/auth/logout', 'POST', {}),
      )
      assert.equal(logoutResponse.status, 204)
      matrixAuthenticated = false
    }
    await setMatrixPermissions(codes)
    matrixSessionSequence += 1
    /*
     * 直接 logout 只负责真实 Cookie 失效；每次使用唯一 document URL 冷启动 Store，
     * 避免在 403 路由中等待 logout 触发 Router 导航时销毁 Runtime.evaluate context。
     */
    await limitedPage.navigate(
      `${configuration.baseUrl}/?regions-matrix-session=${
        matrixSessionSequence
      }#/login`,
    )
    await loginThroughRealHttp(limitedPage, matrixCredentials)
    matrixAuthenticated = true
    await limitedPage.navigate(matrixRouteUrl('/'))
    await waitForAfterAuthentication(
      limitedPage,
      authStoreExpression(`
        const routeStore = app?.config?.globalProperties?.$pinia?._s
          ?.get('appRoute')
        return routeStore?.isGenerate === true
      `),
    )
    const actualPermissions = await limitedPage.evaluate(
      authStoreExpression(`return [...store.permissions]
        .filter(permission => permission.startsWith('regions:'))
        .sort()`),
    )
    assert.deepEqual(actualPermissions, [...codes].sort())
    /*
     * test build 的真实 HTTP 登录桥会触发既有 Profile API 循环初始化错误；该边界
     * 已由独立认证测试负责。每组身份稳定后重开监听，只采集地区 API 与管理页面。
     */
    limitedIssues = collectRuntimeIssues(limitedPage)
    limitedIssues.start()
    limitedIssuesStarted = true
  }

  const assertForbidden = (...responses) => {
    assert.deepEqual(
      responses.map(response => response.status),
      responses.map(() => 403),
    )
    assert.deepEqual(
      responses.map(response => response.body?.code),
      responses.map(() => 'FORBIDDEN'),
    )
  }

  const readVisibleRowActions = async (marker) => {
    await limitedPage.waitFor(`(() => [...document.querySelectorAll(
      '[data-testid="region-table"] tbody tr',
    )].some(row => (
      row.getClientRects().length > 0
      && row.textContent?.includes(${JSON.stringify(marker)})
    )))()`)
    return limitedPage.evaluate(`(() => {
      const row = [...document.querySelectorAll(
        '[data-testid="region-table"] tbody tr',
      )].find(candidate => (
        candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(marker)})
      ))
      const actionCell = [...(row?.querySelectorAll(
        '[aria-label$="行操作"]',
      ) ?? [])].find(candidate => candidate.getClientRects().length > 0)
      return {
        buttons: [...(actionCell?.querySelectorAll('button') ?? [])]
          .filter(button => button.getClientRects().length > 0)
          .map(button => button.textContent?.trim()),
        readonly: actionCell?.textContent?.includes('仅查看') ?? false,
      }
    })()`)
  }

  // 0 权限：selection 仍是业务公共读接口；管理路由显示明确 403，全部管理 API 拒绝。
  await openMatrixSession([])
  const noPermissionSelection = await limitedPage.evaluate(
    apiExpression('/api/region-selection/options'),
  )
  const noPermissionRead = await limitedPage.evaluate(
    apiExpression('/api/regions?page=1&pageSize=20'),
  )
  const noPermissionCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    forbiddenCreatePayload,
  ))
  const noPermissionUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
    'PATCH',
    { name: '禁止修改主验收地区' },
  ))
  const noPermissionEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}/enable`,
    'POST',
    {},
  ))
  const noPermissionDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}/disable`,
    'POST',
    {},
  ))
  assert.equal(noPermissionSelection.status, 200)
  assertForbidden(
    noPermissionRead,
    noPermissionCreate,
    noPermissionUpdate,
    noPermissionEnable,
    noPermissionDisable,
  )
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await limitedPage.waitFor(`document.body.innerText.includes('403')`)
  const routeDenial = await limitedPage.evaluate(`(() => ({
    hasManagementPage: document.querySelector('.region-management-page') !== null,
    hasStable403: [...document.querySelectorAll('h1')]
      .some(heading => heading.textContent?.trim() === '403'),
    route: location.hash,
  }))()`)
  assert.equal(routeDenial.hasStable403, true)
  assert.equal(routeDenial.hasManagementPage, false)
  assert.equal(routeDenial.route, `#${managementRoute}`)

  // read：真实 GET 成功，所有写接口仍 403；页面只显示“仅查看”。
  await openMatrixSession(['regions:read'])
  const readOnlyResponse = await limitedPage.evaluate(
    apiExpression('/api/regions?page=1&pageSize=20'),
  )
  assert.equal(readOnlyResponse.status, 200)
  const readOnlyCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    forbiddenCreatePayload,
  ))
  const readOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}`,
    'PATCH',
    { name: '禁止修改主验收地区' },
  ))
  const readOnlyEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}/enable`,
    'POST',
    {},
  ))
  const readOnlyDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(managedRegion.id)}/disable`,
    'POST',
    {},
  ))
  assertForbidden(
    readOnlyCreate,
    readOnlyUpdate,
    readOnlyEnable,
    readOnlyDisable,
  )
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await waitForRegionTable(limitedPage)
  const readOnlyActions = await readVisibleRowActions(regionCode)
  assert.deepEqual(readOnlyActions, { buttons: [], readonly: true })
  assert.equal(
    await limitedPage.evaluate(`!document.body.innerText.includes(
      '新增国家/地区',
    )`),
    true,
  )

  // create：只创建独立矩阵节点；update/enable/disable 相邻接口均拒绝。
  await openMatrixSession(['regions:create', 'regions:read'])
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await waitForRegionTable(limitedPage)
  await limitedPage.waitFor(`document.body.innerText.includes(
    '新增国家/地区',
  )`)
  const createOnlyActions = await readVisibleRowActions(regionCode)
  assert.deepEqual(createOnlyActions, { buttons: [], readonly: true })
  const permissionTargetCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    {
      code: permissionTargetCode,
      enabled: false,
      englishName: 'Permission matrix target',
      name: '权限验收地区',
      parentId: null,
      sortOrder: 9998,
    },
  ))
  assert.equal(permissionTargetCreate.status, 201)
  assert.equal(permissionTargetCreate.body?.code, permissionTargetCode)
  assert.equal(permissionTargetCreate.body?.enabled, false)
  let permissionTarget = permissionTargetCreate.body
  const createOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}`,
    'PATCH',
    { name: '禁止越权修改' },
  ))
  const createOnlyEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/enable`,
    'POST',
    {},
  ))
  const createOnlyDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/disable`,
    'POST',
    {},
  ))
  assertForbidden(createOnlyUpdate, createOnlyEnable, createOnlyDisable)

  // update：真实修改独立节点，create/enable/disable 继续由 Server 拒绝。
  await openMatrixSession(['regions:read', 'regions:update'])
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await waitForRegionTable(limitedPage)
  const updateOnlyActions = await readVisibleRowActions(permissionTargetCode)
  assert.deepEqual(updateOnlyActions, { buttons: ['编辑'], readonly: false })
  const permissionTargetUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}`,
    'PATCH',
    { name: '权限验收地区已修改' },
  ))
  assert.equal(permissionTargetUpdate.status, 200)
  assert.equal(permissionTargetUpdate.body?.name, '权限验收地区已修改')
  permissionTarget = permissionTargetUpdate.body
  const updateOnlyCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    forbiddenCreatePayload,
  ))
  const updateOnlyEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/enable`,
    'POST',
    {},
  ))
  const updateOnlyDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/disable`,
    'POST',
    {},
  ))
  assertForbidden(updateOnlyCreate, updateOnlyEnable, updateOnlyDisable)

  // enable：停用节点只显示启用，成功后 create/update/disable 仍不能调用。
  await openMatrixSession(['regions:enable', 'regions:read'])
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await waitForRegionTable(limitedPage)
  const enableOnlyActions = await readVisibleRowActions(permissionTargetCode)
  assert.deepEqual(enableOnlyActions, { buttons: ['启用'], readonly: false })
  const permissionTargetEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/enable`,
    'POST',
    {},
  ))
  assert.equal(permissionTargetEnable.status, 200)
  assert.equal(permissionTargetEnable.body?.region?.enabled, true)
  permissionTarget = permissionTargetEnable.body.region
  const enableOnlyCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    forbiddenCreatePayload,
  ))
  const enableOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}`,
    'PATCH',
    { name: '禁止越权修改' },
  ))
  const enableOnlyDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/disable`,
    'POST',
    {},
  ))
  assertForbidden(enableOnlyCreate, enableOnlyUpdate, enableOnlyDisable)

  // disable：启用节点只显示停用，成功后 create/update/enable 仍不能调用。
  await openMatrixSession(['regions:disable', 'regions:read'])
  await limitedPage.navigate(
    matrixRouteUrl(managementRoute),
  )
  await waitForRegionTable(limitedPage)
  const disableOnlyActions = await readVisibleRowActions(permissionTargetCode)
  assert.deepEqual(disableOnlyActions, { buttons: ['停用'], readonly: false })
  const permissionTargetDisable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/disable`,
    'POST',
    {},
  ))
  assert.equal(permissionTargetDisable.status, 200)
  assert.equal(permissionTargetDisable.body?.region?.enabled, false)
  const disableOnlyCreate = await limitedPage.evaluate(apiExpression(
    '/api/regions',
    'POST',
    forbiddenCreatePayload,
  ))
  const disableOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}`,
    'PATCH',
    { name: '禁止越权修改' },
  ))
  const disableOnlyEnable = await limitedPage.evaluate(apiExpression(
    `/api/regions/${encodeURIComponent(permissionTarget.id)}/enable`,
    'POST',
    {},
  ))
  assertForbidden(disableOnlyCreate, disableOnlyUpdate, disableOnlyEnable)

  const finalMatrixLogout = await limitedPage.evaluate(
    apiExpression('/api/auth/logout', 'POST', {}),
  )
  assert.equal(finalMatrixLogout.status, 204)
  /*
   * raw fetch logout 有意不伪造 Store 状态；直接以真实 `/me` 证明 Cookie 已失效，
   * 随后关闭隔离 Profile。重新加载 test build 会命中同一既有 bootstrap 循环，
   * 与地区权限矩阵的验收目标无关。
   */
  const finalMatrixMe = await limitedPage.evaluate(
    apiExpression('/api/auth/me'),
  )
  assert.equal(finalMatrixMe.status, 401)
  assert.equal(finalMatrixMe.body?.code, 'AUTHENTICATION_REQUIRED')
  matrixAuthenticated = false
  limitedIssues.stop()
  limitedIssuesStarted = false
  assert.deepEqual(limitedIssues.issues, [])
  limitedPage.close()
  page.close()
  peer.close()
})
