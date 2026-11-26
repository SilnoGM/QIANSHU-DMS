/**
 * WECOM 渠道的传输边界类型。
 *
 * 传输层只负责一次 HTTP 调用与响应分类，不做重试、租约、静默或状态更新；
 * 这些由 `WecomDispatchService` 统一负责，便于测试和错误分类复用。
 */
export type WecomTransportFailureKind =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'REJECTED'
  | 'RATE_LIMITED'
  | 'TOKEN_INVALID'
  | 'INVALID_RECIPIENT'
  | 'WEBHOOK_INVALID'
  | 'UNKNOWN'

export type WecomTransportResult =
  | { readonly ok: true, readonly msgId: string | null }
  | {
    readonly ok: false
    readonly kind: WecomTransportFailureKind
    readonly code: string
    readonly message: string
    readonly invalidUserIds?: readonly string[]
  }

export type WecomMediaUploadResult =
  | { readonly ok: true, readonly mediaId: string }
  | {
    readonly ok: false
    readonly kind: WecomTransportFailureKind
    readonly code: string
    readonly message: string
  }

export type WecomImageUrlResult =
  | { readonly ok: true, readonly url: string }
  | {
    readonly ok: false
    readonly kind: WecomTransportFailureKind
    readonly code: string
    readonly message: string
  }

export interface WecomMpnewsArticle {
  readonly title: string
  readonly thumbMediaId: string
  readonly author?: string | null
  readonly contentSourceUrl?: string | null
  readonly content: string
  readonly digest?: string | null
}

export interface WecomNewsArticle {
  readonly title: string
  readonly description?: string | null
  readonly url: string
  readonly picurl?: string | null
}

export interface WecomAppTransport {
  sendText(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly content: string
  }): Promise<WecomTransportResult>
  uploadImage(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomMediaUploadResult>
  uploadFile(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomMediaUploadResult>
  uploadImageUrl(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomImageUrlResult>
  sendImage(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly mediaId: string
  }): Promise<WecomTransportResult>
  sendFile(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly mediaId: string
  }): Promise<WecomTransportResult>
  sendMpnews(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly articles: readonly WecomMpnewsArticle[]
  }): Promise<WecomTransportResult>
  sendMarkdown(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly content: string
  }): Promise<WecomTransportResult>
  sendTextcard(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly title: string
    readonly description: string
    readonly url: string
    readonly btntxt?: string | null
  }): Promise<WecomTransportResult>
  sendNews(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly articles: readonly WecomNewsArticle[]
  }): Promise<WecomTransportResult>
}

export interface WecomRobotTransport {
  sendText(input: {
    readonly webhookKey: string
    readonly content: string
    readonly mentionedUserIds?: readonly string[]
  }): Promise<WecomTransportResult>
  sendMarkdown(input: {
    readonly webhookKey: string
    readonly content: string
    readonly version?: 'markdown' | 'markdown_v2'
  }): Promise<WecomTransportResult>
  sendImage(input: {
    readonly webhookKey: string
    readonly base64: string
    readonly md5: string
  }): Promise<WecomTransportResult>
  uploadFile(input: {
    readonly webhookKey: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomMediaUploadResult>
  sendFile(input: {
    readonly webhookKey: string
    readonly mediaId: string
  }): Promise<WecomTransportResult>
  sendNews(input: {
    readonly webhookKey: string
    readonly articles: readonly WecomNewsArticle[]
  }): Promise<WecomTransportResult>
}

export const WECOM_APP_TRANSPORT = Symbol('WECOM_APP_TRANSPORT')
export const WECOM_ROBOT_TRANSPORT = Symbol('WECOM_ROBOT_TRANSPORT')
export const WECOM_DEFAULT_MAX_BYTES = 2_048

export type WecomMentionConfig =
  | { readonly mode: 'NONE' }
  | { readonly mode: 'ALL' }
  | { readonly mode: 'USERS', readonly userIds: readonly string[] }

/**
 * `targetConfig.mention` 是管理端可编辑 JSON，读取时必须防御性解析；
 * 未知形状按 NONE 处理，避免错误配置阻断整条通知。
 */
export function parseWecomMentionConfig(value: unknown): WecomMentionConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { mode: 'NONE' }
  }
  const record = value as Record<string, unknown>
  const mode = record.mode
  if (mode === 'ALL') {
    return { mode: 'ALL' }
  }
  if (mode === 'USERS') {
    const userIds = Array.isArray(record.userIds)
      ? [...new Set(record.userIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
      : []
    return { mode: 'USERS', userIds }
  }
  return { mode: 'NONE' }
}

export function isRetryableWecomFailure(kind: WecomTransportFailureKind): boolean {
  return kind === 'TIMEOUT' || kind === 'NETWORK' || kind === 'RATE_LIMITED' || kind === 'TOKEN_INVALID'
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}
