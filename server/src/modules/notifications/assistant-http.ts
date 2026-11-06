import { lookup as dnsLookup } from 'node:dns/promises'
import { Logger } from '@nestjs/common'

import type { AssistantConfiguration } from '../../config/assistant.config'
import { buildAssistantApiUrl, resolveAssistantHost, type AssistantLookup } from './assistant-outbound-url'
import type { AssistantTransportResult } from './notification.types'

const MAX_RESPONSE_BYTES = 1_048_576

export interface AssistantHttpDeps {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: AssistantLookup
}

export type AssistantJsonResult =
  | { readonly ok: true, readonly ret: number, readonly msg: string, readonly data: unknown }
  | {
    readonly ok: false
    readonly kind: 'TIMEOUT' | 'NETWORK' | 'REJECTED' | 'OFFLINE' | 'RATE_LIMITED' | 'UNKNOWN'
    readonly code: string
    readonly message: string
  }

const logger = new Logger('AssistantHttp')

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function asStringId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function classifyFailure(ret: number, message: string, httpStatus: number): AssistantJsonResult {
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

export function assistantTransportFailure(result: Extract<AssistantJsonResult, { ok: false }>): AssistantTransportResult {
  return {
    ok: false,
    kind: result.kind,
    code: result.code,
    message: result.message,
  }
}

/**
 * 统一的 GeWe JSON 调用：HTTPS、固定 host、DNS 私网校验、Token 头、超时与响应分类。
 * 不记录请求体、Token 或响应正文，只记录 ret/http 供排障。
 */
export async function postAssistantJson(
  config: AssistantConfiguration,
  path: string,
  body: Record<string, unknown>,
  deps: AssistantHttpDeps = {},
): Promise<AssistantJsonResult> {
  if (!config.token) {
    return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_TOKEN_MISSING', message: '未配置 ASSISTANT_GEWE_TOKEN' }
  }

  let url: URL
  try {
    url = buildAssistantApiUrl(config.baseUrl, path)
  }
  catch {
    return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_BASE_URL_INVALID', message: 'GeWe 地址校验失败' }
  }

  const lookup = deps.lookup ?? (async (hostname, options) => dnsLookup(hostname, options))
  try {
    await resolveAssistantHost(url.hostname, lookup)
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : ''
    const configurationFailure = reason.includes('PRIVATE_ADDRESS')
      || reason.includes('HOST_NOT_ALLOWED')
      || reason.includes('HTTPS_REQUIRED')
      || reason.includes('CREDENTIALS_FORBIDDEN')
      || reason.includes('PORT_NOT_ALLOWED')
      || reason.includes('QUERY_FORBIDDEN')
    return configurationFailure
      ? { ok: false, kind: 'REJECTED', code: 'ASSISTANT_BASE_URL_INVALID', message: 'GeWe 地址校验失败' }
      : { ok: false, kind: 'NETWORK', code: 'ASSISTANT_DNS_ERROR', message: 'GeWe 地址解析失败' }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.requestTimeoutMs)

  let response: Awaited<ReturnType<typeof fetch>>
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'X-GEWE-TOKEN': config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
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

  const payload = asRecord(parsed)
  const ret = Number(payload?.ret)
  const message = typeof payload?.msg === 'string' ? payload.msg.slice(0, 200) : ''
  if (ret === 200) {
    return { ok: true, ret, msg: message, data: payload?.data }
  }

  logger.warn(`assistant http rejected: ret=${Number.isFinite(ret) ? ret : 'unknown'} http=${response.status}`)
  return classifyFailure(Number.isFinite(ret) ? ret : -1, message, response.status)
}
