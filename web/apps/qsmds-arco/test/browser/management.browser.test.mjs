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
    || Array.from(password).length < 15
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
    button.click()
    return true
  })()`)
}

/** 只在当前可见 Modal 中点击按钮，防止页面标题区同名按钮抢先命中。 */
async function clickVisibleModalButton(page, text) {
  const serializedText = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-modal')].some((modal) => (
    modal.getClientRects().length > 0
    && [...modal.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === ${serializedText}
      && button.getClientRects().length > 0
      && !button.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const modal = [...document.querySelectorAll('.arco-modal')]
      .find(candidate => candidate.getClientRects().length > 0)
    const button = [...(modal?.querySelectorAll('button') ?? [])].find(candidate => (
      candidate.textContent?.trim() === ${serializedText}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('modal button unavailable')
    button.click()
    return true
  })()`)
}

/**
 * 通过原生 value setter 驱动 Vue 的 input 事件；限定可见 Modal 后，测试不会
 * 误填页面筛选框或已进入离场动画的旧弹窗。
 */
async function fillVisibleModalControl(page, selector, value) {
  const serializedSelector = JSON.stringify(selector)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-modal')].some((modal) => (
    modal.getClientRects().length > 0
    && [...modal.querySelectorAll(${serializedSelector})].some(control => (
      control.getClientRects().length > 0
      && !control.disabled
    ))
  )))()`)
  await page.evaluate(`(() => {
    const modal = [...document.querySelectorAll('.arco-modal')]
      .find(candidate => candidate.getClientRects().length > 0)
    const control = [...(modal?.querySelectorAll(${serializedSelector}) ?? [])]
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

async function waitForNoVisibleModal(page) {
  await page.waitFor(`![...document.querySelectorAll('.arco-modal')]
    .some(modal => modal.getClientRects().length > 0)`)
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

async function selectVisibleModalOption(page, text) {
  const serializedText = JSON.stringify(text)
  await page.evaluate(`(() => {
    const modal = [...document.querySelectorAll('.arco-modal')]
      .find(candidate => candidate.getClientRects().length > 0)
    const select = [...(modal?.querySelectorAll('.arco-select-view') ?? [])]
      .find(candidate => candidate.getClientRects().length > 0)
    if (!select) throw new Error('modal select unavailable')
    select.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-select-option')].some(option => (
    option.textContent?.trim() === ${serializedText}
    && option.getClientRects().length > 0
    && option.getAttribute('aria-disabled') !== 'true'
  )))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('.arco-select-option')].find(candidate => (
      candidate.textContent?.trim() === ${serializedText}
      && candidate.getClientRects().length > 0
      && candidate.getAttribute('aria-disabled') !== 'true'
    ))
    if (!option) throw new Error('select option unavailable')
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
  const managedUsername = 'browser_ui_managed'
  const managedInitialPassword = `${configuration.password}-UiInitial6`
  const managedResetPassword = `${configuration.password}-UiReset5`
  const roleCode = 'browser_ui_role'
  const initialRoleName = 'Browser UI Role'
  const editedRoleName = 'Browser UI Operator'
  const editedDisplayName = 'Browser UI Managed Edited'
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    // 独立 Profile 让本场景不依赖上一场景最终留下的 Cookie 状态。
    userDataDirectory: `${configuration.profileDirectory}-management`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  // 角色编辑先验证桌面表格；Chrome 默认视口可能落入移动端断点，只渲染卡片。
  await page.setViewport(1280, 800, false)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await waitForAuthState(page, 'anonymous')
  await loginThroughUi(page, configuration)

  // 测试目标用户由受保护 API 准备；本场景关注的是管理员后续每项 UI 管理操作。
  const createdUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser UI Managed',
    mustChangePassword: false,
    password: managedInitialPassword,
    username: managedUsername,
  }))
  assert.equal(createdUser.status, 201)
  assert.equal(createdUser.body?.username, managedUsername)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/roles'))
  await page.waitFor(`(() => (
    document.body.innerText.includes('角色管理')
    && document.body.innerText.includes('system_admin')
  ))()`)

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
  await waitForNoVisibleModal(page)
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
  await waitForNoVisibleModal(page)
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(editedRoleName)})`)

  rolesResponse = await page.evaluate(apiExpression('/api/roles', 'GET'))
  assert.equal(rolesResponse.status, 200)
  managedRole = rolesResponse.body?.find(role => role.code === roleCode)
  assert.equal(managedRole?.name, editedRoleName)

  // 首期目录全部是 systemOnly：普通角色仍可通过 UI 明确提交空集合，但不能
  // 越权勾选任何系统专用权限。保存动作必须落审计而非前端空操作。
  await clickVisibleTableRowButton(page, roleCode, '分配权限')
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-modal')].some(modal => (
    modal.getClientRects().length > 0
    && modal.textContent?.includes('分配权限')
    && modal.textContent?.includes('users:read')
  )))()`)
  const permissionModalState = await page.evaluate(`(() => {
    const modal = [...document.querySelectorAll('.arco-modal')]
      .find(candidate => candidate.getClientRects().length > 0)
    const options = [...(modal?.querySelectorAll('.permission-option') ?? [])]
    return {
      enabledCheckboxes: [...(modal?.querySelectorAll('input[type="checkbox"]') ?? [])]
        .filter(input => !input.disabled).length,
      optionCount: options.length,
      showsUsersRead: options.some(option => option.textContent?.includes('users:read')),
    }
  })()`)
  assert.equal(permissionModalState.showsUsersRead, true)
  assert.ok(permissionModalState.optionCount > 0)
  assert.equal(permissionModalState.enabledCheckboxes, 0)
  await clickVisibleModalButton(page, '保存权限')
  await waitForNoVisibleModal(page)

  rolesResponse = await page.evaluate(apiExpression('/api/roles', 'GET'))
  managedRole = rolesResponse.body?.find(role => role.code === roleCode)
  assert.equal(rolesResponse.status, 200)
  assert.deepEqual(managedRole?.permissionIds, [])
  assert.equal(typeof managedRole?.id, 'string')

  // 在 390px 真机指标下从用户卡片进入重置密码，验证 Drawer -> Modal 的
  // 关键操作链和弹窗宽度；之后再切回桌面表格完成编辑、角色与状态操作。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/users'))
  await page.waitFor(`document.body.innerText.includes('用户管理')`)
  await fillVisibleInput(page, 'input[placeholder="精确用户名"]', managedUsername)
  await clickVisibleButton(page, '查询')
  await page.waitFor(`(() => [...document.querySelectorAll('.user-card')].some(card => (
    card.textContent?.includes(${JSON.stringify(managedUsername)})
    && card.getClientRects().length > 0
  )))()`)
  await clickVisibleButton(page, '操作')
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`用户操作 · ${managedUsername}`)})`)
  await clickVisibleButton(page, '设置或重置密码')
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-modal')].some(modal => (
    modal.getClientRects().length > 0
    && modal.textContent?.includes('设置或重置密码')
  )))()`)
  const narrowPasswordModal = await page.evaluate(`(() => {
    const modal = [...document.querySelectorAll('.arco-modal')]
      .find(candidate => candidate.getClientRects().length > 0)
    const rect = modal?.getBoundingClientRect()
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
  await waitForNoVisibleModal(page)

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
  await fillVisibleModalControl(
    page,
    'input[placeholder="请输入显示名称"]',
    editedDisplayName,
  )
  await clickVisibleModalButton(page, '保存修改')
  await waitForNoVisibleModal(page)
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(editedDisplayName)})`)

  await clickVisibleTableRowButton(page, managedUsername, '更多')
  await clickVisibleText(page, '分配角色')
  await page.waitFor(`(() => [...document.querySelectorAll('.arco-modal')].some(modal => (
    modal.getClientRects().length > 0
    && modal.textContent?.includes('分配角色')
  )))()`)
  await selectVisibleModalOption(page, editedRoleName)
  await clickVisibleModalButton(page, '替换角色集合')
  await waitForNoVisibleModal(page)

  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.equal(managedUser?.displayName, editedDisplayName)
  assert.deepEqual(managedUser?.roleIds, [managedRole.id])

  await clickVisibleTableRowButton(page, managedUsername, '更多')
  await clickVisibleText(page, '禁用用户')
  await clickVisibleModalButton(page, '确认禁用')
  await waitForNoVisibleModal(page)
  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.equal(managedUser?.status, 'DISABLED')

  await clickVisibleTableRowButton(page, managedUsername, '更多')
  await clickVisibleText(page, '启用用户')
  await clickVisibleModalButton(page, '确认启用')
  await waitForNoVisibleModal(page)
  userResponse = await page.evaluate(apiExpression(
    `/api/users?username=${managedUsername}&page=1&pageSize=20`,
    'GET',
  ))
  managedUser = userResponse.body?.items?.find(user => user.username === managedUsername)
  assert.equal(managedUser?.status, 'ACTIVE')

  // 角色、权限目录和审计都必须在窄屏切换为卡片；卡片边界不得跑出视口。
  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/roles'))
  await waitForCardsInsideViewport(page, '.role-card', editedRoleName)
  assert.equal(await page.evaluate(`(() => (
    [...document.querySelectorAll('.desktop-list')]
      .some(element => element.getClientRects().length > 0)
  ))()`), false)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/permissions'))
  await waitForCardsInsideViewport(page, '.permission-card', 'users:read')
  const narrowPermissionCatalog = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.permission-card')]
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
      viewportWidth: innerWidth,
      visibleTables: [...document.querySelectorAll('.permission-section .desktop-list')]
        .filter(element => element.getClientRects().length > 0).length,
    }
  })()`)
  assert.ok(narrowPermissionCatalog.cardCount > 0)
  assert.equal(
    narrowPermissionCatalog.cardsInsideViewport,
    true,
    JSON.stringify(narrowPermissionCatalog),
  )
  assert.equal(narrowPermissionCatalog.visibleTables, 0)

  await page.navigate(appRouteUrl(configuration.baseUrl, '/system/audit'))
  await waitForCardsInsideViewport(page, '.audit-card')
  const narrowAudit = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.audit-card')]
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
      visibleTables: [...document.querySelectorAll('.desktop-list')]
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
