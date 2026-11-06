import { lookup as dnsLookup } from 'node:dns/promises'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { buildAssistantApiUrl, resolveAssistantHost, type AssistantLookup } from './assistant-outbound-url'
import type { AssistantTransport, AssistantTransportResult } from './notification.types'
import { ASSISTANT_TRANSPORT_OPTIONS } from './notification.types'

const POST_TEXT_PATH = '/gewe/v2/api/message/postText'
const MAX_RESPONSE_BYTES = 1_048_576

interface AssistantTransportOptions {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: AssistantLookup
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function classifyFailure(ret: number, message: string, httpStatus: number): AssistantTransportResult {
  if (ret === 503 || message.includes('离线')) {
    return { ok: false, kind: 'OFFLINE', code: 'ASSISTANT_OFFLINE', message: '公司号离线' }
  }
  if (ret === 429 || httpStatus === 429) {
    return { ok: false, kind: 'RATE_LIMITED', code: 'ASSISTANT_RATE_LIMITED', message: '请求被限流' }
  }
  if (httpStatus >= 500) {
    return { ok: false, kind: 'NETWORK', code: 'ASSISTANT_UPSTREAM_ERROR', message: `上游返回 ${httpStatus}` }
  }
  if (ret === 400 || ret === 403 || ret === 404) {
    return { ok: false, kind: 'REJECTED', code: `ASSISTANT_REJECTED_${ret}`, message: message || '请求被拒绝' }
  }
  return { ok: false, kind: 'UNKNOWN', code: 'ASSISTANT_UNKNOWN_RESPONSE', message: message || '未知响应' }
}

/**
 * GeWe 文字消息适配器。
 *
 * 只负责一次 HTTP 调用与响应分类，不做重试、限速或状态更新；这些由派发器负责。
 * Token 只从配置读取，不进入日志、异常消息或返回值。
 */
@Injectable()
export class GeweAssistantTransport implements AssistantTransport {
  private readonly logger = new Logger(GeweAssistantTransport.name)
  private readonly fetchImpl: typeof fetch
  private readonly lookup: AssistantLookup

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(ASSISTANT_TRANSPORT_OPTIONS) options: AssistantTransportOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.lookup = options.lookup ?? (async (hostname, lookupOptions) => dnsLookup(hostname, lookupOptions))
  }

  async sendText(input: {
    readonly appId: string
    readonly toWxid: string
    readonly content: string
  }): Promise<AssistantTransportResult> {
    const config = this.configService.get<AssistantConfiguration>('assistant')
    if (!config?.token) {
      return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_TOKEN_MISSING', message: '未配置 ASSISTANT_GEWE_TOKEN' }
    }

    let url: URL
    try {
      url = buildAssistantApiUrl(config.baseUrl, POST_TEXT_PATH)
    }
    catch {
      return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_BASE_URL_INVALID', message: 'GeWe 地址校验失败' }
    }
    try {
      await resolveAssistantHost(url.hostname, this.lookup)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : ''
      const configurationFailure = reason.includes('PRIVATE_ADDRESS')
        || reason.includes('HOST_NOT_ALLOWED')
        || reason.includes('HTTPS_REQUIRED')
        || reason.includes('CREDENTIALS_FORBIDDEN')
        || reason.includes('PORT_NOT_ALLOWED')
        || reason.includes('QUERY_FORBIDDEN')
      if (configurationFailure) {
        return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_BASE_URL_INVALID', message: 'GeWe 地址校验失败' }
      }
      return { ok: false, kind: 'NETWORK', code: 'ASSISTANT_DNS_ERROR', message: 'GeWe 地址解析失败' }
    }

    let response: Awaited<ReturnType<typeof fetch>>
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.requestTimeoutMs)
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'X-GEWE-TOKEN': config.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId: input.appId,
          toWxid: input.toWxid,
          content: input.content,
        }),
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, kind: 'TIMEOUT', code: 'ASSISTANT_TIMEOUT', message: 'GeWe 请求超时' }
      }
      return { ok: false, kind: 'NETWORK', code: 'ASSISTANT_NETWORK_ERROR', message: 'GeWe 网络请求失败' }
    }
    finally {
      clearTimeout(timeout)
    }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, kind: 'NETWORK', code: 'ASSISTANT_RESPONSE_READ_FAILED', message: '读取 GeWe 响应失败' }
    }
    if (text.length > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_RESPONSE_TOO_LARGE', message: 'GeWe 响应过大' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'ASSISTANT_INVALID_JSON', message: 'GeWe 返回非 JSON 响应' }
    }

    const body = asRecord(parsed)
    const ret = Number(body?.ret)
    const message = typeof body?.msg === 'string' ? body.msg.slice(0, 200) : ''
    if (ret === 200) {
      const data = asRecord(body?.data)
      return {
        ok: true,
        msgId: asStringId(data?.msgId),
        newMsgId: asStringId(data?.newMsgId),
      }
    }

    this.logger.warn(`assistant transport rejected: ret=${Number.isFinite(ret) ? ret : 'unknown'} http=${response.status}`)
    return classifyFailure(Number.isFinite(ret) ? ret : -1, message, response.status)
  }
}
