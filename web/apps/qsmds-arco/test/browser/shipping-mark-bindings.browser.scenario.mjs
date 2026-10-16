import assert from 'node:assert/strict'
import { clickVisibleButton, patchNumberingPermissionsExpression, restoreNumberingPermissionsExpression, saveNumberingScreenshot } from './numbering.browser.helpers.mjs'
import { apiExpression, appRouteUrl } from './regions.browser.helpers.mjs'

const endpoint = '/api/purchase-shipping-mark-bindings'
const route = '/admin/basic-data/numbering/shipping-mark-bindings'
const supplierValue = 'BROWSER_MARK_A'

/** 数据仅经隔离 Browser 编排器的正式 API 创建，不接触开发业务库。 */
export async function verifyShippingMarkBindings(page, configuration) {
  async function request(path, method = 'GET', body, expected = 200) {
    const result = await page.evaluate(apiExpression(path, method, body))
    assert.equal(result.status, expected, JSON.stringify({ path, code: result.body?.code, status: result.status }))
    return result.body
  }
  async function colorScheme(value) {
    await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme('${value}')`)
    await page.waitFor(`document.documentElement.classList.contains('dark') === ${value === 'dark'}`)
  }
  await colorScheme('light')
  const types = await request('/api/dictionary-types?query=service_provider.supplier&page=1&pageSize=20')
  let type = types.items.find(item => item.code === 'service_provider.supplier')
  type ??= await request('/api/dictionary-types', 'POST', { code: 'service_provider.supplier', name: '供应商', sortOrder: 0 }, 201)
  for (const [value, label] of [[supplierValue, '微耕机供应商'], ['BROWSER_MARK_B', '第二供应商']]) {
    const item = await request(`/api/dictionary-types/${type.id}/items`, 'POST', { value, label, sortOrder: 0 }, 201)
    if (!item.enabled) {
      await request(`/api/dictionary-types/${type.id}/items/${item.id}/enable`, 'POST', { expectedVersion: item.version })
    }
  }
  type = await request(`/api/dictionary-types/${type.id}`)
  if (!type.enabled) {
    await request(`/api/dictionary-types/${type.id}/enable`, 'POST', { expectedVersion: type.version })
  }
  /**
   * 共享 bootstrap 会种下同码唛头夹具规则（CUSTOM_MARK 等），再创建必然 409。
   * 已有规则只校验可用性后复用，夹具状态漂移时以断言失败暴露，不静默吞掉。
   */
  async function rule(code, name) {
    const listing = await request(`/api/numbering-rules?page=1&pageSize=100&keyword=${encodeURIComponent(code)}`)
    const existing = listing.items.find(item => item.ruleCode === code)
    if (existing) {
      assert.equal(existing.purpose, 'SHIPPING_MARK', `既有规则 ${code} 必须是唛头用途`)
      assert.equal(existing.status, 'ENABLED', `既有规则 ${code} 必须已启用`)
      assert.notEqual(existing.activeRevision, null, `既有规则 ${code} 必须有生效版本`)
      return existing
    }
    const draft = await request('/api/numbering-rules', 'POST', {
      ruleCode: code,
      name,
      purpose: 'SHIPPING_MARK',
      resetPolicy: 'NEVER',
      segments: [{ type: 'SEQUENCE', width: 4, startValue: '1', step: '1' }],
    }, 201)
    const published = await request(`/api/numbering-rules/${draft.id}/publish`, 'POST', { expectedVersion: draft.version, draftRevision: 1 })
    return request(`/api/numbering-rules/${draft.id}/enable`, 'POST', { expectedVersion: published.version })
  }
  const primary = await rule('BROWSER_WGJ_MARK', '微耕机唛头')
  const custom = await rule('CUSTOM_MARK', '自定义产品唛头')

  await page.setViewport(1440, 1000, false)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/admin/basic-data/numbering'))
  await page.waitFor('!!document.querySelector("[data-testid=shipping-mark-bindings-entry]")')
  await page.evaluate('document.querySelector("[data-testid=shipping-mark-bindings-entry]").click()')
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-bindings-page]")?.textContent.includes("微耕机供应商")')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=shipping-mark-custom-rule]").textContent.includes("可用")'), true)

  async function edit() {
    await page.waitFor(`(() => [...document.querySelectorAll('tr, [data-slot="qs-generic-table-mobile-card"]')].some(row => row.textContent.includes('${supplierValue}')))()`)
    const clicked = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('tr')].find(row => row.getClientRects().length && row.textContent.includes('${supplierValue}'))
      const button = [...(row?.querySelectorAll('button') ?? [])].find(button => /设置规则|更换规则/.test(button.textContent))
      button?.click()
      return !!button
    })()`)
    assert.equal(clicked, true, 'Binding action slot must expose the editable row')
    await page.waitFor('!!document.querySelector("[data-testid=shipping-mark-binding-editor]")')
  }
  async function choose(code) {
    await page.waitFor('!!document.querySelector("[data-testid=shipping-mark-rule-picker] .arco-select-view")')
    await page.evaluate('document.querySelector("[data-testid=shipping-mark-rule-picker] .arco-select-view").click()')
    await page.waitFor(`(() => [...document.querySelectorAll('.arco-select-option')].some(option => option.getClientRects().length && option.textContent.includes('${code}')))()`)
    await page.evaluate(`(() => [...document.querySelectorAll('.arco-select-option')].find(option => option.getClientRects().length && option.textContent.includes('${code}')).click())()`)
    await page.waitFor(`(() => ![...document.querySelectorAll('.arco-select-dropdown')].some(dropdown => dropdown.getClientRects().length && Number(getComputedStyle(dropdown).opacity) > 0))()`)
  }
  await edit()
  await choose('BROWSER_WGJ_MARK')
  await saveNumberingScreenshot(page, 'shipping-mark-binding-desktop-edit')
  await clickVisibleButton(page, '保存绑定')
  await page.waitFor('!document.querySelector("[data-testid=shipping-mark-binding-editor]")')
  const saved = (await request(`${endpoint}?keyword=${supplierValue}`)).items[0]
  assert.equal(saved.rule.id, primary.id)
  assert.equal(saved.version, 1)

  // 第二客户端先改绑；旧页面不能覆盖新版本，读取后仍需要用户再次点击保存。
  await edit()
  await choose('CUSTOM_MARK')
  await request(`${endpoint}/${supplierValue}`, 'PUT', { ruleId: custom.id, expectedVersion: 1 })
  await clickVisibleButton(page, '保存绑定')
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-binding-editor]")?.textContent.includes("读取最新绑定")')
  assert.equal(await page.evaluate(`(() => [...document.querySelectorAll('[data-testid=shipping-mark-binding-editor] button')].find(button => button.textContent.includes('保存绑定')).disabled)()`), true)
  await clickVisibleButton(page, '读取最新绑定')
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-binding-editor]")?.textContent.includes("已读取最新绑定")')
  await choose('BROWSER_WGJ_MARK')
  await clickVisibleButton(page, '保存绑定')
  await page.waitFor('!document.querySelector("[data-testid=shipping-mark-binding-editor]")')
  assert.equal((await request(`${endpoint}?keyword=${supplierValue}`)).items[0].version, 3)

  await edit()
  await choose('CUSTOM_MARK')
  await clickVisibleButton(page, '返回编号管理')
  await page.waitFor('document.body.innerText.includes("放弃未保存的选择")')
  await clickVisibleButton(page, '继续编辑')
  assert.equal(await page.evaluate('location.hash.endsWith("shipping-mark-bindings")'), true)
  await clickVisibleButton(page, '取消')
  await clickVisibleButton(page, '放弃选择')
  await page.waitFor('!document.querySelector("[data-testid=shipping-mark-binding-editor]")')

  // 撤掉写权限的前端上下文应立即隐藏操作；真实 Server 403 在独立集成测试覆盖。
  // 管理员工作台由独立准入码收敛，动态撤权后的权限快照仍要保留它在页面上。
  await page.evaluate(patchNumberingPermissionsExpression([
    'purchase-shipping-marks:read',
    'numbering-rules:read',
    'workbench:admin',
  ]))
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-bindings-page]")?.textContent.includes("只读")')
  assert.equal(await page.evaluate(`(() => [...document.querySelectorAll('[data-testid=shipping-mark-bindings-page] button')].some(button => /设置规则|更换规则/.test(button.textContent)))()`), false)
  await page.evaluate(restoreNumberingPermissionsExpression())

  await page.setViewport(390, 844, true)
  await page.navigate(appRouteUrl(configuration.baseUrl, route))
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-bindings-page]")?.textContent.includes("微耕机供应商")')
  // 应用从桌面切至窄屏会先折叠侧栏；布局收敛后再断言卡片，避免把动画中间帧当最终宽度。
  await page.waitFor('document.querySelector("[data-testid=shipping-mark-bindings-page] .qs-generic-table")?.clientWidth >= 300')
  await clickVisibleButton(page, '更换规则')
  await page.waitFor('!!document.querySelector("[data-testid=shipping-mark-binding-editor]")')
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true)
  const inside = await page.evaluate(`(() => {
    const table = document.querySelector('[data-testid=shipping-mark-bindings-page] .qs-generic-table')
    const card = table.querySelector('[aria-busy] > div')
    return {
      fits: card.getBoundingClientRect().right <= table.getBoundingClientRect().right + 1
        && card.scrollWidth <= card.clientWidth + 1,
      tableWidth: table.clientWidth,
      cardWidth: card.clientWidth,
      cardScrollWidth: card.scrollWidth,
      overflowing: [...card.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > table.getBoundingClientRect().right + 1).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })),
    }
  })()`)
  assert.equal(inside.fits, true, `Mobile binding card must not clip its controls: ${JSON.stringify(inside)}`)
  await page.evaluate('document.querySelector("[data-testid=shipping-mark-binding-editor]").scrollIntoView({block:"center"})')
  await saveNumberingScreenshot(page, 'shipping-mark-binding-mobile-edit')
  await colorScheme('dark')
  await saveNumberingScreenshot(page, 'shipping-mark-binding-mobile-dark')
  await colorScheme('light')
  await clickVisibleButton(page, '取消')
}
