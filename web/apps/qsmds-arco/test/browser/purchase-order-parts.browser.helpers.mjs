import assert from 'node:assert/strict'
import process from 'node:process'
import { saveNumberingScreenshot } from './numbering.browser.helpers.mjs'
import { apiExpression } from './regions.browser.helpers.mjs'

const configurator = '[data-testid="purchase-order-part-configurator"] [data-slot="qs-part-configurator"]'
const markPanel = '[data-testid="purchase-order-shipping-marks-panel"]'

/** 通过正式只读 API 检查永久账本，不能用页面展示值或模拟发号次数替代。 */
export async function readPurchaseShippingMarkLedger(page) {
  const issuances = []
  for (let rulePage = 1; ; rulePage++) {
    const rules = await page.evaluate(apiExpression(`/api/numbering-rules?purpose=SHIPPING_MARK&page=${rulePage}&pageSize=100`))
    assert.equal(rules.status, 200, '真实测试身份必须具备发号规则读取权限')
    for (const rule of rules.body.items) {
      for (let issuancePage = 1; ; issuancePage++) {
        const ledger = await page.evaluate(apiExpression(`/api/numbering-rules/${encodeURIComponent(rule.id)}/issuances?page=${issuancePage}&pageSize=100`))
        assert.equal(ledger.status, 200, '真实测试身份必须具备派发记录读取权限')
        issuances.push(...ledger.body.items.map(item => ({ ...item, ruleId: rule.id })))
        if (issuancePage * 100 >= ledger.body.total) {
          break
        }
      }
    }
    if (rulePage * 100 >= rules.body.total) {
      break
    }
  }
  return issuances.sort((left, right) => left.id.localeCompare(right.id))
}

export async function waitForPurchasePartCount(page, count) {
  await page.waitFor(`document.querySelector(${JSON.stringify(configurator)})?.querySelectorAll('[data-slot="part-card"]').length === ${count}`)
}

/** 单产品采购场景使用组件公开控件，不读取或修改 Vue 内部草稿。 */
export async function createFirstProductPart(page, quantity) {
  const before = await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelectorAll('[data-slot="part-card"]').length`)
  await page.waitFor(`(() => {
    const input = document.querySelector(${JSON.stringify(configurator)})?.querySelector('[data-slot="part-product"] input[data-part-quantity]')
    return input instanceof HTMLInputElement && !input.disabled && input.getClientRects().length > 0
  })()`)
  await page.evaluate(`(() => {
    const product = document.querySelector(${JSON.stringify(configurator)}).querySelector('[data-slot="part-product"]')
    const input = product.querySelector('input[data-part-quantity]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(quantity))})
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const checkbox = product.querySelector('[role="checkbox"]')
    if (checkbox.getAttribute('aria-checked') !== 'true') checkbox.click()
  })()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(configurator)})?.querySelector('button[data-action="create-part"]')?.disabled === false`)
  await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelector('button[data-action="create-part"]').click()`)
  await waitForPurchasePartCount(page, before + 1)
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelector('[data-slot="part-card"] button[aria-expanded]').getAttribute('aria-expanded')`), 'false')
}

export async function removePurchasePart(page, index) {
  const before = await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelectorAll('[data-slot="part-card"]').length`)
  await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelectorAll('[data-slot="part-card"]')[${index}].querySelector('button[aria-label^="删除货件-"]').click()`)
  await waitForPurchasePartCount(page, before - 1)
}

export async function removeFirstPurchasePartItem(page) {
  await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelector('[data-slot="part-card"] button[aria-expanded]').click()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(configurator)})?.querySelector('button[aria-label^="从货件-01移除"]')?.getClientRects().length > 0`)
  await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelector('button[aria-label^="从货件-01移除"]').click()`)
  await waitForPurchasePartCount(page, 0)
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).querySelector('input[data-part-quantity]').disabled`), false)
}

