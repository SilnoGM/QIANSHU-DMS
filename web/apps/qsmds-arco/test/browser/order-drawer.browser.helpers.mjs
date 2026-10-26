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
  // 中间业务步骤可能用 DOM.click()，光标仍停在上次页签的位置。新出现的
  // QsToast 堆叠会在该位置悬停暂停，必须先真实移开光标，再等浮层自然消失。
  // 这里只移动、不点击或关闭提示；持续遮罩仍必须被下方命中检查拒绝。
  await page.connection.send('Input.dispatchMouseEvent', {
    x: 0,
    y: 0,
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
  })
  await page.waitFor(`${source} !== null`)
  // 吸顶页签的布局框不代表实际可点击区域；展开长记录后先归零当前抽屉正文，
  // 与抽屉切换页签时的滚动行为保持一致，避免 scrollIntoView 连带移动背景页面。
  await page.evaluate(`document.querySelector(
    '[data-testid=${JSON.stringify(drawerTestId)}]',
  ).parentElement.scrollTo({ top: 0, behavior: 'instant' })`)
  // 付款等步骤可能留下悬停暂停的 toast；等其自然消失，避免点击瞬间被浮层截获。
  await page.waitFor(`[...document.querySelectorAll('[data-qs-toast]')]
    .every(toast => toast.getClientRects().length === 0)`)
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
      const describe = node => {
        if (!(node instanceof HTMLElement)) return null
        const style = getComputedStyle(node)
        return {
          tag: node.tagName, slot: node.getAttribute('data-slot'), role: node.getAttribute('role'),
          rect: node.getBoundingClientRect().toJSON(),
          inDrawer: Boolean(body?.contains(node)),
          inParts: Boolean(node.closest('[data-slot="purchase-order-drawer-parts"]')),
          inToast: Boolean(node.closest('[data-qs-toast], [data-sonner-toaster]')),
          toastPaused: node.closest('[data-qs-toast]')?.getAttribute('data-paused'),
          pointerEvents: style.pointerEvents, position: style.position, zIndex: style.zIndex,
          transform: style.transform, overflow: style.overflow, visibility: style.visibility,
        }
      }
      const ancestors = node => {
        const result = []
        for (let depth = 0; node && depth < 9; depth++, node = node.parentElement) result.push(describe(node))
        return result
      }
      return {
        tab: rect?.toJSON(), body: body?.getBoundingClientRect().toJSON(),
        scrollTop: body?.scrollTop, clientHeight: body?.clientHeight,
        hitTag: target?.tagName, hitSlot: target?.getAttribute('data-slot'),
        hit: describe(target), tabAncestors: ancestors(tab), hitAncestors: ancestors(target),
        hitStack: rect && document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).slice(0, 6).map(describe),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(node => node.getClientRects().length).map(describe),
        viewport: {
          width: innerWidth, height: innerHeight, scrollX, scrollY,
          offsetTop: visualViewport?.offsetTop, offsetLeft: visualViewport?.offsetLeft,
          scale: visualViewport?.scale,
        },
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
  // 让 hover 状态、toast 暂停与页签过渡先完成，再按真实指针点击。
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
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
  try {
    await page.waitFor(`(() => {
      const tab = ${source}
      const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '')
      return tab?.getAttribute('aria-selected') === 'true'
        && tab.getAttribute('data-state') === 'active'
        && panel?.getAttribute('role') === 'tabpanel'
        && panel.getClientRects().length > 0
    })()`)
  }
  catch (cause) {
    const state = await page.evaluate(`(() => {
      const tab = ${source}
      const panel = document.getElementById(tab?.getAttribute('aria-controls') ?? '')
      return {
        selected: tab?.getAttribute('aria-selected'),
        state: tab?.getAttribute('data-state'),
        panelRole: panel?.getAttribute('role'),
        panelRects: panel?.getClientRects().length ?? 0,
        activeRole: document.activeElement?.getAttribute('role'),
        activeTag: document.activeElement?.tagName,
      }
    })()`)
    throw new Error(
      `Order drawer tab did not activate: ${JSON.stringify(state)}`,
      { cause },
    )
  }
}
