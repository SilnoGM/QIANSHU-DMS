import { createHash } from 'node:crypto'

export const NOTIFICATION_SEND_METHODS = ['IN_APP', 'APP', 'ROBOT'] as const
export type NotificationSendMethodValue = (typeof NOTIFICATION_SEND_METHODS)[number]

export const NOTIFICATION_MESSAGE_KINDS = [
  'TEXT',
  'MARKDOWN',
  'MARKDOWN_V2',
  'IMAGE',
  'VOICE',
  'VIDEO',
  'FILE',
  'TEXTCARD',
  'NEWS',
  'MPNEWS',
  'MINIPROGRAM_NOTICE',
  'TEMPLATE_CARD',
  'INTERACTIVE_TASKCARD',
] as const
export type NotificationMessageKindValue = (typeof NOTIFICATION_MESSAGE_KINDS)[number]

/**
 * 阶段一实际开放的内容类型。模型枚举保留全部类型，后续按类型补齐校验与传输，
 * 不能把“枚举里存在”误当成“管理端可配置”。
 */
export const IMPLEMENTED_MESSAGE_KINDS_BY_METHOD: Readonly<Record<NotificationSendMethodValue, readonly NotificationMessageKindValue[]>> = Object.freeze({
  IN_APP: ['TEXT'],
  APP: ['TEXT', 'MPNEWS', 'IMAGE'],
  ROBOT: ['TEXT', 'IMAGE'],
})

export const MPNEWS_MAX_CONTENT_BYTES = 666 * 1024
export const TEXT_MAX_BYTES = 2_048
export const IN_APP_TEXT_MAX_LENGTH = 2_000
const MAX_TITLE_BYTES = 128
const MAX_AUTHOR_BYTES = 64
const MAX_DIGEST_BYTES = 512

export interface NotificationTextPayload {
  readonly title?: string | null
  readonly content: string
  readonly linkUrl?: string | null
}

export interface NotificationMpnewsPayload {
  readonly cover: { readonly mediaAssetId: string }
  readonly title: string
  readonly author?: string | null
  readonly digest?: string | null
  readonly contentSourceUrl?: string | null
  readonly content: string
}

/**
 * 图片附件项不绑定固定资产，而是在发布时从业务命令传入的 media 中按来源键选取。
 * `sourceKeys` 为空表示事件契约声明的全部来源；`maxCount` 是该消息项的数量上限。
 */
export interface NotificationImageMediaPolicy {
  readonly sourceKeys: readonly string[]
  readonly maxCount: number
}

export interface NotificationContentItemInput {
  readonly kind: NotificationMessageKindValue
  readonly payload: unknown
  readonly mediaPolicy?: unknown
  readonly enabled?: boolean
  readonly sortOrder?: number
}

export interface NormalizedNotificationContentItem {
  readonly kind: NotificationMessageKindValue
  readonly payload: NotificationTextPayload | NotificationMpnewsPayload | Record<string, never>
  readonly mediaPolicy: unknown
  readonly enabled: boolean
  readonly sortOrder: number
  readonly contentHash: string
}

export interface NotificationContentIssue {
  readonly code: string
  readonly message: string
  readonly itemIndex?: number
  readonly field?: string
}

export type NotificationContentValidationResult =
  | { readonly ok: true, readonly items: readonly NormalizedNotificationContentItem[] }
  | { readonly ok: false, readonly issues: readonly NotificationContentIssue[] }

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu
const SINGLE_BRACE_PATTERN = /(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})/gu
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

function bytesOf(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function issue(code: string, message: string, itemIndex?: number, field?: string): NotificationContentIssue {
  return { code, message, ...(itemIndex === undefined ? {} : { itemIndex }), ...(field === undefined ? {} : { field }) }
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

/**
 * mpnews 正文的严格白名单校验。
 *
 * 这不是“发现危险标签再拒绝”的黑名单：除下方允许的标签/属性外，任何未知标签、
 * 未声明属性、未加引号的属性、注释、DOCTYPE 或错误嵌套都直接拒绝保存/发布。
 * 采用拒绝而不是剥离，避免解析器差异把被剥离的片段重新解释成可执行 HTML。
 */
const MPNEWS_ALLOWED_TAGS = new Set([
  'p', 'br', 'h2', 'h3',
  'strong', 'b', 'em', 'i', 'u', 's', 'del',
  'ul', 'ol', 'li', 'blockquote',
  'a', 'img', 'pre', 'code', 'hr',
])
const MPNEWS_VOID_TAGS = new Set(['br', 'hr', 'img'])
const MPNEWS_ALLOWED_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['data-asset-id', 'alt']),
}
const MPNEWS_TAG_PATTERN = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(\/)?>/gu
const MPNEWS_ATTRIBUTE_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu

