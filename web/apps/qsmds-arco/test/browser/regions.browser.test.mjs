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
  openRegionLevelSelect,
  patchPermissionsExpression,
  pressKey,
  readConfiguration,
  regionProviderExpression,
  requestPathname,
  requestSearchParams,
  restorePermissionsExpression,
  selectRegionOption,
  selectVisibleFilter,
  subscribeToRegionInvalidation,
  waitForNoVisibleDialog,
  waitForRegionSelectOptions,
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

test('真实 Chrome 覆盖 QsRegionSelector 三级 FaSelect、HTTP、错误与表单语义', {
  timeout: 240_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const rootTestId = 'region-selector-e2e-primary'
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-regions-selector`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const issues = collectRuntimeIssues(page)
  const searchRequests = []
  const removeNetworkListener = page.on(
    'Network.requestWillBeSent',
    (event) => {
      if (requestPathname(event) === '/api/region-selection/search') {
        searchRequests.push(event.requestId)
      }
    },
  )
  t.after(() => removeNetworkListener())

  await page.setViewport(1280, 800, false)
  await runBrowserStep('selector login route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runBrowserStep('selector real login', () =>
    loginThroughRealHttp(page, configuration))
  issues.start()

  // 合法国家部分值的冷启动 root 先失败一次；重试后必须继续恢复原始 UUID。
  await runBrowserStep('selector root failure interception', () =>
    failNextRequest(
      page,
      [{
        requestStage: 'Request',
        urlPattern: `${configuration.baseUrl}/api/region-selection/options*`,
      }],
      event => requestPathname(event) === '/api/region-selection/options'
        && !requestSearchParams(event).has('parentId'),
      () => page.navigate(appRouteUrl(
        configuration.baseUrl,
        `${selectorRoute}?case=partial-country`,
      )),
    ))
  await runBrowserStep('selector target ready', () =>
    waitForAfterAuthentication(page, `document.querySelector(
      '[data-testid="${rootTestId}"][data-slot="qs-region-selector"]',
    ) !== null`))
  await page.waitFor(`document.querySelector(
    '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('国家/地区列表加载失败')`)

  const emptySemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const proxy = root?.querySelector(
      '[data-slot="qs-region-selector-form-control"]',
    )
    const form = document.querySelector(
      '[data-testid="region-selector-live-form"]',
    )
    const triggers = [...(root?.querySelectorAll(
      '[data-slot="select-trigger"][role="combobox"]',
    ) ?? [])]
    return {
      cityDisabled: triggers[2]?.disabled,
      countryId: triggers[0]?.id,
      customValidity: proxy?.validationMessage,
      formValue: form ? new FormData(form).get('regionCityId') : null,
      provinceDisabled: triggers[1]?.disabled,
      proxyName: proxy?.name,
      proxyRequired: proxy?.required,
      proxyValid: proxy?.validity.valid,
      triggerCount: triggers.length,
    }
  })()`)
  assert.deepEqual(emptySemantics, {
    cityDisabled: true,
    countryId: 'region-selector-e2e-primary',
    customValidity: '请选择完整地区',
    formValue: '',
    provinceDisabled: true,
    proxyName: 'regionCityId',
    proxyRequired: true,
    proxyValid: false,
    triggerCount: 3,
  })

  await clickVisibleButton(page, '重试加载')
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const triggers = [...(root?.querySelectorAll(
      '[data-slot="select-trigger"][role="combobox"]',
    ) ?? [])]
    return triggers[0]?.textContent?.trim() === '中国台湾'
      && triggers[1]?.disabled === false
      && triggers[2]?.disabled === true
      && root?.querySelector(
        '[data-slot="qs-region-selector-path"]',
      )?.textContent?.trim() === '中国台湾'
  })()`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-country-value"]',
    )?.textContent?.trim()`),
    '2e30acdf-7559-5fc2-8e00-c5b069d3df8b',
  )

  // 基准 ID 与完整同层数据来自真实 selection API。
  const rootsResponse = await page.evaluate(
    apiExpression('/api/region-selection/options'),
  )
  assert.equal(rootsResponse.status, 200)
  const chinaCountry = rootsResponse.body?.find(region => region.code === 'CN')
  const taiwanCountry = rootsResponse.body?.find(region => region.code === 'TW')
  assert.equal(chinaCountry?.name, '中国')
  assert.equal(taiwanCountry?.name, '中国台湾')

  const chinaProvinceResponse = await page.evaluate(apiExpression(
    `/api/region-selection/options?parentId=${encodeURIComponent(chinaCountry.id)}`,
  ))
  assert.equal(chinaProvinceResponse.status, 200)
  assert.equal(chinaProvinceResponse.body?.length, 31)
  const guangdongProvince = chinaProvinceResponse.body?.find(
    region => region.code === 'CN-440000',
  )
  assert.equal(guangdongProvince?.name, '广东省')

  const guangdongCityResponse = await page.evaluate(apiExpression(
    `/api/region-selection/options?parentId=${encodeURIComponent(guangdongProvince.id)}`,
  ))
  assert.equal(guangdongCityResponse.status, 200)
  assert.equal(guangdongCityResponse.body?.length, 21)

  const taiwanProvinceResponse = await page.evaluate(apiExpression(
    `/api/region-selection/options?parentId=${encodeURIComponent(taiwanCountry.id)}`,
  ))
  assert.equal(taiwanProvinceResponse.status, 200)
  assert.equal(taiwanProvinceResponse.body?.length, 1)
  const taiwanProvince = taiwanProvinceResponse.body?.find(
    region => region.code === 'TW-TAIWAN',
  )
  assert.equal(taiwanProvince?.name, '台湾')

  const taiwanCityResponse = await page.evaluate(apiExpression(
    `/api/region-selection/options?parentId=${encodeURIComponent(taiwanProvince.id)}`,
  ))
  assert.equal(taiwanCityResponse.status, 200)
  assert.equal(taiwanCityResponse.body?.length, 22)
  const kaohsiung = taiwanCityResponse.body?.find(
    region => region.code === 'TW-64000',
  )
  assert.equal(kaohsiung?.name, '高雄市')

  /*
   * 上一个部分值已经预热 Provider。先在无选择器的路由通过正式失效通道清空
   * 缓存，再让合法省/州部分值的首次直属列表失败，固定 retry hydration 边界。
   */
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=provider-only&before=partial-province`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="provider-only"]',
  ) !== null`)
  await subscribeToRegionInvalidation(page)
  await broadcastRegionInvalidation(page)
  await page.waitFor('globalThis.__regionInvalidations >= 1')
  await runBrowserStep('selector partial province failure interception', () =>
    failNextRequest(
      page,
      [{
        requestStage: 'Request',
        urlPattern: `${configuration.baseUrl}/api/region-selection/options*`,
      }],
      event => requestSearchParams(event).get('parentId')
        === taiwanCountry.id,
      () => page.navigate(appRouteUrl(
        configuration.baseUrl,
        `${selectorRoute}?case=partial-province`,
      )),
    ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="partial-province"] [data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('中国台湾的省/州加载失败')`)
  const failedPartialProvince = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const triggers = [...(root?.querySelectorAll(
      '[data-slot="select-trigger"][role="combobox"]',
    ) ?? [])]
    return {
      cityDisabled: triggers[2]?.disabled,
      countryText: triggers[0]?.textContent?.trim(),
      provinceDisabled: triggers[1]?.disabled,
      provinceText: triggers[1]?.textContent?.trim(),
      provinceValue: document.querySelector(
        '[data-testid="region-selector-province-value"]',
      )?.textContent?.trim(),
    }
  })()`)
  assert.deepEqual(failedPartialProvince, {
    cityDisabled: true,
    countryText: '中国台湾',
    provinceDisabled: false,
    provinceText: '加载失败，请重试',
    provinceValue: taiwanProvince.id,
  })
  await clickVisibleButton(page, '重试加载')
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const province = root?.querySelector(
      '[data-region-level="PROVINCE_STATE"] [data-slot="select-trigger"]',
    )
    const city = root?.querySelector(
      '[data-region-level="CITY"] [data-slot="select-trigger"]',
    )
    return province?.textContent?.trim() === '台湾'
      && city?.disabled === false
      && root?.querySelector(
        '[data-slot="qs-region-selector-path"]',
      )?.textContent?.trim() === '中国台湾 台湾'
  })()`)

  /*
   * 部分省/州恢复会按设计预取直属城市。先在无选择器路由再次清空 Provider
   * 缓存，确保后续“城市首次请求失败”仍验证真实 HTTP，而不是命中预热缓存。
   */
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=provider-only&after=partial-retry`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="provider-only"]',
  ) !== null`)
  await broadcastRegionInvalidation(page)
  await page.waitFor('globalThis.__regionInvalidations >= 2')

  // 后续标准交互使用全空 value，避免部分值恢复场景污染逐级清理断言。
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard&after=partial-retry`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="standard"]',
  ) !== null`)
  await openRegionLevelSelect(page, rootTestId, 'COUNTRY_REGION')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'COUNTRY_REGION',
    rootsResponse.body.map(region => region.name),
  )
  await selectRegionOption(page, rootTestId, 'COUNTRY_REGION', '中国')
  await openRegionLevelSelect(page, rootTestId, 'PROVINCE_STATE')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'PROVINCE_STATE',
    chinaProvinceResponse.body.map(region => region.name),
  )
  await selectRegionOption(page, rootTestId, 'PROVINCE_STATE', '广东省')
  await openRegionLevelSelect(page, rootTestId, 'CITY')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'CITY',
    guangdongCityResponse.body.map(region => region.name),
  )
  await pressKey(page, 'Escape')

  // 切换国家必须原子清空省/州和城市，随后只加载新国家的省/州。
  await selectRegionOption(page, rootTestId, 'COUNTRY_REGION', '中国台湾')
  await page.waitFor(`(() => {
    const country = document.querySelector(
      '[data-testid="region-selector-country-value"]',
    )?.textContent?.trim()
    const province = document.querySelector(
      '[data-testid="region-selector-province-value"]',
    )?.textContent?.trim()
    const city = document.querySelector(
      '[data-testid="region-selector-city-value"]',
    )?.textContent?.trim()
    const cityTrigger = document.querySelector(
      '[data-testid="${rootTestId}"] [data-region-level="CITY"] [data-slot="select-trigger"]',
    )
    return country === ${JSON.stringify(taiwanCountry.id)}
      && province === 'null'
      && city === 'null'
      && cityTrigger?.disabled === true
  })()`)
  await openRegionLevelSelect(page, rootTestId, 'PROVINCE_STATE')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'PROVINCE_STATE',
    taiwanProvinceResponse.body.map(region => region.name),
  )

  // 台湾省选择后的城市请求失败一次；重试后必须得到数据库完整 22 城市。
  await runBrowserStep('selector city failure interception', () =>
    failNextRequest(
      page,
      [{
        requestStage: 'Request',
        urlPattern: `${configuration.baseUrl}/api/region-selection/options*`,
      }],
      event => requestSearchParams(event).get('parentId')
        === taiwanProvince.id,
      () => selectRegionOption(
        page,
        rootTestId,
        'PROVINCE_STATE',
        '台湾',
      ),
    ))
  await page.waitFor(`document.querySelector(
    '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('台湾的城市加载失败')`)
  await clickVisibleButton(page, '重试加载')
  await openRegionLevelSelect(page, rootTestId, 'CITY')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'CITY',
    taiwanCityResponse.body.map(region => region.name),
  )
  await selectRegionOption(page, rootTestId, 'CITY', '高雄市')

  await page.waitFor(`(() => (
    document.querySelector(
      '[data-testid="region-selector-country-value"]',
    )?.textContent?.trim() === ${JSON.stringify(taiwanCountry.id)}
    && document.querySelector(
      '[data-testid="region-selector-province-value"]',
    )?.textContent?.trim() === ${JSON.stringify(taiwanProvince.id)}
    && document.querySelector(
      '[data-testid="region-selector-city-value"]',
    )?.textContent?.trim() === ${JSON.stringify(kaohsiung.id)}
  ))()`)
  await page.waitFor(`document.querySelector(
    '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-path"]',
  )?.textContent?.trim() === '中国台湾 台湾 高雄市'`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-change"]',
    )?.textContent?.trim()`),
    'city · 中国台湾 台湾 高雄市 · complete=true',
  )

  const selectedSemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const proxy = root?.querySelector(
      '[data-slot="qs-region-selector-form-control"]',
    )
    const country = root?.querySelector(
      '[data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
    )
    const form = document.querySelector(
      '[data-testid="region-selector-live-form"]',
    )
    document.querySelector(
      'label[for="region-selector-e2e-primary"]',
    )?.click()
    return {
      activeCountry: document.activeElement === country,
      countryDescribedBy: country?.getAttribute('aria-describedby'),
      countryLabels: [...(country?.labels ?? [])]
        .map(label => label.textContent?.trim() ?? ''),
      countryLabelledBy: country?.getAttribute('aria-labelledby'),
      formValue: form ? new FormData(form).get('regionCityId') : null,
      proxyRequired: proxy?.required,
      proxyValid: proxy?.validity.valid,
      proxyValue: proxy?.value,
    }
  })()`)
  assert.deepEqual(selectedSemantics, {
    activeCountry: true,
    countryDescribedBy: 'region-selector-e2e-help',
    countryLabelledBy: null,
    countryLabels: ['业务所在城市', '国家/地区'],
    formValue: kaohsiung.id,
    proxyRequired: true,
    proxyValid: true,
    proxyValue: kaohsiung.id,
  })

  await clickVisibleButton(page, '验证 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-form-data"]',
  )?.textContent?.trim() === ${JSON.stringify(kaohsiung.id)}`)

  await clickVisibleButton(page, '清空地区')
  await page.waitFor(`(() => (
    ['country', 'province', 'city'].every(level =>
      document.querySelector(
        '[data-testid="region-selector-' + level + '-value"]',
      )?.textContent?.trim() === 'null')
  ))()`)
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="region-selector-change"]',
    )?.textContent?.trim()`),
    'clear · complete=false',
  )
  const clearedSemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const proxy = root?.querySelector(
      '[data-slot="qs-region-selector-form-control"]',
    )
    const form = document.querySelector(
      '[data-testid="region-selector-live-form"]',
    )
    return {
      formValue: form ? new FormData(form).get('regionCityId') : null,
      proxyValid: proxy?.validity.valid,
      proxyValue: proxy?.value,
    }
  })()`)
  assert.deepEqual(clearedSemantics, {
    formValue: '',
    proxyValid: false,
    proxyValue: '',
  })

  // required 失败必须给出可见反馈，并把焦点落到首个未完成的国家字段。
  assert.equal(
    await page.evaluate(`document.querySelector(
      '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
    ) === null`),
    true,
  )
  await clickVisibleButton(page, '验证 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('请选择完整地区')`)
  const invalidSubmitSemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const country = root?.querySelector(
      '[data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
    )
    const feedback = root?.querySelector(
      '[data-slot="qs-region-selector-error"]',
    )
    const proxy = root?.querySelector(
      '[data-slot="qs-region-selector-form-control"]',
    )
    const form = document.querySelector(
      '[data-testid="region-selector-live-form"]',
    )
    return {
      activeCountry: document.activeElement === country,
      countryInvalid: country?.getAttribute('aria-invalid'),
      describedByIncludesFeedback: Boolean(
        feedback?.id
        && country?.getAttribute('aria-describedby')
          ?.split(/\\s+/u)
          .includes(feedback.id),
      ),
      feedbackRole: feedback?.getAttribute('role'),
      feedbackText: feedback?.textContent?.trim(),
      formValue: form ? new FormData(form).get('regionCityId') : null,
      proxyMessage: proxy?.validationMessage,
      proxyValid: proxy?.validity.valid,
    }
  })()`)
  assert.deepEqual(invalidSubmitSemantics, {
    activeCountry: true,
    countryInvalid: 'true',
    describedByIncludesFeedback: true,
    feedbackRole: 'alert',
    feedbackText: '请选择完整地区。',
    formValue: '',
    proxyMessage: '请选择完整地区',
    proxyValid: false,
  })

  // 完整 value 的 path 即使失败，root options 也必须独立可用，清空后可立即改选。
  await runBrowserStep('selector path failure interception', () =>
    failNextRequest(
      page,
      [{
        requestStage: 'Request',
        urlPattern: `${configuration.baseUrl}/api/region-selection/paths/*`,
      }],
      event => requestPathname(event)
        === `/api/region-selection/paths/${kaohsiung.id}`,
      () => page.navigate(appRouteUrl(
        configuration.baseUrl,
        `${selectorRoute}?case=path&value=${encodeURIComponent(kaohsiung.id)}`,
      )),
    ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="path"] [data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('已选地区回显失败')`)
  await openRegionLevelSelect(page, rootTestId, 'COUNTRY_REGION')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'COUNTRY_REGION',
    rootsResponse.body.map(region => region.name),
  )
  await pressKey(page, 'Escape')
  await clickVisibleButton(page, '清空地区')
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-country-value"]',
  )?.textContent?.trim() === 'null'`)

  /*
   * 外部部分 value 可能来自旧数据或错误调用方。不存在的 UUID 必须保留在
   * v-model 供调用方处置，但绝不能让 FaSelect 回退显示第一条真实 option，
   * 也不能因此提前启用下一级或把 required 焦点移到错误层级。
   */
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=invalid-country`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="invalid-country"] [data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('已选国家/地区无法回显')`)
  const invalidCountrySemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const triggers = [...(root?.querySelectorAll(
      '[data-slot="select-trigger"][role="combobox"]',
    ) ?? [])]
    return {
      cityDisabled: triggers[2]?.disabled,
      countryText: triggers[0]?.textContent?.trim(),
      countryValue: document.querySelector(
        '[data-testid="region-selector-country-value"]',
      )?.textContent?.trim(),
      provinceDisabled: triggers[1]?.disabled,
    }
  })()`)
  assert.deepEqual(invalidCountrySemantics, {
    cityDisabled: true,
    countryText: '请选择国家/地区',
    countryValue: '00000000-0000-4000-8000-000000000901',
    provinceDisabled: true,
  })
  await clickVisibleButton(page, '验证 FormData')
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const country = root?.querySelector(
      '[data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
    )
    return document.activeElement === country
      && country?.getAttribute('aria-invalid') === 'true'
  })()`)

  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=invalid-province`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="invalid-province"] [data-testid="${rootTestId}"] [data-slot="qs-region-selector-error"]',
  )?.textContent?.includes('已选省/州无法回显')`)
  const invalidProvinceSemantics = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const triggers = [...(root?.querySelectorAll(
      '[data-slot="select-trigger"][role="combobox"]',
    ) ?? [])]
    return {
      cityDisabled: triggers[2]?.disabled,
      countryText: triggers[0]?.textContent?.trim(),
      provinceDisabled: triggers[1]?.disabled,
      provinceText: triggers[1]?.textContent?.trim(),
      provinceValue: document.querySelector(
        '[data-testid="region-selector-province-value"]',
      )?.textContent?.trim(),
    }
  })()`)
  assert.deepEqual(invalidProvinceSemantics, {
    cityDisabled: true,
    countryText: '中国台湾',
    provinceDisabled: false,
    provinceText: '请选择省/州',
    provinceValue: '00000000-0000-4000-8000-000000000902',
  })
  await clickVisibleButton(page, '验证 FormData')
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const province = root?.querySelector(
      '[data-region-level="PROVINCE_STATE"] [data-slot="select-trigger"]',
    )
    return document.activeElement === province
      && province?.getAttribute('aria-invalid') === 'true'
  })()`)

  // 完整外部 value 回显、readonly 和 disabled 都使用真实台湾三级 ID。
  // 先离开 path 场景，确保下一次导航触发 harness 重置与组件冷启动；直接
  // navigate 到相同 URL 会被 Vue Router 判定为重复导航，无法验证重试恢复。
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard&after=path-failure`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="standard"]',
  ) !== null`)
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=path&value=${encodeURIComponent(kaohsiung.id)}`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="${rootTestId}"] [data-slot="qs-region-selector-path"]',
  )?.textContent?.trim() === '中国台湾 台湾 高雄市'`)

  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=states&value=${encodeURIComponent(kaohsiung.id)}`,
  ))
  await waitForAfterAuthentication(page, `(() => {
    const readonlyRoot = document.querySelector(
      '[data-testid="region-selector-e2e-readonly"]',
    )
    const disabledRoot = document.querySelector(
      '[data-testid="region-selector-e2e-disabled"]',
    )
    const disabledTriggers = [...(disabledRoot?.querySelectorAll(
      '[data-slot="select-trigger"]',
    ) ?? [])]
    return readonlyRoot?.querySelector(
      '[data-slot="qs-region-selector-readonly"]',
    )?.value === '中国台湾 台湾 高雄市'
      && disabledTriggers.length === 3
      && disabledTriggers.every(trigger => trigger.disabled)
  })()`)
  const readonlySemantics = await page.evaluate(`(() => {
    const root = document.querySelector(
      '[data-testid="region-selector-e2e-readonly"]',
    )
    const readout = root?.querySelector(
      '[data-slot="qs-region-selector-readonly"]',
    )
    document.querySelector(
      'label[for="region-selector-e2e-readonly"]',
    )?.click()
    return {
      active: document.activeElement === readout,
      labels: [...(readout?.labels ?? [])]
        .map(label => label.textContent?.trim() ?? ''),
      readonly: readout?.readOnly,
      tagName: readout?.tagName,
      value: readout?.value,
    }
  })()`)
  assert.deepEqual(readonlySemantics, {
    active: true,
    labels: ['只读地区'],
    readonly: true,
    tagName: 'INPUT',
    value: '中国台湾 台湾 高雄市',
  })

  // 窄屏改为纵向三级字段；活动 listbox 不制造页面横向溢出。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    `${selectorRoute}?case=standard`,
  ))
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="region-selector-browser-harness"][data-e2e-case="standard"] [data-testid="${rootTestId}"]',
  ) !== null`)
  const mobileLayout = await page.evaluate(`(() => {
    const root = document.querySelector('[data-testid="${rootTestId}"]')
    const levels = [...(root?.querySelectorAll('[data-region-level]') ?? [])]
    const tops = levels.map(level => level.getBoundingClientRect().top)
    const viewportWidth = document.documentElement.clientWidth
    return {
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      levelCount: levels.length,
      stacked: tops.length === 3 && tops[0] < tops[1] && tops[1] < tops[2],
      touchTargets: levels.every(level =>
        level.querySelector('[data-slot="select-trigger"]')
          ?.getBoundingClientRect().height >= 44),
    }
  })()`)
  assert.deepEqual(mobileLayout, {
    documentFits: true,
    levelCount: 3,
    stacked: true,
    touchTargets: true,
  })
  await openRegionLevelSelect(page, rootTestId, 'COUNTRY_REGION')
  await waitForRegionSelectOptions(
    page,
    rootTestId,
    'COUNTRY_REGION',
    rootsResponse.body.map(region => region.name),
  )
  const mobilePopup = await page.evaluate(`(() => {
    const trigger = document.querySelector(
      '[data-testid="${rootTestId}"] [data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
    )
    const content = document.getElementById(
      trigger?.getAttribute('aria-controls') ?? '',
    )
    const rect = content?.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    return {
      insideViewport: Boolean(rect)
        && rect.left >= 0
        && rect.right <= viewportWidth,
      viewportWidth,
    }
  })()`)
  assert.equal(mobilePopup.insideViewport, true, JSON.stringify(mobilePopup))

  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const motion = await page.evaluate(`(() => {
    const trigger = document.querySelector(
      '[data-testid="${rootTestId}"] [data-slot="select-trigger"]',
    )
    const durations = (value) => value.split(',').map((part) => {
      const text = part.trim()
      return text.endsWith('ms')
        ? Number.parseFloat(text) / 1000
        : Number.parseFloat(text)
    })
    const style = trigger ? getComputedStyle(trigger) : null
    return {
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      seconds: style
        ? [
            ...durations(style.animationDuration),
            ...durations(style.transitionDuration),
          ]
        : [],
    }
  })()`)
  assert.equal(motion.matches, true)
  assert.equal(
    motion.seconds.every(value => Number.isFinite(value) && value <= 0.001),
    true,
  )

  // 正式 Showcase 的标准状态同样读取数据库完整数据，不使用 fixture。
  await page.setViewport(1280, 800, false)
  await page.navigate(appRouteUrl(
    configuration.baseUrl,
    '/component-library/business/region-selector',
  ))
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-showcase-standard"]',
  ) !== null`)
  await openRegionLevelSelect(
    page,
    'region-selector-showcase-standard',
    'COUNTRY_REGION',
  )
  await waitForRegionSelectOptions(
    page,
    'region-selector-showcase-standard',
    'COUNTRY_REGION',
    rootsResponse.body.map(region => region.name),
  )
  await selectRegionOption(
    page,
    'region-selector-showcase-standard',
    'COUNTRY_REGION',
    '中国台湾',
  )
  await openRegionLevelSelect(
    page,
    'region-selector-showcase-standard',
    'PROVINCE_STATE',
  )
  await waitForRegionSelectOptions(
    page,
    'region-selector-showcase-standard',
    'PROVINCE_STATE',
    ['台湾'],
  )
  await selectRegionOption(
    page,
    'region-selector-showcase-standard',
    'PROVINCE_STATE',
    '台湾',
  )
  await openRegionLevelSelect(
    page,
    'region-selector-showcase-standard',
    'CITY',
  )
  await waitForRegionSelectOptions(
    page,
    'region-selector-showcase-standard',
    'CITY',
    taiwanCityResponse.body.map(region => region.name),
  )
  await selectRegionOption(
    page,
    'region-selector-showcase-standard',
    'CITY',
    '高雄市',
  )
  await page.waitFor(`document.querySelector(
    '[data-testid="region-selector-showcase-standard"] [data-slot="qs-region-selector-path"]',
  )?.textContent?.trim() === '中国台湾 台湾 高雄市'`)
  await page.waitFor(`document.body.innerText.includes(
    '当前历史地区已停用，仅供回显',
  )`)

  assert.equal(searchRequests.length, 0)
  issues.stop()
  assert.deepEqual(issues.issues, [])
  page.close()
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
     * 基础数据父级保持权限中立。账号同时失去地区、货币与汇率读取权限后，
     * Router 应跳过所有受保护叶子并进入第一个仍可访问的编号管理页面。
     */
    await page.navigate(appRouteUrl(configuration.baseUrl, '/system/basic-data'))
    await page.waitFor(`(() => {
      const body = document.body.innerText
      return location.hash === '#/system/basic-data/numbering'
        && ['编号管理', '字典管理']
          .every(title => body.includes(title))
        && !body.includes('货币汇率')
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
