import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import { utf8Bytes } from './wecom.types'

export const WECOM_TOKEN_FETCH = Symbol('WECOM_TOKEN_FETCH')

const MAX_RESPONSE_BYTES = 64 * 1024
const TOKEN_SAFETY_MARGIN_MS = 300_000

export type WecomTokenResult =
  | { readonly ok: true, readonly accessToken: string }
  | {
    readonly ok: false
    readonly kind: 'TIMEOUT' | 'NETWORK' | 'REJECTED' | 'TOKEN_INVALID' | 'UNKNOWN'
    readonly code: string
    readonly message: string
  }

interface CachedToken {
  readonly accessToken: string
  readonly expiresAt: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * 按 appKey 缓存 access_token；有效期内重复获取返回同一结果。
 *
 * 单飞刷新避免并发打 `gettoken`；任何日志/异常只带错误码，不带 Secret 或 token。
 */
@Injectable()
export class WecomTokenService {
  private readonly logger = new Logger(WecomTokenService.name)
  private readonly fetchImpl: typeof fetch
  private readonly cache = new Map<string, CachedToken>()
  private readonly inflight = new Map<string, Promise<WecomTokenResult>>()

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(WECOM_TOKEN_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  invalidate(appKey: string): void {
    this.cache.delete(appKey)
    this.inflight.delete(appKey)
  }

  async getAccessToken(input: {
    readonly appKey: string
    readonly corpId: string
    readonly secret: string
  }): Promise<WecomTokenResult> {
    const cached = this.cache.get(input.appKey)
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return { ok: true, accessToken: cached.accessToken }
    }

    const existing = this.inflight.get(input.appKey)
    if (existing !== undefined) {
      return existing
    }

    const pending = this.fetchToken(input).finally(() => {
      this.inflight.delete(input.appKey)
    })
    this.inflight.set(input.appKey, pending)
    return pending
  }

  private async fetchToken(input: {
    readonly appKey: string
    readonly corpId: string
    readonly secret: string
  }): Promise<WecomTokenResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }

    const url = new URL('/cgi-bin/gettoken', config.baseUrl)
    url.searchParams.set('corpid', input.corpId)
    url.searchParams.set('corpsecret', input.secret)

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.requestTimeoutMs)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, kind: 'TIMEOUT', code: 'WECOM_TOKEN_TIMEOUT', message: '企业微信 token 请求超时' }
      }
      return { ok: false, kind: 'NETWORK', code: 'WECOM_TOKEN_NETWORK', message: '企业微信 token 网络请求失败' }
    }
    finally {
      clearTimeout(timeout)
    }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_TOKEN_READ_FAILED', message: '读取企业微信 token 响应失败' }
    }
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_TOKEN_RESPONSE_TOO_LARGE', message: '企业微信 token 响应过大' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_TOKEN_INVALID_JSON', message: '企业微信 token 返回非 JSON' }
    }

    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : ''
      const expiresIn = Number(payload?.expires_in)
      if (accessToken.length === 0 || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        return { ok: false, kind: 'UNKNOWN', code: 'WECOM_TOKEN_INVALID_RESPONSE', message: '企业微信 token 响应字段无效' }
      }
      this.cache.set(input.appKey, {
        accessToken,
        expiresAt: Date.now() + Math.max(60_000, expiresIn * 1000 - TOKEN_SAFETY_MARGIN_MS),
      })
      return { ok: true, accessToken }
    }

    this.logger.warn(`wecom token rejected: errcode=${Number.isFinite(errcode) ? errcode : 'unknown'} http=${response.status}`)
    if (errcode === 40001 || errcode === 42001 || errcode === 40014) {
      this.invalidate(input.appKey)
      return { ok: false, kind: 'TOKEN_INVALID', code: 'WECOM_TOKEN_INVALID', message: errmsg || '企业微信 token 无效' }
    }
    if (response.status >= 500) {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_TOKEN_UPSTREAM', message: `企业微信 token 上游返回 ${response.status}` }
    }
    return { ok: false, kind: 'REJECTED', code: `WECOM_TOKEN_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`, message: errmsg || '企业微信 token 请求被拒绝' }
  }
}