function parseMpnewsAttributes(raw: string): Map<string, string> | null {
  const attributes = new Map<string, string>()
  let cursor = 0
  for (const match of raw.matchAll(MPNEWS_ATTRIBUTE_PATTERN)) {
    const index = match.index ?? 0
    if (raw.slice(cursor, index).trim().length > 0) {
      return null
    }
    const name = match[1]?.toLowerCase()
    if (name === undefined || attributes.has(name)) {
      return null
    }
    attributes.set(name, match[2] ?? match[3] ?? '')
    cursor = index + match[0].length
  }
  return raw.slice(cursor).trim().length === 0 ? attributes : null
}

function isSafeLinkRel(value: string): boolean {
  const tokens = value.trim().split(/\s+/u)
  return tokens.length > 0 && tokens.every(token => ['noopener', 'noreferrer', 'nofollow'].includes(token))
}

function validateMpnewsHtmlStructure(value: string): string | null {
  const stack: string[] = []
  let cursor = 0

  for (const match of value.matchAll(MPNEWS_TAG_PATTERN)) {
    const index = match.index ?? 0
    if (value.slice(cursor, index).includes('<')) {
      return '正文包含无法解析的 HTML'
    }
    cursor = index + match[0].length
    const closing = match[1] === '/'
    const name = match[2]?.toLowerCase() ?? ''
    const rawAttributes = match[3] ?? ''
    const selfClosing = match[4] === '/'

    if (!MPNEWS_ALLOWED_TAGS.has(name)) {
      return `正文包含不支持的 HTML 标签：${name}`
    }
    if (closing) {
      if (selfClosing || rawAttributes.trim().length > 0) {
        return '正文 HTML 闭合标签格式无效'
      }
      if (MPNEWS_VOID_TAGS.has(name) || stack.pop() !== name) {
        return '正文 HTML 标签嵌套不正确'
      }
      continue
    }

    const attributes = parseMpnewsAttributes(rawAttributes)
    if (attributes === null) {
      return '正文 HTML 属性格式无效'
    }
    const allowedAttributes = MPNEWS_ALLOWED_ATTRIBUTES[name] ?? new Set<string>()
    for (const [attribute, attributeValue] of attributes) {
      if (!allowedAttributes.has(attribute)) {
        return `正文 HTML 标签 ${name} 不允许属性 ${attribute}`
      }
      if (name === 'a' && attribute === 'href' && !isHttpUrl(attributeValue)) {
        return '正文链接必须是 http/https URL'
      }
      if (name === 'a' && attribute === 'target' && attributeValue !== '_blank') {
        return '正文链接 target 只允许 _blank'
      }
      if (name === 'a' && attribute === 'rel' && !isSafeLinkRel(attributeValue)) {
        return '正文链接 rel 只允许 noopener/noreferrer/nofollow'
      }
      if (name === 'img' && attribute === 'data-asset-id' && !UUID_PATTERN.test(attributeValue)) {
        return '正文图片必须引用有效的 DMS 资产'
      }
    }
    if (name === 'a' && !attributes.has('href')) {
      return '正文链接必须包含 href'
    }
    if (name === 'img' && !attributes.has('data-asset-id')) {
      return '正文图片必须使用 DMS 资产'
    }
    if (MPNEWS_VOID_TAGS.has(name)) {
      continue
    }
    if (selfClosing) {
      return '正文 HTML 标签格式无效'
    }
    stack.push(name)
  }

  if (value.slice(cursor).includes('<')) {
    return '正文包含无法解析的 HTML'
  }
  return stack.length === 0 ? null : '正文 HTML 标签未闭合'
}

/**
 * 模板变量与单花括号检查。事件变量契约未知时只拦截单花括号，避免误伤历史事件。
 */
