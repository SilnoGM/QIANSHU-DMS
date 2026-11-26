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
  APP: ['TEXT', 'MARKDOWN', 'TEXTCARD', 'NEWS', 'MPNEWS', 'FILE', 'IMAGE'],
  ROBOT: ['TEXT', 'MARKDOWN', 'MARKDOWN_V2', 'NEWS', 'FILE', 'IMAGE'],
})

export const MPNEWS_MAX_CONTENT_BYTES = 666 * 1024
export const TEXT_MAX_BYTES = 2_048
export const IN_APP_TEXT_MAX_LENGTH = 2_000
const MARKDOWN_APP_MAX_BYTES = 2_048
const MARKDOWN_ROBOT_MAX_BYTES = 4_096
const MAX_TITLE_BYTES = 128
const MAX_AUTHOR_BYTES = 64
const MAX_DIGEST_BYTES = 512
const TEXTCARD_DESCRIPTION_MAX_BYTES = 512
const TEXTCARD_URL_MAX_LENGTH = 2_048
const TEXTCARD_BUTTON_MAX_BYTES = 16
export const FILE_MAX_BYTES = 20n * 1_024n * 1_024n
const NEWS_MAX_ARTICLES = 8
const NEWS_ARTICLE_DESCRIPTION_MAX_BYTES = 512
const NEWS_ARTICLE_URL_MAX_LENGTH = 2_048

export interface NotificationFilePayload {
  readonly mediaAssetId: string | null
  readonly filename?: string | null
}

export interface NotificationNewsArticle {
  readonly title: string
  readonly description: string | null
  readonly url: string
  readonly imageAssetId: string | null
}

export interface NotificationNewsPayload {
  readonly articles: readonly NotificationNewsArticle[]
}

export interface NotificationMarkdownPayload {
  readonly content: string
}