/** 通过组件库的真实控件合并不同产品，DOM 仅用于定位和读值，不注入组件内部状态。 */
export async function assertPartConfiguratorMergeShowcase(page) {
  const rootSelector = 'section[aria-label="货件配置器示例"] [data-slot="qs-part-configurator"]'
  const root = `document.querySelector(${JSON.stringify(rootSelector)})`
  const productSelector = key => `${rootSelector} [data-slot="part-product"][data-product-key="${key}"]`
  const products = [
    { key: 'fixture-part-product-a', name: '城市旅行收纳包 A', quantity: 2 },
    { key: 'fixture-part-product-b', name: '本单防潮包装 B', quantity: 3 },
  ]
  const card = `${root}.querySelector('[data-slot="part-card"]')`
  const create = `${root}.querySelector('button[data-action="create-part"]')`
  await page.waitFor(`${root}?.getClientRects().length > 0
    && ${root}.querySelectorAll('[data-slot="part-product"]').length === 2
    && ${root}.querySelectorAll('[data-slot="part-card"]').length === 0`)
  assert.equal(await page.evaluate(`${create}.disabled`), true, '未选中产品时不能创建货件')

  for (const product of products) {
    const productRoot = `document.querySelector(${JSON.stringify(productSelector(product.key))})`
    const input = `${productRoot}.querySelector('input[data-part-quantity]')`
    const checkbox = `${productRoot}.querySelector('[role="checkbox"]')`
    await page.waitFor(`${input} instanceof HTMLInputElement && !${input}.disabled`)
    assert.equal(await page.evaluate(`${input}.getAttribute('aria-label')`), `${product.name} 本次装入数量`)
    await activateControl(page, input, false)
    // 原生选择文本后交给 Chrome 插入，触发实际 FaInput 的输入事件与组件校验。
    await page.evaluate(`${input}.select()`)
    await page.connection.send('Input.insertText', { text: String(product.quantity) })
    await page.waitFor(`${input}.value === ${JSON.stringify(String(product.quantity))}`)
    await activateControl(page, checkbox, false)
    await page.waitFor(`${checkbox}.getAttribute('aria-checked') === 'true'`)
  }
  await page.waitFor(`${create}.disabled === false`)
  await activateControl(page, create, false)
  await page.waitFor(`${root}.querySelectorAll('[data-slot="part-card"]').length === 1
    && document.querySelector(${JSON.stringify(productSelector(products[1].key))}) === null`)
  const key = await page.evaluate(`${card}.getAttribute('data-part-key')`)
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  assert.equal(await page.evaluate(`${card}.querySelector('button[aria-expanded]').getAttribute('aria-expanded')`), 'false')
  assert.equal(await page.evaluate(`${card}.textContent.includes('2 种产品 · 数量 5')`), true)
  await activateControl(page, `${card}.querySelector('button[aria-expanded]')`, false)
  await page.waitFor(`${card}.querySelectorAll('button[aria-label^="从货件-01移除"]').length === 2
    && [...${card}.querySelectorAll('button[aria-label^="从货件-01移除"]')].every(button => button.getClientRects().length > 0)`)

  const readItems = () => page.evaluate(`(() => {
    const card = ${card}
    return [...card.querySelectorAll('button[aria-label^="从货件-01移除"]')].map(button => {
      const row = button.parentElement
      const label = [...row.querySelectorAll('p')].find(item => item.textContent.trim() === '已装入数量')
      return { name: button.getAttribute('aria-label').replace('从货件-01移除', ''),
        nameVisible: row.getClientRects().length > 0
          && row.textContent.includes(button.getAttribute('aria-label').replace('从货件-01移除', '')),
        quantity: Number(label?.nextElementSibling?.textContent.trim()) }
    })
  })()`)
  const readPending = () => page.evaluate(`(() => {
    return [...${root}.querySelectorAll('[data-slot="part-product"]')].map(product => {
      const label = [...product.querySelectorAll('p')].find(item => item.textContent.trim() === '剩余数量')
      return { key: product.getAttribute('data-product-key'),
        remaining: Number(label?.nextElementSibling?.textContent.trim()),
        draft: product.querySelector('input[data-part-quantity]').value }
    })
  })()`)
  assert.deepEqual(await readItems(), products.map(({ name, quantity }) => ({ name, nameVisible: true, quantity })))
  assert.deepEqual(await readPending(), [{ key: products[0].key, remaining: 3, draft: '3' }])
  await saveNumberingScreenshot(page, 'purchase-parts-merge-showcase')

  const removeLabel = `从货件-01移除${products[1].name}`
  await activateControl(page, `${card}.querySelector(${JSON.stringify(`button[aria-label="${removeLabel}"]`)})`, false)
  await page.waitFor(`${card}.querySelectorAll('button[aria-label^="从货件-01移除"]').length === 1
    && ${root}.querySelectorAll('[data-slot="part-product"]').length === 2`)
  assert.equal(await page.evaluate(`${root}.querySelectorAll('[data-slot="part-card"]').length`), 1, '移除 B 不得删除仍装有 A 的货件')
  assert.equal(await page.evaluate(`${card}.getAttribute('data-part-key')`), key, '移除单项必须保留货件身份')
  assert.deepEqual(await readItems(), [{ name: products[0].name, nameVisible: true, quantity: 2 }])
  assert.deepEqual(await readPending(), [
    { key: products[0].key, remaining: 3, draft: '3' },
    { key: products[1].key, remaining: 3, draft: '3' },
  ])
  assert.equal(await page.evaluate(`${card}.textContent.includes('1 种产品 · 数量 2')`), true)
  await saveNumberingScreenshot(page, 'purchase-parts-merge-item-removed')
}

