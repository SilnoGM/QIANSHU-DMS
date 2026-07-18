import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 设置对象是纯数据，使用 Node.js 内置 runner 验证。
import test from 'node:test'

import settings from '../../src/settings'

test('正式应用允许窄屏进入业务 Shell', () => {
  assert.equal(settings.app.mobile, true)
})

test('正式应用继续使用已记录的 hash history 路由契约', () => {
  assert.equal(settings.app.routeMode, 'hash')
})