export interface NotificationTextcardPayload {
  readonly title: string
  readonly description: string
  readonly url: string
  readonly btntxt?: string | null
}

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
  readonly payload: NotificationTextPayload | NotificationMpnewsPayload | NotificationMarkdownPayload | NotificationTextcardPayload | NotificationFilePayload | NotificationNewsPayload | Record<string, never>
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
  img: new Set(['data-asset-id', 'data-media-source', 'alt']),
}
const MPNEWS_MEDIA_SOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
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
      if (name === 'img' && attribute === 'data-media-source' && !MPNEWS_MEDIA_SOURCE_PATTERN.test(attributeValue)) {
        return '正文业务图片来源格式无效'
      }
    }
    if (name === 'a' && !attributes.has('href')) {
      return '正文链接必须包含 href'
    }
    if (name === 'img') {
      const hasAsset = attributes.has('data-asset-id')
      const hasMediaSource = attributes.has('data-media-source')
      if (!hasAsset && !hasMediaSource) {
        return '正文图片必须使用 DMS 资产或业务图片占位'
      }
      if (hasAsset && hasMediaSource) {
        return '正文图片不能同时声明 DMS 资产和业务图片占位'
      }
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

function validateMarkdown(input: {
  readonly payload: unknown
  readonly method: NotificationSendMethodValue
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
}): { readonly payload?: NotificationMarkdownPayload, readonly issues: readonly NotificationContentIssue[] } {
  const record = asRecord(input.payload)
  const content = typeof record?.content === 'string' ? record.content : ''
  const maxBytes = input.method === 'ROBOT' ? MARKDOWN_ROBOT_MAX_BYTES : MARKDOWN_APP_MAX_BYTES
  const issues: NotificationContentIssue[] = []
  if (content.trim().length === 0) {
    issues.push(issue('NOTIFICATION_CONTENT_MARKDOWN_EMPTY', 'Markdown 内容不能为空', input.itemIndex, 'content'))
  }
  else if (bytesOf(content) > maxBytes) {
    issues.push(issue('NOTIFICATION_CONTENT_MARKDOWN_TOO_LONG', `Markdown 内容不能超过 ${maxBytes} 字节`, input.itemIndex, 'content'))
  }
  if (/<(?:script|iframe|object|embed|form)\b|\son[a-z]+\s*=|\b(?:javascript|data):/iu.test(content)) {
    issues.push(issue('NOTIFICATION_CONTENT_MARKDOWN_UNSAFE', 'Markdown 内容包含不安全内容', input.itemIndex, 'content'))
  }
  issues.push(...inspectContentPlaceholders({
    texts: [content],
    allowedVariables: input.allowedVariables,
    itemIndex: input.itemIndex,
    field: 'content',
  }))
  return {
    ...(issues.length === 0 ? { payload: { content } } : {}),
    issues,
  }
}

function validateTextcard(input: {
  readonly payload: unknown
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
}): { readonly payload?: NotificationTextcardPayload, readonly issues: readonly NotificationContentIssue[] } {
  const record = asRecord(input.payload)
  const title = asTrimmedString(record?.title)
  const description = asTrimmedString(record?.description)
  const url = asTrimmedString(record?.url)
  const btntxt = record?.btntxt === null || record?.btntxt === undefined ? null : asTrimmedString(record.btntxt)
  const issues: NotificationContentIssue[] = []
  if (title === null || title.length === 0) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_TITLE_EMPTY', '文本卡片标题不能为空', input.itemIndex, 'title'))
  }
  else if (bytesOf(title) > MAX_TITLE_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_TITLE_TOO_LONG', '文本卡片标题不能超过 128 字节', input.itemIndex, 'title'))
  }
  if (description === null || description.length === 0) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_DESCRIPTION_EMPTY', '文本卡片描述不能为空', input.itemIndex, 'description'))
  }
  else if (bytesOf(description) > TEXTCARD_DESCRIPTION_MAX_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_DESCRIPTION_TOO_LONG', '文本卡片描述不能超过 512 字节', input.itemIndex, 'description'))
  }
  if (url === null || url.length === 0 || url.length > TEXTCARD_URL_MAX_LENGTH || !isHttpUrl(url)) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_URL_INVALID', '文本卡片链接必须是有效的 http/https URL', input.itemIndex, 'url'))
  }
  if (btntxt !== null && bytesOf(btntxt) > TEXTCARD_BUTTON_MAX_BYTES) {
    issues.push(issue('NOTIFICATION_CONTENT_TEXTCARD_BUTTON_TOO_LONG', '文本卡片按钮文字不能超过 16 字节', input.itemIndex, 'btntxt'))
  }
  issues.push(...inspectContentPlaceholders({
    texts: [title ?? '', description ?? '', url ?? '', btntxt ?? ''],
    allowedVariables: input.allowedVariables,
    itemIndex: input.itemIndex,
    field: 'content',
  }))
  return {
    ...(issues.length === 0
      ? {
          payload: {
            title: title!,
            description: description!,
            url: url!,
            btntxt,
          },
        }
      : {}),
    issues,
  }
}

