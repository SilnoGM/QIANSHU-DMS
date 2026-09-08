import assert from 'node:assert/strict'
import { clickOrderDrawerTab } from './order-drawer.browser.helpers.mjs'

/** 在空白测试页复现吸顶页签被滚动容器裁剪的情况，不接触业务数据。 */
export async function assertOrderDrawerTabScrolling(page) {
  const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      * { box-sizing: border-box } body { margin: 0; height: 2400px }
      .drawer { position: fixed; right: 0; top: 0; width: 600px; height: 700px;
        display: flex; flex-direction: column; overflow: hidden; background: white }
      header { height: 100px; flex: none; background: silver }
      main { flex: 1; padding: 16px; overflow-y: auto }
      [role=tablist] { display: flex; position: sticky; top: -64px; height: 48px; background: white }
      [role=tab] { height: 48px; width: 180px }
      [role=tabpanel] { height: 1800px }
      .blocker { position: absolute; inset: 0; z-index: 20; background: silver }
    </style>
    <div class="drawer"><header>Drawer header</header><main>
      <div data-testid="drawer-scroll-fixture">
        <div role="tablist">
          <button role="tab" aria-selected="true" data-state="active" aria-controls="information">Details</button>
          <button role="tab" aria-selected="false" data-state="inactive" aria-controls="changes">Changes</button>
        </div>
        <div id="information" role="tabpanel">Expanded payment record</div>
        <div id="changes" role="tabpanel" hidden>Changes</div>
      </div>
    </main></div>
    <script>
      for (const tab of document.querySelectorAll('[role=tab]')) {
        tab.addEventListener('mousedown', event => {
          if (!event.isTrusted) throw new Error('Expected a trusted pointer event');
          for (const candidate of document.querySelectorAll('[role=tab]')) {
            const selected = candidate === tab;
            candidate.setAttribute('aria-selected', String(selected));
            candidate.dataset.state = selected ? 'active' : 'inactive';
            document.getElementById(candidate.getAttribute('aria-controls')).hidden = !selected;
          }
        });
      }
    </script>`
  await page.navigate(`data:text/html,${encodeURIComponent(fixture)}`)
  await page.evaluate(`window.scrollTo(0, 250); document.querySelector('main').scrollTop = 1000`)
  assert.equal(await page.evaluate(`(() => {
    const tab = document.querySelectorAll('[role=tab]')[1]
    const rect = tab.getBoundingClientRect()
    return tab.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  })()`), false, '红测场景必须真实裁剪页签，不能只模拟命中结果')
  await clickOrderDrawerTab(page, 'drawer-scroll-fixture', 'Changes')
  assert.deepEqual(await page.evaluate(`({ background: scrollY, drawer: document.querySelector('main').scrollTop })`), {
    background: 250,
    drawer: 0,
  }, '只归零抽屉正文，不能移动背景页面')

  // 覆盖提示浮层悬停暂停的浏览器交互：光标不移走时不能靠无限等待恢复点击。
  await page.evaluate(`(() => {
    const rect = document.querySelector('[aria-controls="information"]').getBoundingClientRect()
    const notice = document.createElement('article')
    notice.dataset.hoverNotice = ''
    notice.style.cssText = 'position:fixed;z-index:30;background:silver;left:' + rect.x + 'px;top:' + rect.y + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px'
    notice.addEventListener('mouseenter', event => {
      if (event.isTrusted) notice.dataset.paused = 'true'
    })
    notice.addEventListener('mouseleave', event => {
      if (event.isTrusted) setTimeout(() => notice.remove(), 150)
    })
    document.body.append(notice)
  })()`)
  const noticePoint = await page.evaluate(`(() => {
    const rect = document.querySelector('[data-hover-notice]').getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)
  await page.connection.send('Input.dispatchMouseEvent', {
    ...noticePoint,
    type: 'mouseMoved',
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
  })
  await page.waitFor(`document.querySelector('[data-hover-notice]')?.dataset.paused === 'true'`)
  const hoverPage = Object.create(page)
  hoverPage.waitFor = expression => page.waitFor(expression, 3000)
  await clickOrderDrawerTab(hoverPage, 'drawer-scroll-fixture', 'Details')
  assert.equal(await page.evaluate(`document.querySelector('[data-hover-notice]') === null`), true)

  await page.evaluate(`document.querySelector('.drawer').insertAdjacentHTML('beforeend', '<div class="blocker"></div>')`)
  // 缩短的只是此反例的诊断等待；遮罩始终存在，不能绕开命中检查强行点击。
  const blockedPage = Object.create(page)
  blockedPage.waitFor = expression => page.waitFor(expression, 1000)
  await assert.rejects(
    clickOrderDrawerTab(blockedPage, 'drawer-scroll-fixture', 'Changes'),
    /Order drawer tab is not reachable/u,
  )
  assert.equal(await page.evaluate(`document.querySelector('[aria-controls="information"]').getAttribute('aria-selected')`), 'true')
  await page.navigate('about:blank')
}
