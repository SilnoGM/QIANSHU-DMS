/* eslint-disable test/no-import-node-test -- 轮询纯函数使用 Node.js 内置 runner。 */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectNotificationPages,
  desktopRetryDelay,
  shouldYieldLeadership,
  unreadPollDelay,
  unreadRetryDelay,
} from '../../src/store/modules/app/notification-polling'

test('未读数正常轮询保持 30 秒基线并带 ±3 秒抖动', () => {
  assert.equal(unreadPollDelay(0), 27_000)
  assert.equal(unreadPollDelay(2_999), 29_999)
  assert.equal(unreadPollDelay(3_000), 30_000)
  assert.equal(unreadPollDelay(5_999), 32_999)
  assert.equal(unreadPollDelay(8_000), 29_000)
})

test('未读数失败按 60、120、240、300 秒退避', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(unreadRetryDelay),
    [60_000, 120_000, 240_000, 300_000, 300_000],
  )
})

test('桌面首请求重试复用同一组退避', () => {
  assert.equal(desktopRetryDelay(1), 60_000)
  assert.equal(desktopRetryDelay(4), 300_000)
})

test('只有无桌面提醒的隐藏主标签才让出锁', () => {
  assert.equal(shouldYieldLeadership('hidden', false), true)
  assert.equal(shouldYieldLeadership('hidden', true), false)
  assert.equal(shouldYieldLeadership('visible', false), false)
  assert.equal(shouldYieldLeadership('visible', true), false)
})

test('桌面增量最多续拉三页并保留最后一页游标', async () => {
  const cursors: string[] = []
  const pages = [
    { hasMore: true, items: ['a', 'b'], nextCursor: 'cursor-2', unreadTotal: 5 },
    { hasMore: true, items: ['c'], nextCursor: 'cursor-3', unreadTotal: 5 },
    { hasMore: true, items: ['d'], nextCursor: 'cursor-4', unreadTotal: 5 },
    { hasMore: false, items: ['e'], nextCursor: 'cursor-5', unreadTotal: 4 },
  ]

  const result = await collectNotificationPages('cursor-1', async (cursor) => {
    cursors.push(cursor)
    return pages[cursors.length - 1]!
  })

  assert.deepEqual(cursors, ['cursor-1', 'cursor-2', 'cursor-3'])
  assert.deepEqual(result.items, ['a', 'b', 'c', 'd'])
  assert.equal(result.cursor, 'cursor-4')
  assert.equal(result.unreadTotal, 5)
  assert.equal(result.hasMore, true)
})

test('桌面增量遇到空页立即停止，避免重复请求', async () => {
  let calls = 0
  const result = await collectNotificationPages('cursor-1', async () => {
    calls += 1
    return { hasMore: true, items: [], nextCursor: 'cursor-2', unreadTotal: 2 }
  })

  assert.equal(calls, 1)
  assert.deepEqual(result.items, [])
  assert.equal(result.cursor, 'cursor-2')
})
