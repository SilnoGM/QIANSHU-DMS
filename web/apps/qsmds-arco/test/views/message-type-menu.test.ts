import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 菜单纯函数与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  addMessageKindGroups,
  MESSAGE_KIND_ICONS,
} from '../../src/views/system/notifications/events/message-type-menu'

const detailSource = readFileSync(
  new URL('../../src/views/system/notifications/events/detail.vue', import.meta.url),
  'utf8',
)

test('站内通知只在没有内容时展示文本消息入口', () => {
  assert.deepEqual(addMessageKindGroups({
    channel: 'IN_APP',
    sendMethod: 'IN_APP',
    messageCount: 0,
    hasMpnews: false,
    hasMedia: false,
  }), [[{ kind: 'TEXT', enabled: true }]])

  assert.deepEqual(addMessageKindGroups({
    channel: 'IN_APP',
    sendMethod: 'IN_APP',
    messageCount: 1,
    hasMpnews: false,
    hasMedia: false,
  }), [])
})

test('企微应用菜单开放已实现类型，并把未实现类型置灰展示', () => {
  const groups = addMessageKindGroups({
    channel: 'WECOM',
    sendMethod: 'APP',
    messageCount: 2,
    hasMpnews: false,
    hasMedia: true,
  })

  assert.deepEqual(groups.map(group => group.map(option => option.kind)), [
    ['TEXT', 'MARKDOWN', 'TEXTCARD', 'FILE', 'NEWS', 'MPNEWS', 'IMAGE'],
    ['VOICE', 'VIDEO', 'MINIPROGRAM_NOTICE', 'TEMPLATE_CARD', 'INTERACTIVE_TASKCARD'],
  ])
  assert.ok(groups[0]?.every(option => option.enabled))
  assert.ok(groups[1]?.every(option => !option.enabled))

  const withoutMedia = addMessageKindGroups({
    channel: 'WECOM',
    sendMethod: 'APP',
    messageCount: 1,
    hasMpnews: true,
    hasMedia: false,
  })
  assert.deepEqual(withoutMedia[0]?.map(option => option.kind), [
    'TEXT',
    'MARKDOWN',
    'TEXTCARD',
    'FILE',
    'NEWS',
  ])
})

test('群机器人只展示自身支持但尚未实现的类型', () => {
  const groups = addMessageKindGroups({
    channel: 'WECOM',
    sendMethod: 'ROBOT',
    messageCount: 0,
    hasMpnews: false,
    hasMedia: true,
  })

  assert.deepEqual(groups.map(group => group.map(option => option.kind)), [
    ['TEXT', 'MARKDOWN', 'MARKDOWN_V2', 'FILE', 'NEWS', 'IMAGE'],
    ['VOICE', 'TEMPLATE_CARD'],
  ])
  assert.ok(groups[1]?.every(option => !option.enabled))
})

test('每种消息类型都有菜单图标，未实现项禁用且标注后续开放', () => {
  assert.equal(Object.keys(MESSAGE_KIND_ICONS).length, 13)

  assert.match(detailSource, /addMessageKindGroups/u)
  assert.match(detailSource, /disabled: !option\.enabled/u)
  assert.match(detailSource, /（后续开放）/u)
  assert.match(detailSource, /MESSAGE_KIND_ICONS/u)
})
