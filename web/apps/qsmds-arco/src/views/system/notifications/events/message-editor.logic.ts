import type {
  MessageChannel,
  MessageDraft,
  MessageEditorContext,
  MessageKind,
  MessageServerIssue,
  MessageServerIssueInput,
  MessageValidationIssue,
} from './message-editor.types'
import type { NotificationEventVariableDto } from '@/api/generated/types.gen'
import { toRaw } from 'vue'

const MESSAGE_FIELD_LABELS: Readonly<Record<string, string>> = {
  author: '作者',
  btntxt: '按钮文字',
  content: '正文',
  contentSourceUrl: '阅读原文',
  cover: '封面',
  description: '描述',
  digest: '摘要',
  enabled: '启用状态',
  filename: '文件名',
  kind: '消息类型',
  linkUrl: '链接',
  maxCount: '最多发送张数',
  mediaAssetId: '文件资产',
  mediaPolicy: '附件来源',
  message: '消息',
  title: '标题',
  url: '链接',
}

const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/gu
const SINGLE_BRACE_PATTERN = /(?<!\{)\{(\w+)\}(?!\})/gu
const MPNEWS_MAX_CONTENT_BYTES = 666 * 1024
const TEXT_MAX_BYTES = 2_048
const IN_APP_TEXT_MAX_LENGTH = 2_000

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function optionalString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).length
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function extractPlaceholders(value: string): {
  readonly names: readonly string[]
  readonly singleBrace: readonly string[]
} {
  const names = new Set<string>()
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (match[1] !== undefined) {
      names.add(match[1])
    }
  }
  const singleBrace: string[] = []
  for (const match of value.matchAll(SINGLE_BRACE_PATTERN)) {
    if (match[1] !== undefined) {
      singleBrace.push(match[1])
    }
  }
  return { names: [...names], singleBrace }
}

function validateVariables(
  texts: ReadonlyArray<readonly [field: string, value: string | null]>,
  context: MessageEditorContext,
  add: (field: string, message: string) => void,
): void {
  const known = new Set(context.variables.map(variable => variable.name))
  for (const [field, value] of texts) {
    if (value === null) {
      continue
    }
    const placeholders = extractPlaceholders(value)
    if (placeholders.singleBrace.length > 0) {
      add(field, `变量占位符必须使用双花括号：${placeholders.singleBrace.join('、')}`)
    }
    if (context.variablesKnown) {
      const unknown = placeholders.names.filter(name => !known.has(name))
      if (unknown.length > 0) {
        add(field, `内容包含未声明变量：${unknown.join('、')}`)
      }
    }
  }
}

function containsUnsafeHtml(value: string): boolean {
  return /<(?:script|iframe|object|embed|form)\b/iu.test(value)
    || /\son[a-z]+\s*=/iu.test(value)
    || /\b(?:javascript|data):/iu.test(value)
    || /<img[^>]*\ssrc\s*=/iu.test(value)
    || /<img[^>]*\sdata-asset-id\s*=[^>]*\sdata-media-source\s*=/iu.test(value)
    || /<img[^>]*\sdata-media-source\s*=[^>]*\sdata-asset-id\s*=/iu.test(value)
}

function textIsVisuallyEmpty(value: string): boolean {
  if (/<img\b/iu.test(value)) {
    return false
  }
  return value.replace(/<[^>]*>/gu, '').replace(/&nbsp;/gu, ' ').trim().length === 0
}

export function messageKindLabel(kind: MessageKind): string {
  const labels: Partial<Record<MessageKind, string>> = {
    TEXT: '文本消息',
    MARKDOWN: 'Markdown',
    MARKDOWN_V2: 'Markdown V2',
    TEXTCARD: '文本卡片',
    MPNEWS: '企微图文',
    NEWS: '图文卡片',
    IMAGE: '图片附件',
    VOICE: '语音',
    VIDEO: '视频',
    FILE: '文件',
    MINIPROGRAM_NOTICE: '小程序通知',
    TEMPLATE_CARD: '模板卡片',
    INTERACTIVE_TASKCARD: '交互任务卡片',
  }
  return labels[kind] ?? kind
}

export function cloneMessageDraft(message: MessageDraft): MessageDraft {
  return {
    kind: message.kind,
    // 弹窗打开时传入的是 Vue 响应式草稿，Proxy 不能被 structuredClone 直接复制。
    payload: structuredClone(toRaw(message.payload)),
    mediaPolicy: structuredClone(toRaw(message.mediaPolicy)),
    enabled: message.enabled,
  }
}

export function messageDraftSnapshot(message: MessageDraft): string {
  return JSON.stringify(message)
}

/** 新增消息即使保留默认值也必须回写；编辑已有消息未改动则只关闭。 */
export function shouldApplyMessageDraft(isEditing: boolean, dirty: boolean): boolean {
  return isEditing ? dirty : true
}

