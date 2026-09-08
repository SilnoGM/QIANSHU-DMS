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
  // 吸顶页签的布局框不代表实际可点击区域；展开长记录后先归零当前抽屉正文，
  // 与抽屉切换页签时的滚动行为保持一致，避免 scrollIntoView 连带移动背景页面。
  await page.evaluate(`document.querySelector(
    '[data-testid=${JSON.stringify(drawerTestId)}]',
  ).parentElement.scrollTo({ top: 0, behavior: 'instant' })`)
  // 抽屉仍在过渡时元素虽有尺寸，却可能不在最终点击位置；只在位置稳定且可命中时操作。
  try {
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
  }
  catch (cause) {
    // 只输出几何与节点类型，不输出订单内容、凭据或整页 HTML。
    const geometry = await page.evaluate(`(() => {
      const tab = ${source}
      const body = document.querySelector('[data-testid=${JSON.stringify(drawerTestId)}]')?.parentElement
      const rect = tab?.getBoundingClientRect()
      const target = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return {
        tab: rect?.toJSON(), body: body?.getBoundingClientRect().toJSON(),
        scrollTop: body?.scrollTop, clientHeight: body?.clientHeight,
        hitTag: target?.tagName, hitSlot: target?.getAttribute('data-slot'),
      }
    })()`)
    throw new Error(`Order drawer tab is not reachable: ${JSON.stringify(geometry)}`, { cause })
  }
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
