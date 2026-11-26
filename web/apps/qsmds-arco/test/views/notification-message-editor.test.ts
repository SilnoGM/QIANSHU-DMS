import type { NotificationEventVariableDto } from '../../src/api/generated/types.gen'
import type { MessageDraft, MessageEditorContext } from '../../src/views/system/notifications/events/message-editor.types'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 弹窗编辑器纯函数与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  cloneMessageDraft,
  createDefaultMessageDraft,
  filterVariables,
  imageMaxCount,
  imageSourceKeys,
  insertAtSelection,
  messageDraftSnapshot,
  messageKindLabel,
  validateMessageDraft,
} from '../../src/views/system/notifications/events/message-editor.logic'

const modalSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/editor/MessageEditorModal.vue', import.meta.url),
  'utf8',
)
const detailSource = readFileSync(
  new URL('../../src/views/system/notifications/events/detail.vue', import.meta.url),
  'utf8',
)
const paletteSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/editor/VariablePalette.vue', import.meta.url),
  'utf8',
)

const variables: NotificationEventVariableDto[] = [
  {
    name: 'customerName',
    label: '客户名称',
    description: '销售订单客户名称',
    example: '千树科技',
    sensitive: false,
    maxLength: 100,
    required: true,
  },
  {
    name: 'amount',
    label: '金额',
    description: '应付金额',
    example: '1000.00',
    sensitive: true,
    maxLength: 32,
    required: false,
  },
]

function context(overrides: Partial<MessageEditorContext> = {}): MessageEditorContext {
  return {
    channel: 'WECOM',
    sendMethod: 'APP',
    mediaMaxCount: 3,
    mediaSources: ['salesOrder.contract', 'salesOrder.paymentProof'],
    variables,
    variablesKnown: true,
    ...overrides,
  }
}

function textDraft(content: string): MessageDraft {
  return {
    kind: 'TEXT',
    payload: { title: null, content, linkUrl: null },
    mediaPolicy: {},
    enabled: true,
  }
}

function mpnewsDraft(overrides: Record<string, unknown> = {}): MessageDraft {
  return {
    kind: 'MPNEWS',
    payload: {
      cover: { mediaAssetId: '9f3f6f4e-4a4e-4f5e-8a1a-2b3c4d5e6f70' },
      title: '订单通知',
      author: null,
      digest: null,
      contentSourceUrl: null,
      content: '<p>正文</p>',
      ...overrides,
    },
    mediaPolicy: {},
    enabled: true,
  }
}

test('消息类型标签与默认草稿保持单一来源', () => {
  assert.equal(messageKindLabel('TEXT'), '文本')
  assert.equal(messageKindLabel('MPNEWS'), 'mpnews')
  assert.equal(messageKindLabel('IMAGE'), '图片附件')

  const image = createDefaultMessageDraft('IMAGE', context())
  assert.equal(image.kind, 'IMAGE')
  assert.deepEqual(image.mediaPolicy, {
    sourceKeys: ['salesOrder.contract', 'salesOrder.paymentProof'],
    maxCount: 3,
  })
  assert.equal(createDefaultMessageDraft('TEXT', context()).payload.content, '')
})

test('图片附件来源为空或缺省时回退到全部已声明来源', () => {
  const all = ['a', 'b']
  assert.deepEqual(imageSourceKeys({ sourceKeys: [] }, all), all)
  assert.deepEqual(imageSourceKeys({}, all), all)
  assert.deepEqual(imageSourceKeys(null, all), all)
  assert.deepEqual(imageSourceKeys({ sourceKeys: ['b'] }, all), ['b'])
  assert.equal(imageMaxCount({ maxCount: 2 }), 2)
  assert.equal(imageMaxCount({ maxCount: 0 }), 1)
  assert.equal(imageMaxCount({ maxCount: 2.5 }), 1)
})

test('按光标位置插入变量并夹取非法选区', () => {
  assert.deepEqual(insertAtSelection('hello world', '{{name}}', 6, 11), {
    value: 'hello {{name}}',
    cursor: 14,
  })
  assert.deepEqual(insertAtSelection('abc', '{{x}}', 99, 100), {
    value: 'abc{{x}}',
    cursor: 8,
  })
  assert.deepEqual(insertAtSelection('abc', '{{x}}', -1, 1), {
    value: '{{x}}bc',
    cursor: 5,
  })
})

test('变量候选支持名称、标签、说明与示例搜索', () => {
  assert.equal(filterVariables(variables, '').length, 2)
  assert.deepEqual(filterVariables(variables, '客户').map(variable => variable.name), ['customerName'])
  assert.deepEqual(filterVariables(variables, '应付').map(variable => variable.name), ['amount'])
  assert.deepEqual(filterVariables(variables, '千树').map(variable => variable.name), ['customerName'])
  assert.deepEqual(filterVariables(variables, '  AMOUNT ').map(variable => variable.name), ['amount'])
})