export function createDefaultMessageDraft(
  kind: MessageKind,
  context: Pick<MessageEditorContext, 'mediaMaxCount' | 'mediaSources'>,
): MessageDraft {
  if (kind === 'TEXT') {
    return {
      kind,
      payload: { title: null, content: '', linkUrl: null },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'MPNEWS') {
    return {
      kind,
      payload: {
        cover: null,
        title: '',
        author: null,
        digest: null,
        contentSourceUrl: null,
        content: '',
      },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'MARKDOWN' || kind === 'MARKDOWN_V2') {
    return {
      kind,
      payload: { content: '' },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'TEXTCARD') {
    return {
      kind,
      payload: {
        title: '',
        description: '',
        url: '',
        btntxt: null,
      },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'FILE') {
    return {
      kind,
      payload: {
        mediaAssetId: null,
        filename: null,
      },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'NEWS') {
    return {
      kind,
      payload: {
        articles: [{
          title: '',
          description: null,
          url: '',
          imageAssetId: null,
        }],
      },
      mediaPolicy: {},
      enabled: true,
    }
  }
  if (kind === 'IMAGE') {
    return {
      kind,
      payload: {},
      mediaPolicy: {
        sourceKeys: [...context.mediaSources],
        maxCount: Math.max(1, context.mediaMaxCount),
      },
      enabled: true,
    }
  }
  return { kind, payload: {}, mediaPolicy: {}, enabled: true }
}

export function imageSourceKeys(mediaPolicy: unknown, allSources: readonly string[]): string[] {
  const record = asRecord(mediaPolicy)
  const value = record?.sourceKeys
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value.length === 0 ? [...allSources] : [...value]
  }
  return [...allSources]
}

export function imageMaxCount(mediaPolicy: unknown): number {
  const value = asRecord(mediaPolicy)?.maxCount
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1
}

/** 按正文顺序提取业务图片占位来源；同一来源可出现多次。 */
export function extractMediaSourceKeys(html: string): string[] {
  const keys: string[] = []
  for (const match of html.matchAll(/\bdata-media-source\s*=\s*["']([^"']+)["']/giu)) {
    if (match[1] !== undefined) {
      keys.push(match[1])
    }
  }
  return keys
}

/** 去掉全部图片后是否仍有可见文字；业务图片占位不能作为正文唯一内容。 */
export function hasStaticTextOutsideImages(html: string): boolean {
  return html
    .replace(/<img\b[^>]*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .trim()
    .length > 0
}

/** 服务端字段可能是 cover.mediaAssetId 这类嵌套路径，编辑器按顶层控件归并。 */
export function normalizeMessageField(field: string | null | undefined): string {
  if (field === null || field === undefined || field.trim().length === 0) {
    return 'message'
  }
  return field.startsWith('cover.') ? 'cover' : field
}

export function messageFieldLabel(field: string): string {
  const normalized = normalizeMessageField(field)
  return MESSAGE_FIELD_LABELS[normalized] ?? normalized
}

export function normalizeServerIssues(
  issues: readonly MessageServerIssueInput[],
): MessageServerIssue[] {
  return issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    channel: issue.channel === 'IN_APP' || issue.channel === 'WECOM' ? issue.channel : null,
    itemIndex: typeof issue.itemIndex === 'number'
      && Number.isInteger(issue.itemIndex)
      && issue.itemIndex >= 0
      ? issue.itemIndex
      : null,
    field: typeof issue.field === 'string' && issue.field.trim().length > 0 ? issue.field : null,
  }))
}

export function serverErrorsForMessage(
  issues: readonly MessageServerIssue[],
  channel: MessageChannel,
  itemIndex: number,
): Record<string, string> {
  const grouped = new Map<string, string[]>()
  for (const issue of issues) {
    if (issue.channel !== channel || issue.itemIndex !== itemIndex) {
      continue
    }
    const field = normalizeMessageField(issue.field)
    const messages = grouped.get(field) ?? []
    messages.push(issue.message)
    grouped.set(field, messages)
  }
  return Object.fromEntries([...grouped.entries()].map(([field, messages]) => [field, messages.join('；')]))
}

export function insertAtSelection(
  value: string,
  token: string,
  start: number,
  end: number,
): { readonly value: string, readonly cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length))
  const safeEnd = Math.max(safeStart, Math.min(end, value.length))
  return {
    value: `${value.slice(0, safeStart)}${token}${value.slice(safeEnd)}`,
    cursor: safeStart + token.length,
  }
}