function inspectContentPlaceholders(input: {
  readonly texts: readonly string[]
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
  readonly field: string
}): NotificationContentIssue[] {
  const issues: NotificationContentIssue[] = []
  const placeholders = new Set<string>()
  for (const text of input.texts) {
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      if (match[1] !== undefined) {
        placeholders.add(match[1])
      }
    }
    for (const match of text.matchAll(SINGLE_BRACE_PATTERN)) {
      if (match[1] !== undefined) {
        issues.push(issue(
          'NOTIFICATION_CONTENT_SINGLE_BRACE',
          `内容占位符必须使用双花括号：${match[1]}`,
          input.itemIndex,
          input.field,
        ))
      }
    }
  }
  if (input.allowedVariables !== null) {
    for (const name of placeholders) {
      if (!input.allowedVariables.includes(name)) {
        issues.push(issue(
          'NOTIFICATION_CONTENT_UNDECLARED_VARIABLE',
          `内容包含未声明变量：${name}`,
          input.itemIndex,
          input.field,
        ))
      }
    }
  }
  return issues
}

function validateText(input: {
  readonly payload: unknown
  readonly method: NotificationSendMethodValue
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
}): { readonly payload?: NotificationTextPayload, readonly issues: readonly NotificationContentIssue[] } {
  const record = asRecord(input.payload)
  const content = asTrimmedString(record?.content)
  if (content === null || content.length === 0) {
    return { issues: [issue('NOTIFICATION_CONTENT_TEXT_EMPTY', '文本内容不能为空', input.itemIndex, 'content')] }
  }
  const title = record?.title === null || record?.title === undefined ? null : asTrimmedString(record.title)
  const linkUrl = record?.linkUrl === null || record?.linkUrl === undefined ? null : asTrimmedString(record.linkUrl)
  const issues: NotificationContentIssue[] = []
  if (title !== null && bytesOf(title) > 200) {
    issues.push(issue('NOTIFICATION_CONTENT_TITLE_TOO_LONG', '文本标题不能超过 200 字节', input.itemIndex, 'title'))
  }
  if (linkUrl !== null && (linkUrl.length === 0 || !isHttpUrl(linkUrl))) {
    issues.push(issue('NOTIFICATION_CONTENT_LINK_INVALID', '链接必须是 http/https URL', input.itemIndex, 'linkUrl'))
  }
  if (input.method === 'IN_APP') {
    if (content.length > IN_APP_TEXT_MAX_LENGTH) {
      issues.push(issue('NOTIFICATION_CONTENT_TEXT_TOO_LONG', `站内文本不能超过 ${IN_APP_TEXT_MAX_LENGTH} 字符`, input.itemIndex, 'content'))
    }
  }
  else if (bytesOf(content) > TEXT_MAX_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXT_TOO_LONG', `企业微信文本不能超过 ${TEXT_MAX_BYTES} 字节`, input.itemIndex, 'content'))
  }
  issues.push(...inspectContentPlaceholders({
    texts: [title ?? '', content, linkUrl ?? ''],
    allowedVariables: input.allowedVariables,
    itemIndex: input.itemIndex,
    field: 'content',
  }))
  return {
    ...(issues.length === 0 ? { payload: { title, content, linkUrl } } : {}),
    issues,
  }
}

