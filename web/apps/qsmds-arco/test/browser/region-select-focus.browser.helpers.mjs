import assert from 'node:assert/strict'
import { selectRegionOption } from './regions.browser.helpers.mjs'

/** 隔离复现关闭标记先变化、弹层退出与回焦后完成的 Select 生命周期。 */
export async function assertRegionSelectFocusLifecycle(page) {
  await page.navigate(`data:text/html,${encodeURIComponent(`<!doctype html>
    <style>button,[role=option]{display:block;padding:12px;margin:8px}</style>
    <div data-testid="region-focus-fixture">
      <div data-region-level="PROVINCE_STATE"><button data-slot="select-trigger"
        aria-expanded="false" aria-controls="province-options">Province</button></div>
      <div data-region-level="CITY"><button data-slot="select-trigger"
        aria-expanded="false" aria-controls="city-options">City</button></div>
    </div>
    <script>
      window.regionFocusProbe = { selections: [], trustedKeys: 0, restored: 0 };
      for (const trigger of document.querySelectorAll('button')) {
        trigger.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || trigger.getAttribute('aria-expanded') === 'true') return;
          event.preventDefault();
          trigger.setAttribute('aria-expanded', 'true');
          const content = document.createElement('div');
          content.id = trigger.getAttribute('aria-controls');
          content.dataset.slot = 'select-content';
          content.dataset.state = 'open';
          const option = document.createElement('div');
          option.dataset.slot = 'select-item';
          option.setAttribute('role', 'option');
          option.tabIndex = -1;
          option.textContent = trigger.textContent + ' option';
          option.addEventListener('focus', () => {
            if (window.regionFocusProbe.blockFocus) trigger.focus();
          });
          option.addEventListener('keydown', keyEvent => {
            if (keyEvent.key !== 'Enter') return;
            if (!keyEvent.isTrusted) throw new Error('Expected trusted option key event');
            keyEvent.preventDefault();
            window.regionFocusProbe.trustedKeys++;
            window.regionFocusProbe.selections.push(trigger.textContent);
            trigger.setAttribute('aria-expanded', 'false');
            content.dataset.state = 'closed';
            if (window.regionFocusProbe.blockClose) return;
            setTimeout(() => {
              content.remove();
              setTimeout(() => {
                trigger.focus();
                window.regionFocusProbe.restored++;
              }, 20);
            }, 150);
          });
          content.append(option);
          document.body.append(content);
        });
      }
    </script>`)}`)
  await selectRegionOption(page, 'region-focus-fixture', 'PROVINCE_STATE', 'Province option')
  assert.deepEqual(await page.evaluate(`({
    contentRemoved: document.getElementById('province-options') === null,
    focusReturned: document.activeElement === document.querySelector('button'),
    restored: window.regionFocusProbe.restored,
  })`), { contentRemoved: true, focusReturned: true, restored: 1 }, '不能在 aria-expanded=false 时提前结束，下一层选择前必须完成退出与回焦')
  await selectRegionOption(page, 'region-focus-fixture', 'CITY', 'City option')
  assert.deepEqual(await page.evaluate('window.regionFocusProbe'), {
    selections: ['Province', 'City'],
    trustedKeys: 2,
    restored: 2,
  })

  const boundedPage = Object.create(page)
  boundedPage.waitFor = expression => page.waitFor(expression, 1000)
  await page.evaluate('window.regionFocusProbe.blockFocus = true')
  await assert.rejects(
    selectRegionOption(boundedPage, 'region-focus-fixture', 'CITY', 'City option'),
    /Region option selection failed/u,
  )
  assert.equal(await page.evaluate('window.regionFocusProbe.trustedKeys'), 2, '焦点被抢走时必须失败，不把 Enter 发往错误控件')
  await page.evaluate('window.regionFocusProbe.blockFocus = false; window.regionFocusProbe.blockClose = true')
  await assert.rejects(
    selectRegionOption(boundedPage, 'region-focus-fixture', 'CITY', 'City option'),
    /Region option selection failed/u,
  )
  assert.equal(await page.evaluate('document.getElementById(\'city-options\')?.dataset.state'), 'closed', '永久停留的退出弹层必须阻止 helper 成功返回')
  await page.navigate('about:blank')
}