async function setAppearance(page, theme, mobile = false) {
  await page.setViewport(mobile ? 390 : 1440, mobile ? 844 : 900, mobile)
  await page.connection.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme(${JSON.stringify(theme)})`)
  await page.waitFor(`document.documentElement.classList.contains('dark') === ${theme === 'dark'}`)
}

export async function assertPurchasePartConfiguratorAppearance(page) {
  for (const [theme, mobile] of [['light', false], ['dark', false], ['dark', true]]) {
    await setAppearance(page, theme, mobile)
    await page.evaluate(`document.querySelector(${JSON.stringify(configurator)}).scrollIntoView({ block: 'start' })`)
    await page.waitFor(`(() => {
      const root = document.querySelector(${JSON.stringify(configurator)})
      const rect = root.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth + 1 && root.scrollWidth <= root.clientWidth + 1
        && root.querySelectorAll('[data-slot="part-card"]').length === 2
        && [...root.querySelectorAll('[data-slot="part-card"] button[aria-expanded]')].every(button => button.getAttribute('aria-expanded') === 'false')
    })()`)
    await saveNumberingScreenshot(page, `purchase-parts-configurator-${mobile ? 'mobile' : theme}`)
  }
  await setAppearance(page, 'light')
}

/** 先确认真实命中区域，再派发鼠标或触控事件；不用 DOM.click 代替触控验收。 */
async function activateControl(page, expression, mobile) {
  await page.bringToFront()
  try {
    // 表格右侧操作列使用 sticky；nearest 只保证进入滚动容器，不会避让固定列覆盖。
    // 居中滚动后仍须通过真实命中检查，不能用程序化 click 绕过遮挡。
    await page.waitFor(`(async () => {
      const element = ${expression}
      if (!(element instanceof HTMLElement) || !element.isConnected) return false
      // 桌面切换卡片列表会异步重排并恢复焦点；每轮重新定位，只在最终位置派发一次点击。
      element.scrollIntoView({ block: 'center', inline: 'center' })
      const before = element.getBoundingClientRect()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const after = element.getBoundingClientRect()
      return element === ${expression} && element.isConnected
        && before.x === after.x && before.y === after.y
        && before.width === after.width && before.height === after.height
        && element.contains(document.elementFromPoint(after.x + after.width / 2, after.y + after.height / 2))
    })()`)
  }
  catch (error) {
    // 只采集结构标识和几何值，不输出表达式、文本、订单号、唛头或表单内容。
    try {
      const diagnostic = await page.evaluate(`(() => {
        const element = ${expression}
        const describe = node => {
          if (!(node instanceof Element)) return null
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return { tag: node.tagName, slot: node.getAttribute('data-slot'), testId: node.getAttribute('data-testid'),
            pinned: node.getAttribute('data-pinned'), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            position: style.position, zIndex: style.zIndex, pointerEvents: style.pointerEvents,
            display: style.display, visibility: style.visibility, opacity: style.opacity }
        }
        const rect = element?.getBoundingClientRect()
        const center = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null
        const hit = center ? document.elementFromPoint(center.x, center.y) : null
        const container = element?.closest('[data-slot="table-container"]')
        return { mobile: ${Boolean(mobile)}, viewport: { width: innerWidth, height: innerHeight },
          element: describe(element), center, hit: describe(hit), hitParent: describe(hit?.parentElement),
          actualHit: Boolean(element && hit && element.contains(hit)),
          table: container ? { ...describe(container), scrollLeft: container.scrollLeft, scrollTop: container.scrollTop,
            scrollWidth: container.scrollWidth, clientWidth: container.clientWidth } : null,
          pinnedCells: [...(element?.closest('tr')?.querySelectorAll('[data-pinned]') ?? [])].map(describe) }
      })()`)
      process.stdout.write(`[numbering-browser] purchase control hit-test failed: ${JSON.stringify(diagnostic)}\n`)
    }
    catch {
      process.stdout.write('[numbering-browser] purchase control hit-test diagnostic unavailable\n')
    }
    try {
      await saveNumberingScreenshot(page, 'purchase-control-hit-test-failed')
    }
    catch {
      process.stdout.write('[numbering-browser] purchase control hit-test screenshot unavailable\n')
    }
    throw error
  }
  const point = await page.evaluate(`(() => {
    const rect = ${expression}.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)
  if (mobile) {
    await page.connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0, radiusX: 1, radiusY: 1, force: 1 }] })
    await page.connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  else {
    await page.connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 })
    await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 })
  }
}