function validateFile(input: {
  readonly payload: unknown
  readonly mediaPolicy: unknown
  readonly mediaSources: readonly string[] | null
  readonly itemIndex: number
}): {
  readonly payload?: NotificationFilePayload
  readonly mediaPolicy?: { readonly sourceKeys: readonly string[], readonly maxCount: 1 } | Record<string, never>
  readonly issues: readonly NotificationContentIssue[]
} {
  const record = asRecord(input.payload)
  const fixed = asTrimmedString(record?.mediaAssetId)
  const filename = record?.filename === null || record?.filename === undefined
    ? null
    : asTrimmedString(record.filename)
  const policy = asRecord(input.mediaPolicy)
  const rawSourceKeys = policy?.sourceKeys
  const sourceKeys = Array.isArray(rawSourceKeys)
    ? rawSourceKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
    : []
  const issues: NotificationContentIssue[] = []
  if (fixed !== null && !UUID_PATTERN.test(fixed)) {
    issues.push(issue('NOTIFICATION_CONTENT_FILE_ASSET_INVALID', '文件资产 ID 无效', input.itemIndex, 'mediaAssetId'))
  }
  if (filename !== null && filename.length > 255) {
    issues.push(issue('NOTIFICATION_CONTENT_FILE_FILENAME_TOO_LONG', '文件名不能超过 255 字符', input.itemIndex, 'filename'))
  }
  const hasFixed = fixed !== null && fixed.length > 0
  const hasDynamic = sourceKeys.length > 0
  if (hasFixed && hasDynamic) {
    issues.push(issue('NOTIFICATION_CONTENT_FILE_MEDIA_AMBIGUOUS', '文件消息不能同时使用固定资产和业务来源', input.itemIndex, 'mediaPolicy'))
  }
  if (!hasFixed && !hasDynamic) {
    issues.push(issue('NOTIFICATION_CONTENT_FILE_MEDIA_REQUIRED', '文件消息必须上传文件或选择业务来源', input.itemIndex, 'mediaPolicy'))
  }
  if (hasDynamic) {
    const declared = new Set(input.mediaSources ?? [])
    const unknown = sourceKeys.filter(key => !declared.has(key))
    if (unknown.length > 0) {
      issues.push(issue('NOTIFICATION_CONTENT_FILE_SOURCE_UNDECLARED', `文件来源未声明：${unknown.join('、')}`, input.itemIndex, 'mediaPolicy'))
    }
    if (policy?.maxCount !== undefined && policy.maxCount !== 1) {
      issues.push(issue('NOTIFICATION_CONTENT_FILE_LIMIT_INVALID', '文件消息只能配置一个业务附件', input.itemIndex, 'mediaPolicy'))
    }
  }
  return {
    ...(issues.length === 0
      ? {
          payload: { mediaAssetId: hasFixed ? fixed : null, filename },
          mediaPolicy: hasDynamic ? { sourceKeys, maxCount: 1 as const } : {},
        }
      : {}),
    issues,
  }
}

function validateNews(input: {
  readonly payload: unknown
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
}): { readonly payload?: NotificationNewsPayload, readonly issues: readonly NotificationContentIssue[] } {
  const record = asRecord(input.payload)
  const rawArticles = Array.isArray(record?.articles) ? record.articles : []
  const issues: NotificationContentIssue[] = []
  if (rawArticles.length < 1 || rawArticles.length > NEWS_MAX_ARTICLES) {
    issues.push(issue('NOTIFICATION_CONTENT_NEWS_ARTICLE_COUNT', `图文卡片必须包含 1–${NEWS_MAX_ARTICLES} 篇文章`, input.itemIndex, 'articles'))
    return { issues }
  }
  const articles: NotificationNewsArticle[] = []
  rawArticles.forEach((rawArticle, index) => {
    const article = asRecord(rawArticle)
    const title = asTrimmedString(article?.title)
    const descriptionText = article?.description === null || article?.description === undefined
      ? null
      : asTrimmedString(article.description)
    const description = descriptionText !== null && descriptionText.length > 0 ? descriptionText : null
    const url = asTrimmedString(article?.url)
    const imageText = article?.imageAssetId === null || article?.imageAssetId === undefined
      ? null
      : asTrimmedString(article.imageAssetId)
    const imageAssetId = imageText !== null && imageText.length > 0 ? imageText : null
    const fieldPrefix = `articles.${index}`
    if (title === null || title.length === 0) {
      issues.push(issue('NOTIFICATION_CONTENT_NEWS_TITLE_EMPTY', '图文卡片标题不能为空', input.itemIndex, `${fieldPrefix}.title`))
    }
    else if (bytesOf(title) > MAX_TITLE_BYTES) {
      issues.push(issue('NOTIFICATION_CONTENT_NEWS_TITLE_TOO_LONG', '图文卡片标题不能超过 128 字节', input.itemIndex, `${fieldPrefix}.title`))
    }
    if (description !== null && bytesOf(description) > NEWS_ARTICLE_DESCRIPTION_MAX_BYTES) {
      issues.push(issue('NOTIFICATION_CONTENT_NEWS_DESCRIPTION_TOO_LONG', '图文卡片描述不能超过 512 字节', input.itemIndex, `${fieldPrefix}.description`))
    }
    if (url === null || url.length === 0 || url.length > NEWS_ARTICLE_URL_MAX_LENGTH || !isHttpUrl(url)) {
      issues.push(issue('NOTIFICATION_CONTENT_NEWS_URL_INVALID', '图文卡片链接必须是有效的 http/https URL', input.itemIndex, `${fieldPrefix}.url`))
    }
    if (imageAssetId !== null && !UUID_PATTERN.test(imageAssetId)) {
      issues.push(issue('NOTIFICATION_CONTENT_NEWS_IMAGE_INVALID', '图文卡片图片资产 ID 无效', input.itemIndex, `${fieldPrefix}.imageAssetId`))
    }
    issues.push(...inspectContentPlaceholders({
      texts: [title ?? '', description ?? '', url ?? ''],
      allowedVariables: input.allowedVariables,
      itemIndex: input.itemIndex,
      field: fieldPrefix,
    }))
    articles.push({
      title: title ?? '',
      description,
      url: url ?? '',
      imageAssetId,
    })
  })
  return {
    ...(issues.length === 0 ? { payload: { articles } } : {}),
    issues,
  }
}