test('文本消息校验长度、变量与单花括号占位符', () => {
  assert.deepEqual(validateMessageDraft(textDraft('你好 {{customerName}}'), context()), [])
  assert.match(validateMessageDraft(textDraft('   '), context())[0]?.message ?? '', /正文不能为空/u)
  assert.match(
    validateMessageDraft(textDraft('x'.repeat(2_001)), context({ channel: 'IN_APP' }))[0]?.message ?? '',
    /2000/u,
  )
  assert.match(
    validateMessageDraft(textDraft('你好 {{unknown}}'), context())[0]?.message ?? '',
    /未声明变量/u,
  )
  assert.match(
    validateMessageDraft(textDraft('你好 {customerName}'), context())[0]?.message ?? '',
    /双花括号/u,
  )
  assert.deepEqual(
    validateMessageDraft(textDraft('你好 {{unknown}}'), context({ variablesKnown: false })),
    [],
  )
})

test('图片附件校验来源与张数上限', () => {
  const draft = createDefaultMessageDraft('IMAGE', context())
  assert.deepEqual(validateMessageDraft(draft, context()), [])

  const invalidPolicy = cloneMessageDraft(draft)
  invalidPolicy.mediaPolicy = { sourceKeys: 'bad', maxCount: 9 }
  const issues = validateMessageDraft(invalidPolicy, context())
  assert.ok(issues.some(issue => issue.field === 'mediaPolicy'))
  assert.ok(issues.some(issue => issue.field === 'maxCount'))

  const unknownSource = cloneMessageDraft(draft)
  unknownSource.mediaPolicy = { sourceKeys: ['unknown'], maxCount: 1 }
  assert.match(
    validateMessageDraft(unknownSource, context())[0]?.message ?? '',
    /未声明/u,
  )
})

test('mpnews 校验封面、标题、正文、危险 HTML 与变量', () => {
  assert.deepEqual(validateMessageDraft(mpnewsDraft(), context()), [])

  const missing = mpnewsDraft({ cover: null, title: ' ', content: '<p> </p>' })
  const fields = validateMessageDraft(missing, context()).map(issue => issue.field)
  assert.ok(fields.includes('cover'))
  assert.ok(fields.includes('title'))
  assert.ok(fields.includes('content'))

  assert.match(
    validateMessageDraft(mpnewsDraft({ content: '<script>alert(1)</script>' }), context())[0]?.message ?? '',
    /不安全内容/u,
  )
  assert.match(
    validateMessageDraft(mpnewsDraft({ content: '<p><img src="https://evil.test/a.png"></p>' }), context())[0]?.message ?? '',
    /不安全内容/u,
  )
  assert.match(
    validateMessageDraft(mpnewsDraft({ content: '<p>{{unknown}}</p>' }), context())[0]?.message ?? '',
    /未声明变量/u,
  )
  assert.match(
    validateMessageDraft(mpnewsDraft({ contentSourceUrl: 'ftp://example.test' }), context())[0]?.message ?? '',
    /阅读原文/u,
  )
})

test('消息草稿快照可区分未修改与已修改', () => {
  const draft = textDraft('你好')
  const clone = cloneMessageDraft(draft)
  assert.equal(messageDraftSnapshot(clone), messageDraftSnapshot(draft))
  clone.payload.content = '你好，世界'
  assert.notEqual(messageDraftSnapshot(clone), messageDraftSnapshot(draft))
})

test('详情页只展示消息列表，编辑统一走弹窗', () => {
  assert.match(detailSource, /<MessageEditorModal/u)
  assert.match(detailSource, /openEditMessage/u)
  assert.match(detailSource, /编辑内容/u)
  assert.doesNotMatch(detailSource, /<FaTextarea/u)
  assert.doesNotMatch(detailSource, /<RichTextEditor/u)
  assert.doesNotMatch(detailSource, /可用变量/u)

  assert.match(modalSource, /<QsGenericModal/u)
  assert.match(modalSource, /size="2xl"/u)
  assert.match(modalSource, /<TextMessageEditor/u)
  assert.match(modalSource, /<ImageMessageEditor/u)
  assert.match(modalSource, /<MpnewsMessageEditor/u)
  assert.match(modalSource, /<VariablePalette/u)
  assert.match(modalSource, /validateMessageDraft/u)
  assert.match(modalSource, /before-close/u)

  assert.match(paletteSource, /filterVariables/u)
  assert.match(paletteSource, /variableToken/u)
  assert.match(paletteSource, /@mousedown\.prevent/u)
})
