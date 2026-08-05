/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import { collectDictionaryRuntimeErrors } from './dictionaries.browser.helpers.mjs'
import {
  clickDialogButton,
  fillDialogControl,
  waitForAfterAuthentication,
  waitForNoVisibleDialog,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  failResponseAfterServerMutation,
  loginThroughRealHttp,
  patchPermissionsExpression,
  pressKey,
  requestPathname,
} from './regions.browser.helpers.mjs'
import {
  readSupplierBrowserConfiguration,
  supplierLayoutAuditExpression,
} from './suppliers.browser.helpers.mjs'

const managementRoute = '/system/service-provider/suppliers'
const initialLegalName = '浏览器供应商'
const finalLegalName = '浏览器供应商已编辑'
const finalShortName = '浏览器供方'
const contactName = '林联系'
const contactPhone = '13800138000'
const contactWechatId = 'supplier_wechat'
const finalRemark = '浏览器供应商备注已编辑'
let remountVersion = 0

async function runSupplierBrowserStep(label, action) {
  process.stdout.write(`[suppliers-browser] ${label}\n`)
  try {
    return await action()
  }
  catch (error) {
    throw new Error(`Suppliers browser step failed: ${label}`, {
      cause: error,
    })
  }
}

async function clickVisibleButton(page, { ariaLabel, text }) {
  const expression = `(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && !candidate.disabled
      && (${ariaLabel === undefined
        ? `candidate.textContent?.trim() === ${JSON.stringify(text)}`
        : `candidate.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)}`})
    ))
    if (!button) return false
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`
  await page.waitFor(expression.replace('button.click()\n    return true', 'return true'))
  await page.evaluate(expression)
}

async function waitForSupplierTable(page, marker = '') {
  await page.waitFor(`(() => {
    const table = document.querySelector('[data-testid="supplier-table"]')
    return location.hash === '#${managementRoute}'
      && table?.getClientRects().length > 0
      && table.querySelector('[aria-busy="true"]') === null
      && document.querySelector('.qianshu-loading') === null
      && table.textContent?.includes(${JSON.stringify(marker)})
  })()`)
}

async function fillSupplierRemark(page, value) {
  const serializedValue = JSON.stringify(value)
  const predicate = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
      .find(candidate => candidate.textContent?.includes('编辑供应商'))
    const textarea = dialog?.querySelector('textarea')
    return textarea instanceof HTMLTextAreaElement
      && !textarea.disabled
      && textarea.getClientRects().length > 0
  })()`
  const expression = `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
      .find(candidate => candidate.textContent?.includes('编辑供应商'))
    const textarea = dialog?.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement)
      || textarea.disabled
      || textarea.getClientRects().length === 0) return false
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      .set.call(textarea, ${serializedValue})
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`
  await page.waitFor(predicate)
  await page.evaluate(expression)
}

async function fillSupplierAutocompleteInput(page, autocomplete, value) {
  const serializedAutocomplete = JSON.stringify(autocomplete)
  const serializedValue = JSON.stringify(value)
  const selector = `input[autocomplete=${serializedAutocomplete}]`
  await page.waitFor(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    return input instanceof HTMLInputElement
      && !input.disabled
      && input.getClientRects().length > 0
  })()`)
  await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('supplier autocomplete input unavailable')
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${serializedValue})
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)})
    ?.value === ${serializedValue}`)
}

async function remountSupplierWorkspace(page, baseUrl, marker) {
  remountVersion += 1
  const url = new URL(`${baseUrl}/`)
  url.searchParams.set('supplier-e2e-remount', String(remountVersion))
  url.hash = `#${managementRoute}`
  await page.navigate(url.toString())
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="supplier-management-page"]',
  ) !== null`)
  await waitForSupplierTable(page, marker)
}

function requestIdentity(event) {
  const headers = event.request?.headers ?? {}
  const idempotencyKeyEntry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'idempotency-key',
  )
  return {
    idempotencyKey: idempotencyKeyEntry?.[1],
    payload: event.request?.postData,
  }
}

async function createSupplierWithUnknownResult(page, capturedCreates) {
  await clickVisibleButton(page, { text: '新建供应商' })
  await waitForVisibleDialog(page, '新建供应商')
  await fillDialogControl(page, '新建供应商', '法定名称', initialLegalName)
  await fillSupplierAutocompleteInput(page, 'tel', contactPhone)
  await fillSupplierAutocompleteInput(page, 'name', contactName)

  // helper 内部以 `requestStage: 'Response'` 拦截已成功返回的 POST，证明 Server
  // 已提交而浏览器未收到结果；随后 UI 只能使用原 Idempotency-Key 人工确认。
  await failResponseAfterServerMutation(
    page,
    '*api/suppliers',
    'POST',
    () => clickDialogButton(page, '新建供应商', '创建停用草稿'),
  )
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('新建供应商'))
    return dialog?.textContent?.includes('创建结果未知')
      && dialog.textContent.includes('使用原请求确认结果')
  })()`)
  await clickDialogButton(page, '新建供应商', '使用原请求确认结果')
  await waitForNoVisibleDialog(page, '新建供应商')
  await waitForSupplierTable(page, initialLegalName)

  assert.equal(capturedCreates.length, 2)
  assert.match(capturedCreates[0]?.idempotencyKey ?? '', /^[a-f0-9-]{36}$/u)
  assert.deepEqual(capturedCreates[1], capturedCreates[0])
  assert.deepEqual(JSON.parse(capturedCreates[0].payload), {
    entityType: 'ORGANIZATION',
    legalName: initialLegalName,
    primaryAddress: null,
    primaryContact: {
      name: contactName,
      phone: contactPhone,
      wechatId: null,
    },
    registration: null,
    remark: null,
    shortName: null,
  })
}