function validateMpnews(input: {
  readonly payload: unknown
  readonly allowedVariables: readonly string[] | null
  readonly itemIndex: number
  readonly mediaSources?: readonly string[] | null
  readonly mediaMaxCount?: number
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
  // 作者会参与变量渲染，保存阶段必须与标题/正文使用同一套占位符校验。
  if (author !== null) {
    issues.push(...inspectContentPlaceholders({
      texts: [author],
      allowedVariables: input.allowedVariables,
      itemIndex: input.itemIndex,
      field: 'author',
    }))
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
  else {
    const mediaSourceSlots = extractMpnewsMediaSourceSlots(content)
    if (mediaSourceSlots.length > 0) {
      const declaredSources = new Set(input.mediaSources ?? [])
      const undeclared = [...new Set(mediaSourceSlots.filter(sourceKey => !declaredSources.has(sourceKey)))]
      if (undeclared.length > 0) {
        issues.push(issue(
          'NOTIFICATION_CONTENT_MEDIA_SOURCE_UNDECLARED',
          `正文业务图片来源未声明：${undeclared.join('、')}`,
          input.itemIndex,
          'content',
        ))
      }
      if (mediaSourceSlots.length > (input.mediaMaxCount ?? 0)) {
        issues.push(issue(
          'NOTIFICATION_CONTENT_INLINE_MEDIA_LIMIT',
          `正文业务图片占位不能超过 ${input.mediaMaxCount ?? 0} 个`,
          input.itemIndex,
          'content',
        ))
      }
      if (!mpnewsHasStaticTextOutsideImages(content)) {
        issues.push(issue(
          'NOTIFICATION_CONTENT_MPSNEWS_STATIC_TEXT_REQUIRED',
          '正文包含业务图片占位时必须保留静态文字',
          input.itemIndex,
          'content',
        ))
      }
    }
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
  readonly fileAssetId: string | null
  readonly newsImageAssetIds: readonly string[]
}

/** 从内容 payload 提取固定媒体资产 ID；业务动态来源不在此列。 */
export function extractNotificationContentAssetIds(item: {
  readonly kind: string
  readonly payload: unknown
}): NotificationContentAssetIds {
  const record = asRecord(item.payload)
  if (item.kind === 'FILE') {
    const fileAssetId = asTrimmedString(record?.mediaAssetId)
    return {
      coverAssetId: null,
      inlineAssetIds: [],
      fileAssetId: fileAssetId !== null && UUID_PATTERN.test(fileAssetId) ? fileAssetId : null,
      newsImageAssetIds: [],
    }
  }
  if (item.kind === 'NEWS') {
    const articles = Array.isArray(record?.articles) ? record.articles : []
    const imageAssetIds = new Set<string>()
    for (const rawArticle of articles) {
      const article = asRecord(rawArticle)
      const imageAssetId = asTrimmedString(article?.imageAssetId)
      if (imageAssetId !== null && UUID_PATTERN.test(imageAssetId)) {
        imageAssetIds.add(imageAssetId)
      }
    }
    return {
      coverAssetId: null,
      inlineAssetIds: [],
      fileAssetId: null,
      newsImageAssetIds: [...imageAssetIds],
    }
  }
  if (item.kind !== 'MPNEWS') {
    return { coverAssetId: null, inlineAssetIds: [], fileAssetId: null, newsImageAssetIds: [] }
  }
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
    fileAssetId: null,
    newsImageAssetIds: [],
  }
}

/** 按正文顺序提取业务图片来源占位；同一来源可出现多次，每个占位消费一张图片。 */
export function extractMpnewsMediaSourceSlots(html: string): string[] {
  const slots: string[] = []
  for (const match of html.matchAll(/<img\b[^>]*\bdata-media-source\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    if (match[1] !== undefined) {
      slots.push(match[1])
    }
  }
  return slots
}

/** 去掉全部图片后是否仍有可见文字；业务图片占位不能作为正文唯一内容。 */
export function mpnewsHasStaticTextOutsideImages(html: string): boolean {
  return html
    .replace(/<img\b[^>]*>/giu, ' ')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .trim().length > 0
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
 * 渠道内容组的唯一校验入口。可用类型按发送方式白名单开放；未实现类型明确拒绝，
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
    && !enabledItems.some(item => item.kind !== 'IMAGE')
  ) {
    // 企业微信派发以正文消息为投递主体；纯图片配置没有可重试的正文。
    issues.push(issue('NOTIFICATION_CONTENT_TEXT_REQUIRED', '企业微信渠道至少需要一条正文消息'))
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
    if (item.kind === 'MARKDOWN' || item.kind === 'MARKDOWN_V2') {
      const result = validateMarkdown({
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
    if (item.kind === 'TEXTCARD') {
      const result = validateTextcard({
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
    if (item.kind === 'NEWS') {
      const result = validateNews({
        payload: item.payload,
        allowedVariables: input.allowedVariables,
        itemIndex: index,
      })
      issues.push(...result.issues)
      if (result.payload !== undefined) {
        normalized.push({
          kind: item.kind,
          payload: result.payload,
          mediaPolicy: {},
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder ?? index,
          contentHash: hashNotificationContent({ kind: item.kind, payload: result.payload, mediaPolicy: {} }),
        })
      }
      return
    }
    if (item.kind === 'FILE') {
      const result = validateFile({
        payload: item.payload,
        mediaPolicy: item.mediaPolicy,
        mediaSources: input.mediaSources ?? null,
        itemIndex: index,
      })
      issues.push(...result.issues)
      if (result.payload !== undefined && result.mediaPolicy !== undefined) {
        normalized.push({
          kind: item.kind,
          payload: result.payload,
          mediaPolicy: result.mediaPolicy,
          enabled: item.enabled !== false,
          sortOrder: item.sortOrder ?? index,
          contentHash: hashNotificationContent({ kind: item.kind, payload: result.payload, mediaPolicy: result.mediaPolicy }),
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
        mediaSources: input.mediaSources,
        mediaMaxCount: input.mediaMaxCount,
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
