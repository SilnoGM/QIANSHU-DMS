import type { NotificationEventVariableDto } from '../../src/api/generated/types.gen'
import type { MessageDraft, MessageEditorContext } from '../../src/views/system/notifications/events/message-editor.types'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 弹窗编辑器纯函数与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import { reactive } from 'vue'

import {
  cloneMessageDraft,
  createDefaultMessageDraft,
  extractMediaSourceKeys,
  filterVariables,
  hasStaticTextOutsideImages,
  imageMaxCount,
  imageSourceKeys,
  insertAtSelection,
  messageDraftSnapshot,
  messageFieldLabel,
  messageKindLabel,
  normalizeServerIssues,
  serverErrorsForMessage,
  shouldApplyMessageDraft,
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
const variableInputSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/editor/VariableTextInput.vue', import.meta.url),
  'utf8',
)
const mpnewsEditorSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/editor/MpnewsMessageEditor.vue', import.meta.url),
  'utf8',
)
const newsEditorSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/editor/NewsMessageEditor.vue', import.meta.url),
  'utf8',
)
const richTextSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/RichTextEditor.vue', import.meta.url),
  'utf8',
)
const assetImageViewSource = readFileSync(
  new URL('../../src/views/system/notifications/events/components/AssetImageView.vue', import.meta.url),
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

function newsDraft(overrides: Record<string, unknown> = {}): MessageDraft {
  return {
    kind: 'NEWS',
    payload: {
      articles: [{
        title: '订单通知',
        description: '请查收订单资料',
        url: 'https://dms.example.com/sales/1',
        imageAssetId: '00000000-0000-4000-8000-000000000333',
      }],
      ...overrides,
    },
    mediaPolicy: {},
    enabled: true,
  }
}

test('消息类型标签与默认草稿保持单一来源', () => {
  assert.equal(messageKindLabel('TEXT'), '文本消息')
  assert.equal(messageKindLabel('MPNEWS'), '企微图文')
  assert.equal(messageKindLabel('NEWS'), '图文卡片')
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

test('mpnews 业务图片占位校验来源、数量与静态文字', () => {
  const source = 'salesOrder.issuanceVoucher'
  const withSource = { ...context(), mediaSources: [source], mediaMaxCount: 2 }

  assert.deepEqual(extractMediaSourceKeys(
    `<p>附件：</p><img data-media-source="${source}"><img data-media-source="${source}">`,
  ), [source, source])
  assert.equal(hasStaticTextOutsideImages(`<p>附件：</p><img data-media-source="${source}">`), true)
  assert.equal(hasStaticTextOutsideImages(`<img data-media-source="${source}">`), false)

  assert.deepEqual(validateMessageDraft(mpnewsDraft({
    content: `<p>附件：</p><img data-media-source="${source}">`,
  }), withSource), [])

  assert.match(validateMessageDraft(mpnewsDraft({
    content: '<p>附件：</p><img data-media-source="unknown.source">',
  }), withSource)[0]?.message ?? '', /未声明/u)

  assert.match(validateMessageDraft(mpnewsDraft({
    content: `<p>附件：</p><img data-media-source="${source}"><img data-media-source="${source}"><img data-media-source="${source}">`,
  }), withSource)[0]?.message ?? '', /不能超过 2 个/u)

  assert.match(validateMessageDraft(mpnewsDraft({
    content: `<img data-media-source="${source}">`,
  }), withSource)[0]?.message ?? '', /静态文字/u)
})

test('Markdown 与文本卡片校验', () => {
  const markdown = createDefaultMessageDraft('MARKDOWN', context())
  markdown.payload.content = '## 标题'
  assert.deepEqual(validateMessageDraft(markdown, context({ sendMethod: 'APP' })), [])

  markdown.payload.content = 'x'.repeat(2_049)
  assert.match(validateMessageDraft(markdown, context({ sendMethod: 'APP' }))[0]?.message ?? '', /2048/u)
  assert.deepEqual(validateMessageDraft(markdown, context({ sendMethod: 'ROBOT' })), [])

  const textcard = createDefaultMessageDraft('TEXTCARD', context())
  assert.match(validateMessageDraft(textcard, context())[0]?.message ?? '', /标题不能为空/u)
  textcard.payload = {
    title: '采购通知',
    description: '采购单已审核通过',
    url: 'https://dms.example.com/purchase/1',
    btntxt: '详情',
  }
  assert.deepEqual(validateMessageDraft(textcard, context()), [])
  textcard.payload.url = 'javascript:alert(1)'
  assert.match(validateMessageDraft(textcard, context())[0]?.message ?? '', /http\/https/u)
})

test('文件消息校验固定文件与业务来源', () => {
  const fixed = createDefaultMessageDraft('FILE', context())
  fixed.payload = {
    mediaAssetId: '00000000-0000-4000-8000-000000000222',
    filename: '报价单.pdf',
  }
  assert.deepEqual(validateMessageDraft(fixed, context()), [])

  const dynamic = createDefaultMessageDraft('FILE', context())
  dynamic.payload = { mediaAssetId: null }
  dynamic.mediaPolicy = { sourceKeys: ['salesOrder.contract'], maxCount: 1 }
  assert.deepEqual(validateMessageDraft(dynamic, context()), [])

  const empty = createDefaultMessageDraft('FILE', context())
  assert.match(validateMessageDraft(empty, context())[0]?.message ?? '', /上传文件或选择业务附件/u)

  const unknown = createDefaultMessageDraft('FILE', context())
  unknown.mediaPolicy = { sourceKeys: ['unknown.file'], maxCount: 1 }
  assert.match(validateMessageDraft(unknown, context())[0]?.message ?? '', /未声明/u)
})

test('图文卡片校验文章数量、字段字节、链接、图片与变量', () => {
  assert.deepEqual(validateMessageDraft(newsDraft(), context()), [])

  const missingArticles = newsDraft({ articles: [] })
  assert.match(validateMessageDraft(missingArticles, context())[0]?.message ?? '', /1–8/u)

  const tooMany = newsDraft({
    articles: Array.from({ length: 9 }, (_, index) => ({
      title: `文章 ${index + 1}`,
      description: null,
      url: 'https://dms.example.com/1',
      imageAssetId: null,
    })),
  })
  assert.match(validateMessageDraft(tooMany, context())[0]?.message ?? '', /1–8/u)

  const invalid = newsDraft({
    articles: [{
      title: ' ',
      description: 'x'.repeat(513),
      url: 'ftp://example.test/file',
      imageAssetId: 'not-a-uuid',
    }],
  })
  const fields = validateMessageDraft(invalid, context()).map(issue => issue.field)
  assert.ok(fields.includes('articles.0.title'))
  assert.ok(fields.includes('articles.0.description'))
  assert.ok(fields.includes('articles.0.url'))
  assert.ok(fields.includes('articles.0.imageAssetId'))

  assert.match(
    validateMessageDraft(newsDraft({
      articles: [{ title: 'x'.repeat(129), description: null, url: 'https://dms.example.com/1', imageAssetId: null }],
    }), context())[0]?.message ?? '',
    /128/u,
  )
  assert.match(
    validateMessageDraft(newsDraft({
      articles: [{ title: '{{unknown}}', description: null, url: 'https://dms.example.com/1', imageAssetId: null }],
    }), context())[0]?.message ?? '',
    /未声明变量/u,
  )
})

test('站内文本允许 / 开头的路由链接，企微仍要求绝对 URL', () => {
  const routeDraft = textDraft('查看详情')
  routeDraft.payload.linkUrl = '/qs-finance/realtime-payments/sales-receipts'
  assert.deepEqual(validateMessageDraft(routeDraft, context({ channel: 'IN_APP', sendMethod: 'IN_APP' })), [])
  assert.match(
    validateMessageDraft(routeDraft, context({ channel: 'WECOM', sendMethod: 'APP' }))[0]?.message ?? '',
    /http\/https/u,
  )

  const protocolRelative = textDraft('查看详情')
  protocolRelative.payload.linkUrl = '//evil.example/path'
  assert.match(
    validateMessageDraft(protocolRelative, context({ channel: 'IN_APP', sendMethod: 'IN_APP' }))[0]?.message ?? '',
    /站内链接/u,
  )
})

test('新增消息保留默认值时也必须回写，编辑已有消息未改动只关闭', () => {
  assert.equal(shouldApplyMessageDraft(false, false), true)
  assert.equal(shouldApplyMessageDraft(false, true), true)
  assert.equal(shouldApplyMessageDraft(true, false), false)
  assert.equal(shouldApplyMessageDraft(true, true), true)
  assert.match(modalSource, /shouldApplyMessageDraft\(props\.seed !== null, dirty\.value\)/u)
})

test('消息草稿快照可区分未修改与已修改', () => {
  const draft = textDraft('你好')
  const clone = cloneMessageDraft(draft)
  assert.equal(messageDraftSnapshot(clone), messageDraftSnapshot(draft))
  clone.payload.content = '你好，世界'
  assert.notEqual(messageDraftSnapshot(clone), messageDraftSnapshot(draft))
})

test('克隆响应式消息草稿时不会因 Proxy 触发 DataCloneError', () => {
  const draft = reactive(textDraft('你好')) as MessageDraft
  const clone = cloneMessageDraft(draft)

  assert.deepEqual(clone, textDraft('你好'))
  assert.notEqual(clone.payload, draft.payload)
})

test('服务端 issues 收敛为可定位的渠道、消息序号与字段', () => {
  const issues = normalizeServerIssues([
    {
      code: 'NOTIFICATION_CONTENT_MPSNEWS_TITLE_EMPTY',
      message: 'mpnews 标题不能为空',
      channel: 'WECOM',
      itemIndex: 1,
      field: 'title',
    },
    {
      code: 'NOTIFICATION_CONTENT_COVER_INVALID',
      message: 'mpnews 必须配置有效的封面资产',
      channel: 'WECOM',
      itemIndex: 1,
      field: 'cover.mediaAssetId',
    },
    {
      code: 'NOTIFICATION_CONTENT_TEXT_EMPTY',
      message: '文本内容不能为空',
      channel: 'IN_APP',
      itemIndex: 0,
      field: 'content',
    },
    {
      code: 'NOTIFICATION_CONTENT_EMPTY',
      message: '消息内容不能为空',
      channel: 'UNKNOWN',
      itemIndex: -2,
    },
  ])

  assert.deepEqual(issues.map(issue => [issue.channel, issue.itemIndex, issue.field]), [
    ['WECOM', 1, 'title'],
    ['WECOM', 1, 'cover.mediaAssetId'],
    ['IN_APP', 0, 'content'],
    [null, null, null],
  ])

  assert.deepEqual(serverErrorsForMessage(issues, 'WECOM', 1), {
    cover: 'mpnews 必须配置有效的封面资产',
    title: 'mpnews 标题不能为空',
  })
  assert.deepEqual(serverErrorsForMessage(issues, 'IN_APP', 0), {
    content: '文本内容不能为空',
  })
  assert.deepEqual(serverErrorsForMessage(issues, 'WECOM', 0), {})
  assert.equal(messageFieldLabel('cover.mediaAssetId'), '封面')
  assert.equal(messageFieldLabel('mediaPolicy'), '附件来源')
  assert.equal(messageFieldLabel('unknownField'), 'unknownField')
})

test('详情页只展示消息列表，编辑统一走弹窗', () => {
  assert.match(detailSource, /<MessageEditorModal/u)
  assert.match(detailSource, /openEditMessage/u)
  assert.match(detailSource, /编辑内容/u)
  assert.match(detailSource, /addMessageMenu/u)
  assert.match(detailSource, /<FaDropdown/u)
  assert.match(detailSource, /文本消息/u)
  assert.match(detailSource, /企微图文/u)
  assert.match(detailSource, /图文卡片/u)
  assert.match(detailSource, /addMessageKindGroups/u)
  assert.match(detailSource, /openCreateMessage\(option\.kind\)/u)
  assert.match(detailSource, /'NEWS', 'FILE'/u)
  assert.match(detailSource, /Markdown/u)
  assert.match(detailSource, /文本卡片/u)
  assert.match(detailSource, /插入消息/u)
  assert.match(detailSource, /getApiClientFailureIssues/u)
  assert.match(detailSource, /revealFirstServerIssue/u)
  assert.match(detailSource, /server-errors/u)
  assert.doesNotMatch(detailSource, /<FaTextarea/u)
  assert.doesNotMatch(detailSource, /<RichTextEditor/u)
  assert.doesNotMatch(detailSource, /可用变量/u)

  assert.match(modalSource, /<QsGenericModal/u)
  assert.match(modalSource, /size="2xl"/u)
  assert.match(modalSource, /<TextMessageEditor/u)
  assert.match(modalSource, /<ImageMessageEditor/u)
  assert.match(modalSource, /<MpnewsMessageEditor/u)
  assert.match(modalSource, /<NewsMessageEditor/u)
  assert.match(modalSource, /<VariablePalette/u)
  assert.match(modalSource, /validateMessageDraft/u)
  assert.match(modalSource, /serverErrors/u)
  assert.match(modalSource, /messageFieldLabel/u)
  assert.match(modalSource, /before-close/u)

  assert.match(paletteSource, /filterVariables/u)
  assert.match(paletteSource, /variableToken/u)
  assert.match(paletteSource, /@mousedown\.prevent/u)
  assert.match(paletteSource, /最近聚焦的输入框或正文/u)

  assert.match(variableInputSource, /insertAtSelection/u)
  assert.match(variableInputSource, /focusin/u)
  assert.match(variableInputSource, /setSelectionRange/u)
  assert.match(variableInputSource, /defineExpose/u)

  assert.match(mpnewsEditorSource, /VariableTextInput/u)
  assert.match(mpnewsEditorSource, /lastFocusedField/u)
  assert.match(mpnewsEditorSource, /lastFocusedField = 'title'/u)
  assert.match(mpnewsEditorSource, /lastFocusedField = 'author'/u)
  assert.match(mpnewsEditorSource, /lastFocusedField = 'digest'/u)
  assert.match(mpnewsEditorSource, /lastFocusedField = 'contentSourceUrl'/u)
  assert.match(mpnewsEditorSource, /最近聚焦的字段/u)
  assert.match(richTextSource, /'focus': \[\]/u)
  assert.match(richTextSource, /onFocus/u)
  assert.match(richTextSource, /data-media-source/u)
  assert.match(richTextSource, /insertBusinessImage/u)
  assert.match(richTextSource, /<FaDropdown/u)
  assert.match(richTextSource, /mediaMaxCount/u)
  assert.match(assetImageViewSource, /mpnews-business-image-placeholder/u)
  assert.match(assetImageViewSource, /发布时插入/u)
  assert.match(newsEditorSource, /VariableTextInput/u)
  assert.match(newsEditorSource, /lastFocusedField/u)
  assert.match(newsEditorSource, /MAX_ARTICLES = 8/u)
  assert.match(newsEditorSource, /2 \* 1024 \* 1024/u)
  assert.match(newsEditorSource, /contentMedia\.upload/u)
  assert.match(newsEditorSource, /defineExpose\(\{ insertVariable \}\)/u)
})