async function escapePopover(page) {
  const pressEscape = async () => {
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  }
  // 复制按钮的 Tooltip 退场时仍短暂占据最顶层；等真实卸载后再验证一次 Escape
  // 关闭 Popover，避免把动画期间的键盘事件误当成父浮层关闭失败。
  await page.waitFor(`![...document.querySelectorAll('[data-slot="tooltip-content"][data-state="closed"]')].some(tooltip => tooltip.isConnected)`)
  // 键盘打开时首个复制按钮自动获得焦点并显示 Tooltip；按真实浮层层级先关闭
  // 提示并断言父层保留，再单次关闭父层。不以无条件重复按键掩盖关闭失败。
  if (await page.evaluate(`!!document.querySelector('[data-slot="tooltip-content"]:not([data-state="closed"])')?.getClientRects().length`)) {
    await pressEscape()
    await page.waitFor(`document.querySelector('[data-slot="tooltip-content"]') === null`)
    assert.equal(await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(markPanel)})].some(panel => panel.getClientRects().length > 0)`), true)
  }
  await pressEscape()
  await page.waitFor(`![...document.querySelectorAll(${JSON.stringify(markPanel)})].some(panel => panel.getClientRects().length > 0)`)
}

export async function assertPurchaseShippingMarksInteraction(page, order) {
  const origin = await page.evaluate('location.origin')
  await page.connection.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  const trigger = `([...document.querySelectorAll('[data-testid="purchase-order-shipping-marks-trigger"]')].find(button => button.getClientRects().length > 0 && button.textContent.includes(${JSON.stringify(order.shippingMarkText)})))`
  const panel = `(document.querySelector(${JSON.stringify(markPanel)}))`
  for (const [theme, mobile] of [['light', false], ['dark', false], ['dark', true]]) {
    await setAppearance(page, theme, mobile)
    await page.waitFor(`${trigger} !== undefined`)
    assert.equal(await page.evaluate(`${trigger}.textContent.includes('2 个货件')`), true)
    await activateControl(page, trigger, mobile)
    await page.waitFor(`${panel}?.getClientRects().length > 0`)
    await page.waitFor(`(async () => {
      const root = ${panel}
      const popup = root?.closest('[data-slot="popover-content"]')
      if (!popup || popup.getAttribute('data-state') !== 'open') return false
      // 浮层有 fade/zoom 入场动画；尺寸存在不代表画面已稳定，截图前检查真实动画和祖先透明度。
      for (let layer = root; layer; layer = layer.parentElement) {
        const style = getComputedStyle(layer)
        if (Number(style.opacity) !== 1 || style.visibility === 'hidden' || style.display === 'none'
          || layer.getAnimations().some(animation => animation.pending || animation.playState === 'running')) return false
      }
      const before = popup.getBoundingClientRect()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const after = popup.getBoundingClientRect()
      const rect = root.getBoundingClientRect()
      return before.x === after.x && before.y === after.y
        && before.width === after.width && before.height === after.height
        && Number(getComputedStyle(popup).opacity) === 1
        && rect.left >= 0 && rect.right <= innerWidth + 1 && root.scrollWidth <= root.clientWidth + 1
        && [...root.querySelectorAll('li')].length === ${order.shippingMarks.length}
        && ${JSON.stringify(order.shippingMarks)}.every(mark => root.textContent.includes(mark))
    })()`)
    await saveNumberingScreenshot(page, `purchase-shipping-marks-list-${mobile ? 'mobile' : theme}`)
    const copyBase = `${panel}.querySelector('button[aria-label="复制基础唛头"]')`
    await activateControl(page, copyBase, mobile)
    await page.waitFor(`navigator.clipboard.readText().then(value => value === ${JSON.stringify(order.shippingMarkText)})`)
    const copyOne = `${panel}.querySelectorAll('li')[1].querySelector('button')`
    await activateControl(page, copyOne, mobile)
    await page.waitFor(`navigator.clipboard.readText().then(value => value === ${JSON.stringify(order.shippingMarks[1])})`)
    const copyAll = `([...${panel}.querySelectorAll('button')].find(button => button.textContent.trim() === '复制全部'))`
    await activateControl(page, copyAll, mobile)
    await page.waitFor(`navigator.clipboard.readText().then(value => value === ${JSON.stringify(order.shippingMarks.join('\n'))})`)
    await escapePopover(page)
  }
  await setAppearance(page, 'light')
  await page.evaluate(`${trigger}.focus()`)
  await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', nativeVirtualKeyCode: 13, windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', nativeVirtualKeyCode: 13, windowsVirtualKeyCode: 13 })
  await page.waitFor(`${panel}?.getClientRects().length > 0 && ${panel}.contains(document.activeElement)`)
  await escapePopover(page)
  await page.waitFor(`document.activeElement === ${trigger}`)
}

export async function assertPurchasePartDetail(page, detail, screenshots = false) {
  const section = '[data-testid="purchase-order-detail-drawer"] [data-slot="purchase-order-drawer-parts"]'
  await page.waitFor(`document.querySelector(${JSON.stringify(section)})?.querySelectorAll('article[data-part-number]').length === ${detail.parts.length}`)
  assert.equal(await page.evaluate(`[...document.querySelector(${JSON.stringify(section)}).querySelectorAll('button[aria-expanded]')].every(button => button.getAttribute('aria-expanded') === 'false')`), true)
  for (const part of detail.parts) {
    const article = `document.querySelector(${JSON.stringify(`${section} article[data-part-number="${part.partNumber}"]`)})`
    await page.evaluate(`${article}.querySelector('button[aria-expanded]').click()`)
    await page.waitFor(`${article}.querySelectorAll('li[data-line-number]').length === ${part.items.length}`)
    for (const item of part.items) {
      const line = detail.lines.find(candidate => candidate.id === item.purchaseOrderLineId)
      assert.ok(line)
      await page.waitFor(`(() => {
        const item = ${article}.querySelector('li[data-line-number="${item.lineNumber}"]')
        return item?.getClientRects().length > 0
          && item.textContent.includes(${JSON.stringify(line.productName)})
          && item.textContent.includes(${JSON.stringify(line.productNo ?? '临时产品')})
          && item.querySelector('[data-part-quantity]')?.textContent.trim() === ${JSON.stringify(String(item.quantity))}
          && item.querySelector('[data-currency]') === null
      })()`)
      if (detail.lineSummary.previews.find(preview => preview.lineId === line.id)?.mainImage) {
        await page.waitFor(`(() => {
          const image = ${article}.querySelector('li[data-line-number="${item.lineNumber}"] img')
          return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
            && image.src.includes('/api/purchase-orders/${detail.id}/lines/')
        })()`)
      }
    }
    assert.equal(await page.evaluate(`${article}.textContent.includes(${JSON.stringify(part.shippingMarkText ?? '待审核生成')})`), true)
    if (part.shippingMarkText === null) {
      assert.equal(await page.evaluate(`${article}.querySelector('button[aria-label*="复制"]') === null`), true)
    }
  }
  if (screenshots) {
    for (const [theme, mobile] of [['light', false], ['dark', false], ['dark', true]]) {
      await setAppearance(page, theme, mobile)
      await page.evaluate(`document.querySelector(${JSON.stringify(section)}).scrollIntoView({ block: 'center' })`)
      if (mobile) {
        const firstTrigger = `document.querySelector(${JSON.stringify(section)}).querySelector('button[aria-expanded]')`
        if (await page.evaluate(`${firstTrigger}.getAttribute('aria-expanded') === 'true'`)) {
          await activateControl(page, firstTrigger, true)
          await page.waitFor(`${firstTrigger}.getAttribute('aria-expanded') === 'false'`)
        }
        await activateControl(page, firstTrigger, true)
        await page.waitFor(`${firstTrigger}.getAttribute('aria-expanded') === 'true'`)
      }
      await page.waitFor(`(() => {
        const root = document.querySelector(${JSON.stringify(section)})
        const rect = root.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth + 1 && root.scrollWidth <= root.clientWidth + 1
      })()`)
      await saveNumberingScreenshot(page, `purchase-parts-detail-${mobile ? 'mobile' : theme}`)
    }
    await setAppearance(page, 'light')
  }
}