async function editSupplier(page) {
  await clickVisibleButton(page, {
    ariaLabel: `编辑供应商 · ${initialLegalName}`,
  })
  await waitForVisibleDialog(page, '编辑供应商')
  await fillDialogControl(page, '编辑供应商', '法定名称', finalLegalName)
  await fillDialogControl(page, '编辑供应商', '简称', finalShortName)
  await fillDialogControl(page, '编辑供应商', '微信号', contactWechatId)
  await fillSupplierRemark(page, finalRemark)
  await clickDialogButton(page, '编辑供应商', '保存修改')
  await waitForNoVisibleDialog(page, '编辑供应商')
  await waitForSupplierTable(page, finalLegalName)
}

async function changeSupplierStatus(page, action) {
  const actionLabel = action === 'enable' ? '启用' : '停用'
  const title = `确认${actionLabel}供应商`
  await clickVisibleButton(page, {
    ariaLabel: `${actionLabel}供应商 · ${finalLegalName}`,
  })
  await waitForVisibleDialog(page, title)
  if (action === 'enable') {
    const presentation = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .filter(candidate => candidate.getClientRects().length > 0)
        .reverse()
        .find(candidate => candidate.textContent?.includes(${JSON.stringify(title)}))
      const confirm = [...(dialog?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.trim() === '确认启用')
      return {
        confirmEnabled: Boolean(confirm && !confirm.disabled),
        ready: Boolean(dialog?.textContent?.includes('已满足')),
      }
    })()`)
    assert.deepEqual(presentation, { confirmEnabled: true, ready: true })
  }
  await clickVisibleButton(page, { text: `确认${actionLabel}` })
  await waitForNoVisibleDialog(page, title)
  await page.waitFor(`(() => {
    const table = document.querySelector('[data-testid="supplier-table"]')
    return table?.textContent?.includes(${JSON.stringify(
      action === 'enable' ? '已启用' : '已停用',
    )})
  })()`)
}

async function prepareLimitedIdentities(page, configuration) {
  const permissionsResponse = await page.evaluate(apiExpression('/api/permissions'))
  assert.equal(permissionsResponse.status, 200)
  const supplierPermissions = permissionsResponse.body
    ?.filter(permission => permission.code.startsWith('suppliers:'))
    .map(permission => [permission.code, permission.id, permission.name])
    .sort((left, right) => left[0].localeCompare(right[0]))
  assert.deepEqual(supplierPermissions?.map(([code]) => code), [
    'suppliers:create',
    'suppliers:disable',
    'suppliers:enable',
    'suppliers:read',
    'suppliers:update',
  ])
  assert.equal(
    supplierPermissions?.every(([, id, name]) => (
      typeof id === 'string'
      && typeof name === 'string'
      && name.includes('供应商')
    )),
    true,
  )
  const readPermissionId = supplierPermissions
    ?.find(([code]) => code === 'suppliers:read')?.[1]
  assert.equal(typeof readPermissionId, 'string')

  const readonlyRole = await page.evaluate(apiExpression('/api/roles', 'POST', {
    code: 'browser_supplier_readonly',
    description: 'Browser supplier read-only role',
    name: 'Browser Supplier Read-only',
  }))
  assert.equal(readonlyRole.status, 201)
  assert.equal((await page.evaluate(apiExpression(
    `/api/roles/${encodeURIComponent(readonlyRole.body.id)}/permissions`,
    'PUT',
    { permissionIds: [readPermissionId] },
  ))).status, 200)

  const readonlyUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser Supplier Read-only',
    mustChangePassword: false,
    password: configuration.limitedPassword,
    username: 'browser_supplier_readonly',
  }))
  assert.equal(readonlyUser.status, 201)
  assert.equal((await page.evaluate(apiExpression(
    `/api/users/${encodeURIComponent(readonlyUser.body.id)}/roles`,
    'PUT',
    { roleIds: [readonlyRole.body.id] },
  ))).status, 200)

  const noPermissionUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser Supplier No Permission',
    mustChangePassword: false,
    password: configuration.limitedPassword,
    username: 'browser_supplier_none',
  }))
  assert.equal(noPermissionUser.status, 201)
  return {
    noPermission: {
      password: configuration.limitedPassword,
      username: noPermissionUser.body.username,
    },
    readonly: {
      password: configuration.limitedPassword,
      username: readonlyUser.body.username,
    },
  }
}

function assertLayout(layout, { mobile }) {
  assert.equal(layout.workspaceVisible, true)
  assert.equal(layout.documentFitsViewport, true)
  assert.equal(layout.mobile, mobile)
  assert.equal(layout.desktopTableCount, mobile ? 0 : 1)
  assert.equal(layout.mobileRowCount, mobile ? 1 : 0)
  assert.deepEqual(
    layout.touchTargets.filter(target => !target.pass),
    [],
  )
}

test('真实 Chrome 覆盖供应商 unknown create、权限、生命周期与响应式无障碍', {
  timeout: 480_000,
}, async (t) => {
  const configuration = readSupplierBrowserConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-suppliers-admin`,
  })
  t.after(async () => browser.close())
  const page = await browser.newPage()
  const runtime = collectDictionaryRuntimeErrors(page, {
    sensitiveValues: [configuration.password, configuration.limitedPassword],
  })
  runtime.start()
  await page.setViewport(1280, 800, false)

  await runSupplierBrowserStep('admin real login and route', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(page, configuration)
    await page.navigate(appRouteUrl(configuration.baseUrl, managementRoute))
    await waitForAfterAuthentication(page, `document.querySelector(
      '[data-testid="supplier-management-page"]',
    ) !== null`)
    await waitForSupplierTable(page)
  })

  const capturedCreates = []
  const removeRequestListener = page.on('Network.requestWillBeSent', (event) => {
    if (
      event.request?.method === 'POST'
      && requestPathname(event) === '/api/suppliers'
    ) {
      capturedCreates.push(requestIdentity(event))
    }
  })
  t.after(() => removeRequestListener())

  const limitedIdentities = await runSupplierBrowserStep(
    'prepare independent permission identities',
    () => prepareLimitedIdentities(page, configuration),
  )
  await runSupplierBrowserStep('create with unknown result and manual replay', () =>
    createSupplierWithUnknownResult(page, capturedCreates))

  const listResponse = await page.evaluate(apiExpression(
    `/api/suppliers?query=${encodeURIComponent(initialLegalName)}&page=1&pageSize=20`,
  ))
  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body?.total, 1)
  const listItem = listResponse.body?.items?.[0]
  assert.deepEqual(Object.keys(listItem ?? {}).sort(), [
    'code',
    'enabled',
    'entityType',
    'hasPrimaryContactPhone',
    'hasPrimaryContactWechatId',
    'id',
    'legalName',
    'primaryAddressRegionPath',
    'primaryContactName',
    'registrationCountryRegion',
    'shortName',
    'updatedAt',
    'version',
  ])
  assert.equal(JSON.stringify(listItem).includes(contactPhone), false)

  const desktopLayout = await page.evaluate(
    supplierLayoutAuditExpression({ mobile: false }),
  )
  assertLayout(desktopLayout, { mobile: false })

  await runSupplierBrowserStep('edit supplier', () => editSupplier(page))
  const detailAfterEdit = await page.evaluate(apiExpression(
    `/api/suppliers/${encodeURIComponent(listItem.id)}`,
  ))
  assert.equal(detailAfterEdit.status, 200)
  assert.deepEqual(detailAfterEdit.body?.enableReadiness, {
    missingFields: [],
    ready: true,
  })
  assert.deepEqual(detailAfterEdit.body?.primaryContact, {
    name: contactName,
    phone: contactPhone,
    wechatId: contactWechatId,
  })
  await runSupplierBrowserStep('enable supplier', () =>
    changeSupplierStatus(page, 'enable'))
  await runSupplierBrowserStep('disable supplier', () =>
    changeSupplierStatus(page, 'disable'))

  await runSupplierBrowserStep('detail readiness excludes address and postal code', async () => {
    await clickVisibleButton(page, {
      ariaLabel: `查看供应商 · ${finalLegalName}`,
    })
    await waitForVisibleDialog(page, finalLegalName)
    const detail = await page.evaluate(`(() => {
      const root = document.querySelector('[data-testid="supplier-detail-drawer"]')
      return {
        hasReady: root?.textContent?.includes('已满足启用条件'),
        hasWebsite: root?.textContent?.includes('网站'),
        text: root?.textContent ?? '',
      }
    })()`)
    assert.equal(detail.hasReady, true)
    assert.equal(detail.hasWebsite, false)
    assert.match(detail.text, /邮编/u)
    await pressKey(page, 'Escape')
    await waitForNoVisibleDialog(page, finalLegalName)
  })

  await runSupplierBrowserStep('390px mobile, dark and reduced motion', async () => {
    await page.setViewport(390, 844, true)
    await remountSupplierWorkspace(page, configuration.baseUrl, finalLegalName)
    const lightTheme = await page.evaluate(`(() => {
      const card = document.querySelector('[data-testid="supplier-mobile-row"]')
        ?.parentElement
      const style = card ? getComputedStyle(card) : null
      return { background: style?.backgroundColor, color: style?.color }
    })()`)
    assertLayout(await page.evaluate(
      supplierLayoutAuditExpression({ mobile: true }),
    ), { mobile: true })

    await clickVisibleButton(page, {
      ariaLabel: `供应商操作 · ${finalLegalName}`,
    })
    await page.waitFor(`document.querySelector(
      '[data-testid="supplier-actions-drawer"]',
    )?.getClientRects().length > 0`)
    assertLayout(await page.evaluate(
      supplierLayoutAuditExpression({ mobile: true }),
    ), { mobile: true })
    await pressKey(page, 'Escape')
    await waitForNoVisibleDialog(page, `供应商操作 · ${finalLegalName}`)

    await page.evaluate(`(() => {
      const store = document.querySelector('#app')?.__vue_app__
        ?.config?.globalProperties?.$pinia?._s?.get('appSettings')
      store?.setColorScheme('dark')
    })()`)
    await page.waitFor(`document.documentElement.classList.contains('dark')`)
    const darkTheme = await page.evaluate(`(() => {
      const card = document.querySelector('[data-testid="supplier-mobile-row"]')
        ?.parentElement
      const style = card ? getComputedStyle(card) : null
      return { background: style?.backgroundColor, color: style?.color }
    })()`)
    assert.notEqual(darkTheme.background, lightTheme.background)
    assert.notEqual(darkTheme.color, lightTheme.color)

    await page.connection.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const reducedMotion = await page.evaluate(`(() => {
      const workspace = document.querySelector(
        '[data-testid="supplier-management-page"]',
      )
      const probe = document.createElement('span')
      probe.className = 'animate-pulse'
      workspace?.append(probe)
      const animationName = getComputedStyle(probe).animationName
      probe.remove()
      return {
        animationName,
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      }
    })()`)
    assert.equal(reducedMotion.matches, true)
    assert.equal(reducedMotion.animationName, 'none')
  })

  const runLimitedSession = async ({ credentials, profile, readonly }) => {
    const limitedBrowser = await launchChrome({
      executable: configuration.chromeExecutable,
      userDataDirectory: `${configuration.profileDirectory}-${profile}`,
    })
    t.after(async () => limitedBrowser.close())
    const limitedPage = await limitedBrowser.newPage()
    const limitedRuntime = collectDictionaryRuntimeErrors(limitedPage, {
      sensitiveValues: [credentials.password],
    })
    limitedRuntime.start()
    await limitedPage.setViewport(1280, 800, false)
    await limitedPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(limitedPage, credentials)
    await limitedPage.navigate(appRouteUrl(configuration.baseUrl, managementRoute))

    const management = await limitedPage.evaluate(
      apiExpression('/api/suppliers?page=1&pageSize=20'),
    )
    if (readonly) {
      assert.equal(management.status, 200)
      await waitForAfterAuthentication(limitedPage, `document.querySelector(
        '[data-testid="supplier-management-page"]',
      ) !== null`)
      await waitForSupplierTable(limitedPage, finalLegalName)
      const surface = await limitedPage.evaluate(`(() => {
        const visibleButtons = [...document.querySelectorAll('button')]
          .filter(button => button.getClientRects().length > 0)
        return {
          hasCreate: visibleButtons.some(button =>
            button.textContent?.trim() === '新建供应商'),
          hasMutation: visibleButtons.some(button => ['编辑', '启用', '停用']
            .includes(button.textContent?.trim())),
          hasView: visibleButtons.some(button =>
            button.textContent?.trim() === '查看'),
        }
      })()`)
      assert.deepEqual(surface, {
        hasCreate: false,
        hasMutation: false,
        hasView: true,
      })
      const forbidden = await limitedPage.evaluate(apiExpression(
        '/api/suppliers',
        'POST',
        { entityType: 'ORGANIZATION', legalName: '禁止创建供应商' },
      ))
      assert.equal(forbidden.status, 403)
      assert.equal(forbidden.body?.code, 'FORBIDDEN')

      await clickVisibleButton(limitedPage, {
        ariaLabel: `查看供应商 · ${finalLegalName}`,
      })
      await waitForVisibleDialog(limitedPage, finalLegalName)
      await limitedPage.evaluate(patchPermissionsExpression([]))
      await limitedPage.waitFor(`(() => (
        document.body.innerText.includes('403')
        && document.body.innerText.includes('无权访问该页面')
        && document.querySelector('[data-testid="supplier-management-page"]') === null
        && ![...document.querySelectorAll('[role="dialog"]')].some(dialog =>
          dialog.getClientRects().length > 0)
      ))()`)
    }
    else {
      assert.equal(management.status, 403)
      assert.equal(management.body?.code, 'FORBIDDEN')
      await limitedPage.waitFor(`(() => (
        location.hash === '#${managementRoute}'
        && document.body.innerText.includes('403')
        && document.body.innerText.includes('无权访问该页面')
        && document.querySelector('[data-testid="supplier-management-page"]') === null
      ))()`)
    }
    limitedRuntime.stop()
    assert.deepEqual(limitedRuntime.issues, [])
  }

  await runSupplierBrowserStep('independent read-only identity', () =>
    runLimitedSession({
      credentials: limitedIdentities.readonly,
      profile: 'suppliers-readonly',
      readonly: true,
    }))
  await runSupplierBrowserStep('independent no-permission identity', () =>
    runLimitedSession({
      credentials: limitedIdentities.noPermission,
      profile: 'suppliers-none',
      readonly: false,
    }))

  runtime.stop()
  assert.deepEqual(runtime.issues, [])
})
