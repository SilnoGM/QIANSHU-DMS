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
  APP: ['TEXT', 'MPNEWS'],
  ROBOT: ['TEXT'],
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

export interface NotificationContentItemInput {
  readonly kind: NotificationMessageKindValue
  readonly payload: unknown
  readonly mediaPolicy?: unknown
  readonly enabled?: boolean
  readonly sortOrder?: number
}

export interface NormalizedNotificationContentItem {
  readonly kind: NotificationMessageKindValue
  readonly payload: NotificationTextPayload | NotificationMpnewsPayload
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

function containsDangerousHtml(value: string): boolean {
  return /<(script|iframe|object|embed|form)\b/iu.test(value)
    || /\son[a-z]+\s*=/iu.test(value)
    || /\b(?:javascript|data):/iu.test(value)
}

function containsExternalOrInvalidImage(value: string): boolean {
  for (const match of value.matchAll(/<img\b[^>]*>/giu)) {
    const tag = match[0]
    if (!/\bdata-asset-id\s*=\s*["'][^"']+["']/iu.test(tag)) {
      return true
    }
    if (/\bsrc\s*=/iu.test(tag)) {
      return true
    }
  }
  return false
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
  if (containsDangerousHtml(content)) {
    issues.push(issue('NOTIFICATION_CONTENT_HTML_UNSAFE', 'mpnews 正文包含不支持的 HTML', input.itemIndex, 'content'))
  }
  if (containsExternalOrInvalidImage(content)) {
    issues.push(issue('NOTIFICATION_CONTENT_IMAGE_INVALID', 'mpnews 正文图片只能使用 DMS 资产，不能包含外部 src', input.itemIndex, 'content'))
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
 * mpnews 正文是 HTML，变量值必须按 HTML 文本上下文转义；这里只做替换与转义，
 * 最终标签白名单仍由保存/派发前的 sanitize 负责。
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
  readonly code: 'NOTIFICATION_CONTENT_UNDECLARED_VARIABLE' | 'NOTIFICATION_CONTENT_VARIABLE_MISSING' | 'NOTIFICATION_CONTENT_MPNEWS_TOO_LONG'
  readonly message: string
} {
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
 * 渠道内容组的唯一校验入口。阶段一只开放 TEXT 与 MPNEWS；未实现类型明确拒绝，
 * 不把模型枚举当成可用能力。
 */
export function validateNotificationContentGroup(input: {
  readonly method: NotificationSendMethodValue
  readonly items: readonly NotificationContentItemInput[]
  readonly allowedVariables: readonly string[] | null
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
