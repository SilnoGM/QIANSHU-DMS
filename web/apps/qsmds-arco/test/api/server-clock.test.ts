import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 服务端时钟估值使用 Node.js 内置 runner。
import test from 'node:test'
import {
  hasServerClockSample,
  recordServerClockSample,
  resetServerClock,
  serverNow,
  serverNowEpochMs,
} from '../../src/utils/server-clock'

test('无样本时退回本地时钟并保留安全余量', () => {
  resetServerClock()
  const localNow = Date.parse('2026-10-27T04:00:00.000Z')

  assert.equal(hasServerClockSample(), false)
  assert.equal(serverNowEpochMs(localNow), localNow - 2_000)
  assert.equal(serverNow(localNow).toISOString(), '2026-10-27T03:59:58.000Z')
})

test('按响应 Date 头校准，并始终给出不晚于服务端真实时刻的下界', () => {
  resetServerClock()
  // 浏览器比服务器快 3 分钟：服务端发响应时是 04:00:07（Date 头只到秒），本地读作 04:03:07。
  recordServerClockSample('Tue, 27 Oct 2026 04:00:07 GMT', Date.parse('2026-10-27T04:03:07.000Z'))

  assert.equal(hasServerClockSample(), true)
  // 5 秒后再取值：服务端真实时刻约 04:00:12，估值 04:00:10 仍然在它之前。
  assert.equal(
    serverNowEpochMs(Date.parse('2026-10-27T04:03:12.000Z')),
    Date.parse('2026-10-27T04:00:10.000Z'),
  )
  // 用本地时钟当上限会让服务端判成未来时间，这里必须已扣掉偏差与余量。
  assert.ok(serverNowEpochMs(Date.parse('2026-10-27T04:03:12.000Z')) < Date.parse('2026-10-27T04:00:12.000Z'))
})

test('无效或缺失的 Date 头不覆盖已有样本', () => {
  resetServerClock()
  recordServerClockSample('Tue, 27 Oct 2026 04:00:07 GMT', Date.parse('2026-10-27T04:03:07.000Z'))
  const calibrated = serverNowEpochMs(Date.parse('2026-10-27T04:03:10.000Z'))

  for (const header of [undefined, '', '   ', 'not-a-date', 1_234]) {
    recordServerClockSample(header, Date.parse('2026-10-27T04:03:11.000Z'))
  }

  assert.equal(serverNowEpochMs(Date.parse('2026-10-27T04:03:10.000Z')), calibrated)
})