function validateMpnews(input: {
  readonly payload: unknown
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
}): { readonly payload?: NotificationMpnewsPayload, readonly issues: readonly NotificationContentIssue[] } {
  const record = asRecord(input.payload)
  const issues: NotificationContentIssue[] = []
  const cover = asRecord(record?.cover)
  const mediaAssetId = asTrimmedString(cover?.mediaAssetId)
  if (mediaAssetId === null || !UUID_PATTERN.test(mediaAssetId)) {
    issues.push(issue('NOTIFICATION_CONTENT_COVER_INVALID', 'mpnews 必须配置有效的封面资产', input.itemIndex, 'cover.mediaAssetId'))
  }

  const title = asTrimmedString(record?.title)
  if (title === null || title.length === 0) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_TITLE_EMPTY', 'mpnews 标题不能为空', input.itemIndex, 'title'))
  }
  else if (bytesOf(title) > MAX_TITLE_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_TITLE_TOO_LONG', 'mpnews 标题不能超过 128 字节', input.itemIndex, 'title'))
  }

  const author = record?.author === null || record?.author === undefined ? null : asTrimmedString(record.author)
  if (author !== null && bytesOf(author) > MAX_AUTHOR_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_AUTHOR_TOO_LONG', 'mpnews 作者不能超过 64 字节', input.itemIndex, 'author'))
  }

  const digest = record?.digest === null || record?.digest === undefined ? null : asTrimmedString(record.digest)
  if (digest !== null && bytesOf(digest) > MAX_DIGEST_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_DIGEST_TOO_LONG', 'mpnews 摘要不能超过 512 字节', input.itemIndex, 'digest'))
  }

  const contentSourceUrl = record?.contentSourceUrl === null || record?.contentSourceUrl === undefined
    ? null
    : asTrimmedString(record.contentSourceUrl)
  if (contentSourceUrl !== null && (contentSourceUrl.length === 0 || !isHttpUrl(contentSourceUrl))) {
    issues.push(issue('NOTIFICATION_CONTENT_LINK_INVALID', '阅读原文链接必须是 http/https URL', input.itemIndex, 'contentSourceUrl'))
  }

  const content = typeof record?.content === 'string' ? record.content : ''
  if (content.trim().length === 0) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_CONTENT_EMPTY', 'mpnews 正文不能为空', input.itemIndex, 'content'))
  }
  else if (bytesOf(content) > MPNEWS_MAX_CONTENT_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_CONTENT_TOO_LONG', 'mpnews 正文不能超过 666KB', input.itemIndex, 'content'))
  }
  const htmlIssue = validateMpnewsHtmlStructure(content)
  if (htmlIssue !== null) {
    issues.push(issue('NOTIFICATION_CONTENT_HTML_UNSAFE', htmlIssue, input.itemIndex, 'content'))
  }
  issues.push(...inspectContentPlaceholders({
    texts: [title ?? '', digest ?? '', content, contentSourceUrl ?? ''],
    allowedVariables: input.allowedVariables,
    itemIndex: input.itemIndex,
    field: 'content',
  }))

  return {
    ...(issues.length === 0
      ? {
          payload: {
            cover: { mediaAssetId: mediaAssetId! },
            title: title!,
            author,
            digest,
            contentSourceUrl,
            content,
          },
        }
      : {}),
    issues,
  }
}

