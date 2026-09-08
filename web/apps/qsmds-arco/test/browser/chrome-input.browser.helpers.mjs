import assert from 'node:assert/strict'

/**
 * 在填写业务数据前验证真实输入能力。关闭触摸模拟只会恢复宿主设备，
 * Linux 无显示设备的 headless Chrome 不一定具有鼠标与悬停能力。
 * 不重写 matchMedia，也不跳过桌面断言；CI 必须提供可恢复的桌面输入环境。
 */
export async function assertBrowserInputCapabilities(page) {
  let desktopTouchPoints
  for (const mobile of [false, true, false]) {
    await page.connection.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
    await page.setViewport(mobile ? 390 : 1440, mobile ? 844 : 900, mobile)
    const capabilities = await page.evaluate(`({
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      hover: matchMedia('(hover: hover)').matches,
      touchPoints: navigator.maxTouchPoints,
    })`)
    // 混合输入设备的桌面可同时支持鼠标和触屏，恢复时应回到宿主原值，而非固定为 0。
    desktopTouchPoints ??= capabilities.touchPoints
    assert.deepEqual(capabilities, {
      coarse: mobile,
      fine: !mobile,
      hover: !mobile,
      touchPoints: mobile ? 1 : desktopTouchPoints,
    }, `Chrome input capabilities must match ${mobile ? 'touch' : 'desktop'} mode`)
  }
}
