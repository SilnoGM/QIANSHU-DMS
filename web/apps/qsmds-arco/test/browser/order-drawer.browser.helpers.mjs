/**
 * FaTabs/Reka 在 mousedown、键盘或焦点事件中激活页签，HTMLElement.click()
 * 只派发 click，不能代表鼠标操作。这里仅服务于订单抽屉回归，使用真实指针事件；
 * 不修改 Vue 状态、不放宽 aria-selected 断言，也不靠固定延时或重复点击掩盖失败。
 */
export async function clickOrderDrawerTab(page, drawerTestId, label) {
  const source = `(() => {
    const drawer = document.querySelector(
      '[data-testid=${JSON.stringify(drawerTestId)}]',
    )
    if (!drawer || drawer.getClientRects().length === 0) return null
    return [...drawer.querySelectorAll('[role="tab"]')].find(tab => (
      tab.textContent?.trim() === ${JSON.stringify(label)}
      && tab.getClientRects().length > 0
      && !tab.disabled
    )) ?? null
  })()`
  await page.bringToFront()
  await page.waitFor(`${source} !== null`)
  await page.evaluate(`${source}.scrollIntoView({ block: 'nearest', inline: 'nearest' })`)
  // 抽屉仍在过渡时元素虽有尺寸，却可能不在最终点击位置；只在位置稳定且可命中时操作。
  await page.waitFor(`(async () => {
    const tab = ${source}
    if (!tab) return false
    const before = tab.getBoundingClientRect()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const after = tab.getBoundingClientRect()
    const target = document.elementFromPoint(
      after.left + after.width / 2, after.top + after.height / 2,
    )
    return before.left === after.left && before.top === after.top
      && before.width === after.width && before.height === after.height
      && target !== null && tab.contains(target)
  })()`)
  const point = await page.evaluate(`(() => {
    const rect = ${source}.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await page.connection.send('Input.dispatchMouseEvent', {
    ...point,
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    ...point,
    type: 'mousePressed',
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    ...point,
    type: 'mouseReleased',
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  })
  // 同时验证页签语义和实际关联面板，避免仅颜色变化或隐藏副本令测试误通过。
  await page.waitFor(`(() => {
    const tab = ${source}
    const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '')
    return tab?.getAttribute('aria-selected') === 'true'
      && tab.getAttribute('data-state') === 'active'
      && panel?.getAttribute('role') === 'tabpanel'
      && panel.getClientRects().length > 0
  })()`)
}