export function filterVariables(
  variables: readonly NotificationEventVariableDto[],
  keyword: string,
): NotificationEventVariableDto[] {
  const normalized = keyword.trim().toLowerCase()
  if (normalized.length === 0) {
    return [...variables]
  }
  return variables.filter(variable =>
    variable.name.toLowerCase().includes(normalized)
    || variable.label.toLowerCase().includes(normalized)
    || variable.description.toLowerCase().includes(normalized)
    || variable.example.toLowerCase().includes(normalized),
  )
}

export function validateMessageDraft(
  message: MessageDraft,
  context: MessageEditorContext,
): MessageValidationIssue[] {
  const issues: MessageValidationIssue[] = []
  const add = (field: string, messageText: string): void => {
    issues.push({ field, message: messageText })
  }
  const payload = asRecord(message.payload)

  if (message.kind === 'TEXT') {
    const content = stringValue(payload, 'content')
    const title = optionalString(payload, 'title')
    const linkUrl = optionalString(payload, 'linkUrl')
    if (content.trim().length === 0) {
      add('content', '正文不能为空')
    }
    else if (context.channel === 'IN_APP' && content.length > IN_APP_TEXT_MAX_LENGTH) {
      add('content', `站内正文不能超过 ${IN_APP_TEXT_MAX_LENGTH} 字符`)
    }
    else if (context.channel === 'WECOM' && bytesOf(content) > TEXT_MAX_BYTES) {
      add('content', `企业微信正文不能超过 ${TEXT_MAX_BYTES} 字节`)
    }
    if (title !== null && bytesOf(title) > 200) {
      add('title', '标题不能超过 200 字节')
    }
    if (linkUrl !== null && !isHttpUrl(linkUrl)) {
      add('linkUrl', '链接必须是 http/https URL')
    }
    validateVariables([
      ['title', title],
      ['content', content],
      ['linkUrl', linkUrl],
    ], context, add)
    return issues
  }

  if (message.kind === 'MARKDOWN' || message.kind === 'MARKDOWN_V2') {
    const content = stringValue(payload, 'content')
    const maxBytes = context.sendMethod === 'ROBOT' ? 4_096 : 2_048
    if (content.trim().length === 0) {
      add('content', '内容不能为空')
    }
    else if (bytesOf(content) > maxBytes) {
      add('content', `Markdown 内容不能超过 ${maxBytes} 字节`)
    }
    if (containsUnsafeHtml(content)) {
      add('content', '内容包含不支持的 HTML 或不安全内容')
    }
    validateVariables([['content', content]], context, add)
    return issues
  }

  if (message.kind === 'TEXTCARD') {
    const title = stringValue(payload, 'title')
    const description = stringValue(payload, 'description')
    const url = stringValue(payload, 'url')
    const btntxt = optionalString(payload, 'btntxt')
    if (title.trim().length === 0) {
      add('title', '标题不能为空')
    }
    else if (bytesOf(title) > 128) {
      add('title', '标题不能超过 128 字节')
    }
    if (description.trim().length === 0) {
      add('description', '描述不能为空')
    }
    else if (bytesOf(description) > 512) {
      add('description', '描述不能超过 512 字节')
    }
    if (url.length > 2_048 || !isHttpUrl(url)) {
      add('url', '链接必须是有效的 http/https URL')
    }
    if (btntxt !== null && bytesOf(btntxt) > 16) {
      add('btntxt', '按钮文字不能超过 16 字节')
    }
    validateVariables([
      ['title', title],
      ['description', description],
      ['url', url],
      ['btntxt', btntxt],
    ], context, add)
    return issues
  }

  if (message.kind === 'NEWS') {
    const rawArticles = Array.isArray(payload?.articles) ? payload.articles : []
    if (rawArticles.length < 1 || rawArticles.length > 8) {
      add('articles', '图文卡片必须包含 1–8 篇文章')
      return issues
    }
    rawArticles.forEach((rawArticle, index) => {
      const article = asRecord(rawArticle)
      const title = stringValue(article, 'title')
      const description = optionalString(article, 'description')
      const url = stringValue(article, 'url')
      const imageAssetId = optionalString(article, 'imageAssetId')
      const prefix = `articles.${index}`
      if (title.trim().length === 0) {
        add(`${prefix}.title`, '标题不能为空')
      }
      else if (bytesOf(title) > 128) {
        add(`${prefix}.title`, '标题不能超过 128 字节')
      }
      if (description !== null && bytesOf(description) > 512) {
        add(`${prefix}.description`, '描述不能超过 512 字节')
      }
      if (url.length > 2_048 || !isHttpUrl(url)) {
        add(`${prefix}.url`, '链接必须是有效的 http/https URL')
      }
      if (imageAssetId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(imageAssetId)) {
        add(`${prefix}.imageAssetId`, '图片资产 ID 无效')
      }
      validateVariables([
        [`${prefix}.title`, title],
        [`${prefix}.description`, description],
        [`${prefix}.url`, url],
      ], context, add)
    })
    return issues
  }

  if (message.kind === 'FILE') {
    const fixedAssetId = stringValue(payload, 'mediaAssetId')
    const filename = optionalString(payload, 'filename')
    const policy = asRecord(message.mediaPolicy)
    const sourceKeys = Array.isArray(policy?.sourceKeys)
      ? policy.sourceKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : []
    const hasFixed = fixedAssetId.length > 0
    const hasDynamic = sourceKeys.length > 0
    if (hasFixed && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(fixedAssetId)) {
      add('mediaAssetId', '文件资产 ID 无效')
    }
    if (filename !== null && filename.length > 255) {
      add('filename', '文件名不能超过 255 字符')
    }
    if (hasFixed && hasDynamic) {
      add('mediaPolicy', '不能同时使用固定文件和业务附件')
    }
    if (!hasFixed && !hasDynamic) {
      add('mediaAssetId', '请上传文件或选择业务附件来源')
    }
    if (hasDynamic) {
      const unknown = sourceKeys.filter(key => !context.mediaSources.includes(key))
      if (unknown.length > 0) {
        add('mediaPolicy', `文件来源未声明：${unknown.join('、')}`)
      }
      if (policy?.maxCount !== 1) {
        add('mediaPolicy', '文件消息只能配置一个业务附件')
      }
    }
    return issues
  }

  if (message.kind === 'IMAGE') {
    const policy = asRecord(message.mediaPolicy)
    const sourceKeys = policy?.sourceKeys
    const maxCount = policy?.maxCount
    if (!Array.isArray(sourceKeys) || !sourceKeys.every(key => typeof key === 'string')) {
      add('mediaPolicy', '图片附件来源配置无效')
    }
    else {
      const unknown = sourceKeys.filter((key): key is string => typeof key === 'string' && !context.mediaSources.includes(key))
      if (unknown.length > 0) {
        add('mediaPolicy', `图片附件来源未声明：${unknown.join('、')}`)
      }
    }
    if (
      typeof maxCount !== 'number'
      || !Number.isInteger(maxCount)
      || maxCount < 1
      || maxCount > context.mediaMaxCount
    ) {
      add('maxCount', `图片附件数量必须在 1 到 ${context.mediaMaxCount} 之间`)
    }
    return issues
  }

  if (message.kind === 'MPNEWS') {
    const cover = asRecord(payload?.cover)
    const coverAssetId = typeof cover?.mediaAssetId === 'string' ? cover.mediaAssetId.trim() : ''
    const title = stringValue(payload, 'title')
    const author = optionalString(payload, 'author')
    const digest = optionalString(payload, 'digest')
    const sourceUrl = optionalString(payload, 'contentSourceUrl')
    const content = stringValue(payload, 'content')
    if (coverAssetId.length === 0) {
      add('cover', '必须选择固定封面')
    }
    if (title.trim().length === 0) {
      add('title', '标题不能为空')
    }
    else if (bytesOf(title) > 128) {
      add('title', '标题不能超过 128 字节')
    }
    if (author !== null && bytesOf(author) > 64) {
      add('author', '作者不能超过 64 字节')
    }
    if (digest !== null && bytesOf(digest) > 512) {
      add('digest', '摘要不能超过 512 字节')
    }
    if (sourceUrl !== null && !/^https?:\/\//iu.test(sourceUrl)) {
      add('contentSourceUrl', '阅读原文必须是 http/https URL')
    }
    if (textIsVisuallyEmpty(content)) {
      add('content', '正文不能为空')
    }
    else if (bytesOf(content) > MPNEWS_MAX_CONTENT_BYTES) {
      add('content', '正文不能超过 666KB')
    }
    if (containsUnsafeHtml(content)) {
      add('content', '正文包含不支持的 HTML 或不安全内容')
    }
    const mediaSourceKeys = extractMediaSourceKeys(content)
    if (mediaSourceKeys.length > 0) {
      const unknown = [...new Set(mediaSourceKeys.filter(key => !context.mediaSources.includes(key)))]
      if (unknown.length > 0) {
        add('content', `正文业务图片来源未声明：${unknown.join('、')}`)
      }
      if (mediaSourceKeys.length > context.mediaMaxCount) {
        add('content', `正文业务图片占位不能超过 ${context.mediaMaxCount} 个`)
      }
      if (!hasStaticTextOutsideImages(content)) {
        add('content', '正文包含业务图片占位时必须保留静态文字')
      }
    }
    validateVariables([
      ['title', title],
      ['author', author],
      ['digest', digest],
      ['contentSourceUrl', sourceUrl],
      ['content', content],
    ], context, add)
  }

  return issues
}
