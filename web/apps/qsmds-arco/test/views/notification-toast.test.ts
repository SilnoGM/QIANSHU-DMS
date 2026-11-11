import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 通知 Toast 聚合逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import { mergeNotificationToastAlerts } from '../../src/store/modules/app/notification-toast.logic'

function item(id: string) {
  return { body: `正文 ${id}`, id, title: `通知 ${id}` }
}

test('逐条保留少量新通知并去重', () => {
  const first = mergeNotificationToastAlerts([], [item('1'), item('2')])
  assert.equal(first.length, 2)
  assert.deepEqual(first.map(alert => alert.kind === 'item' ? alert.item.id : null), ['1', '2'])
  assert.equal(mergeNotificationToastAlerts(first, [item('1')]).length, 2)
})

test('超过上限时收敛成一条汇总', () => {
  const result = mergeNotificationToastAlerts([], [item('1'), item('2'), item('3')])
  assert.equal(result.length, 1)
  assert.equal(result[0]?.kind, 'summary')
  assert.equal(result[0]?.kind === 'summary' ? result[0].count : 0, 3)
})

test('已有汇总时继续累加新消息数量', () => {
  const summary = mergeNotificationToastAlerts([], [item('1'), item('2'), item('3')])
  const result = mergeNotificationToastAlerts(summary, [item('4')])
  assert.equal(result.length, 1)
  assert.equal(result[0]?.kind === 'summary' ? result[0].count : 0, 4)
})