export function hashNotificationContent(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** 图片附件策略的唯一解析入口；保存校验与发布派发必须使用同一口径。 */
export function parseNotificationImageMediaPolicy(
  value: unknown,
): NotificationImageMediaPolicy | null {
  const record = asRecord(value)
  if (record === null || !Array.isArray(record.sourceKeys)) {
    return null
  }
  const sourceKeys: string[] = []
  for (const item of record.sourceKeys) {
    if (typeof item !== 'string') {
      return null
    }
    const sourceKey = item.trim()
    if (
      sourceKey.length === 0
      || sourceKey.length > 64
      || sourceKeys.includes(sourceKey)
    ) {
      return null
    }
    sourceKeys.push(sourceKey)
  }
  const maxCount = record.maxCount
  if (
    typeof maxCount !== 'number'
    || !Number.isSafeInteger(maxCount)
    || maxCount < 1
  ) {
    return null
  }
  return { sourceKeys, maxCount }
}

function validateImage(input: {
  readonly mediaPolicy: unknown
  readonly allowedSources: readonly string[] | null
  readonly maximumCount: number
  readonly itemIndex: number
}): {
  readonly mediaPolicy?: NotificationImageMediaPolicy
  readonly issues: readonly NotificationContentIssue[]
} {
  if (
    input.allowedSources === null
    || input.allowedSources.length === 0
    || input.maximumCount < 1
  ) {
    return {
      issues: [issue(
        'NOTIFICATION_CONTENT_MEDIA_UNSUPPORTED',
        '该事件未接入图片附件能力',
        input.itemIndex,
        'mediaPolicy',
      )],
    }
  }
  const mediaPolicy = parseNotificationImageMediaPolicy(input.mediaPolicy)
  if (mediaPolicy === null) {
    return {
      issues: [issue(
        'NOTIFICATION_CONTENT_MEDIA_POLICY_INVALID',
        '图片附件必须声明来源与数量上限',
        input.itemIndex,
        'mediaPolicy',
      )],
    }
  }
  const allowedSources = new Set(input.allowedSources)
  const undeclared = mediaPolicy.sourceKeys.filter(sourceKey => !allowedSources.has(sourceKey))
  if (undeclared.length > 0) {
    return {
      issues: [issue(
        'NOTIFICATION_CONTENT_MEDIA_SOURCE_INVALID',
        `图片附件来源未声明：${undeclared.join('、')}`,
        input.itemIndex,
        'mediaPolicy',
      )],
    }
  }
  if (mediaPolicy.maxCount > input.maximumCount) {
    return {
      issues: [issue(
        'NOTIFICATION_CONTENT_MEDIA_LIMIT_INVALID',
        `图片附件数量上限不能超过 ${input.maximumCount}`,
        input.itemIndex,
        'mediaPolicy',
      )],
    }
  }
  return { mediaPolicy, issues: [] }
}

export interface NotificationContentAssetIds {
  readonly coverAssetId: string | null
  readonly inlineAssetIds: readonly string[]
}

/** 从 mpnews payload 提取封面与正文图片资产 ID；其他类型返回空。 */
export function extractNotificationContentAssetIds(item: {
  readonly kind: string
  readonly payload: unknown
}): NotificationContentAssetIds {
  if (item.kind !== 'MPNEWS') {
    return { coverAssetId: null, inlineAssetIds: [] }
  }
  const record = asRecord(item.payload)
  const cover = asRecord(record?.cover)
  const coverAssetId = asTrimmedString(cover?.mediaAssetId)
  const content = typeof record?.content === 'string' ? record.content : ''
  const inline = new Set<string>()
  for (const match of content.matchAll(/\bdata-asset-id\s*=\s*["']([^"']+)["']/giu)) {
    if (match[1] !== undefined) {
      inline.add(match[1])
    }
  }
  return {
    coverAssetId: coverAssetId !== null && UUID_PATTERN.test(coverAssetId) ? coverAssetId : null,
    inlineAssetIds: [...inline].filter(assetId => UUID_PATTERN.test(assetId)),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

/**
 * mpnews 正文是 HTML，变量值必须按 HTML 文本上下文转义；变量替换前后都执行严格白名单校验，
 * 防止存储层历史数据或绕过保存校验的写入进入企微正文。
 */
export function renderMpnewsHtml(input: {
  readonly html: string
  readonly variables: Readonly<Record<string, string | number | null>>
  readonly allowed: readonly {
    readonly name: string
    readonly required?: boolean
    readonly maxLength?: number
    readonly sensitive?: boolean
  }[]
  readonly allowSensitive: boolean
}): {
  readonly ok: true
  readonly content: string
  readonly warnings: readonly 'SENSITIVE_VARIABLE_MASKED'[]
} | {
  readonly ok: false
  readonly code: 'NOTIFICATION_CONTENT_UNDECLARED_VARIABLE' | 'NOTIFICATION_CONTENT_VARIABLE_MISSING' | 'NOTIFICATION_CONTENT_MPNEWS_TOO_LONG' | 'NOTIFICATION_CONTENT_HTML_UNSAFE'
  readonly message: string
} {
  const htmlIssue = validateMpnewsHtmlStructure(input.html)
  if (htmlIssue !== null) {
    return { ok: false, code: 'NOTIFICATION_CONTENT_HTML_UNSAFE', message: htmlIssue }
  }
  const definitions = new Map(input.allowed.map(definition => [definition.name, definition]))
  const warnings = new Set<'SENSITIVE_VARIABLE_MASKED'>()
  const state: { missing: string | null } = { missing: null }
  const rendered = input.html.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    const definition = definitions.get(name)
    if (definition === undefined) {
      state.missing = state.missing ?? `内容包含未声明变量：${name}`
      return ''
    }
    const value = input.variables[name]
    if ((value === undefined || value === null || value === '') && definition.required !== false) {
      state.missing = state.missing ?? `内容变量缺失：${name}`
      return ''
    }
    if (definition.sensitive === true && !input.allowSensitive) {
      warnings.add('SENSITIVE_VARIABLE_MASKED')
      return '***'
    }
    const raw = value === undefined || value === null ? '' : String(value)
    const maxLength = Math.max(1, Math.min(definition.maxLength ?? 1_500, 1_500))
    return escapeHtml(raw.length > maxLength ? `${raw.slice(0, Math.max(0, maxLength - 1))}…` : raw)
  })
  if (state.missing !== null) {
    return {
      ok: false,
      code: state.missing.startsWith('内容包含未声明变量')
        ? 'NOTIFICATION_CONTENT_UNDECLARED_VARIABLE'
        : 'NOTIFICATION_CONTENT_VARIABLE_MISSING',
      message: state.missing,
    }
  }
  if (bytesOf(rendered) > MPNEWS_MAX_CONTENT_BYTES) {
    return {
      ok: false,
      code: 'NOTIFICATION_CONTENT_MPNEWS_TOO_LONG',
      message: 'mpnews 正文渲染后超过 666KB',
    }
  }
  return { ok: true, content: rendered, warnings: [...warnings] }
}


/**
 * 渠道内容组的唯一校验入口。当前开放 TEXT、MPNEWS 与图片附件；未实现类型明确拒绝，
 * 不把模型枚举当成可用能力。
 */
export function validateNotificationContentGroup(input: {
  readonly method: NotificationSendMethodValue
  readonly items: readonly NotificationContentItemInput[]
  readonly allowedVariables: readonly string[] | null
  /** 事件契约声明的业务附件来源；图片附件项只能引用这里列出的键。 */
  readonly mediaSources?: readonly string[] | null
  /** 事件契约允许的单次附件数量上限。 */
  readonly mediaMaxCount?: number
}): NotificationContentValidationResult {
  const issues: NotificationContentIssue[] = []
  const allowedKinds = IMPLEMENTED_MESSAGE_KINDS_BY_METHOD[input.method]
  const enabledItems = input.items.filter(item => item.enabled !== false)
  if (enabledItems.length === 0) {
    return { ok: false, issues: [issue('NOTIFICATION_CONTENT_EMPTY', '消息内容不能为空')] }
  }
  if (input.method === 'IN_APP' && enabledItems.length !== 1) {
    issues.push(issue('NOTIFICATION_CONTENT_IN_APP_SINGLE_ITEM', '站内通知只允许一条文本消息'))
  }
  if (enabledItems.filter(item => item.kind === 'MPNEWS').length > 1) {
    issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_MULTIPLE', '同一渠道配置只允许一条 mpnews 消息'))
  }
  if (
    input.method !== 'IN_APP'
    && !enabledItems.some(item => item.kind === 'TEXT' || item.kind === 'MPNEWS')
  ) {
    // 企业微信派发以正文消息为投递主体，图片附件只跟在正文之后；纯图片配置没有可重试的正文。
    issues.push(issue('NOTIFICATION_CONTENT_TEXT_REQUIRED', '企业微信渠道至少需要一条文本消息'))
  }

  const normalized: NormalizedNotificationContentItem[] = []
  input.items.forEach((item, index) => {
    const allowed = allowedKinds.includes(item.kind)
    if (!allowed) {
      issues.push(issue(
        'NOTIFICATION_CONTENT_KIND_UNSUPPORTED',
        `当前发送方式不支持或尚未实现消息类型：${item.kind}`,
        index,
        'kind',
      ))
      return
    }
    if (item.kind === 'TEXT') {
      const result = validateText({
        payload: item.payload,
        method: input.method,
        allowedVariables: input.allowedVariables,
        itemIndex: index,
      })
      issues.push(...result.issues)
      if (result.payload !== undefined) {
        normalized.push({
          kind: item.kind,
          payload: result.payload,
          mediaPolicy: item.mediaPolicy ?? {},
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder ?? index,
          contentHash: hashNotificationContent({ kind: item.kind, payload: result.payload, mediaPolicy: item.mediaPolicy ?? {} }),
        })
      }
      return
    }
    if (item.kind === 'MPNEWS') {
      if (input.method !== 'APP') {
        issues.push(issue('NOTIFICATION_CONTENT_MPSNEWS_METHOD', 'mpnews 只允许用于企业微信应用消息', index, 'kind'))
        return
      }
      const result = validateMpnews({
        payload: item.payload,
        allowedVariables: input.allowedVariables,
        itemIndex: index,
      })
      issues.push(...result.issues)
      if (result.payload !== undefined) {
        normalized.push({
          kind: item.kind,
          payload: result.payload,
          mediaPolicy: item.mediaPolicy ?? {},
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder ?? index,
          contentHash: hashNotificationContent({ kind: item.kind, payload: result.payload, mediaPolicy: item.mediaPolicy ?? {} }),
        })
      }
      return
    }
    if (item.kind === 'IMAGE') {
      const result = validateImage({
        mediaPolicy: item.mediaPolicy,
        allowedSources: input.mediaSources ?? null,
        maximumCount: input.mediaMaxCount ?? 0,
        itemIndex: index,
      })
      issues.push(...result.issues)
      if (result.mediaPolicy !== undefined) {
        normalized.push({
          kind: item.kind,
          payload: {},
          mediaPolicy: result.mediaPolicy,
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder ?? index,
          contentHash: hashNotificationContent({ kind: item.kind, mediaPolicy: result.mediaPolicy }),
        })
      }
    }
  })

  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    items: normalized
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((item, index) => ({ ...item, sortOrder: index })),
  }
}
