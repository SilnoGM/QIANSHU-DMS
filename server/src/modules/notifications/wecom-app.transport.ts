import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import type { WecomAppTransport, WecomTransportResult } from './wecom.types'
import { utf8Bytes } from './wecom.types'

const MAX_RESPONSE_BYTES = 64 * 1024

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split('|').map(item => item.trim()).filter(item => item.length > 0)
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
}

/**
 * 企业微信自建应用消息传输（一期只实现 text）。
 *
 * 只做一次 HTTP 调用与 errcode 分类；重试、限流、租约和状态更新由派发器负责。
 * access_token 只通过 query 传递，不写日志；响应正文不落日志。
 */
@Injectable()
export class WecomAppHttpTransport implements WecomAppTransport {
  constructor(private readonly configService: ConfigService) {}

  async sendText(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly content: string
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    if (utf8Bytes(input.content) > config.maxTextBytes) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_TEXT_TOO_LONG', message: '企业微信消息超过 2048 字节' }
    }

    const url = new URL('/cgi-bin/message/send', config.baseUrl)
    url.searchParams.set('access_token', input.accessToken)

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.requestTimeoutMs)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: input.toUser,
          agentid: input.agentId,
          msgtype: 'text',
          text: { content: input.content },
        }),
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, kind: 'TIMEOUT', code: 'WECOM_APP_TIMEOUT', message: '企业微信应用消息请求超时' }
      }
      return { ok: false, kind: 'NETWORK', code: 'WECOM_APP_NETWORK', message: '企业微信应用消息网络请求失败' }
    }
    finally {
      clearTimeout(timeout)
    }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_APP_READ_FAILED', message: '读取企业微信应用消息响应失败' }
    }
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_APP_RESPONSE_TOO_LARGE', message: '企业微信应用消息响应过大' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_APP_INVALID_JSON', message: '企业微信应用消息返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      return {
        ok: true,
        msgId: typeof payload?.msgid === 'string' && payload.msgid.length > 0 ? payload.msgid : null,
      }
    }

    return classifyAppFailure(errcode, errmsg, response.status, payload)
  }
}

function classifyAppFailure(
  errcode: number,
  errmsg: string,
  httpStatus: number,
  payload: Record<string, unknown> | null,
): WecomTransportResult {
  const invalidUserIds = asStringList(payload?.invaliduser)
  if (errcode === 45009 || httpStatus === 429) {
    return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_APP_RATE_LIMITED', message: '企业微信应用消息被限流' }
  }
  if (errcode === 40001 || errcode === 42001 || errcode === 40014) {
    return { ok: false, kind: 'TOKEN_INVALID', code: 'WECOM_APP_TOKEN_INVALID', message: errmsg || '企业微信 access_token 无效' }
  }
  if (errcode === 81013 || errcode === 81014 || invalidUserIds.length > 0) {
    return {
      ok: false,
      kind: 'INVALID_RECIPIENT',
      code: 'WECOM_APP_INVALID_RECIPIENT',
      message: errmsg || '收件人不在企业微信应用可见范围',
      invalidUserIds,
    }
  }
  if (errcode === 60020) {
    return { ok: false, kind: 'REJECTED', code: 'WECOM_APP_IP_NOT_ALLOWED', message: errmsg || '服务器 IP 不在企业微信可信列表' }
  }
  if (httpStatus >= 500) {
    return { ok: false, kind: 'NETWORK', code: 'WECOM_APP_UPSTREAM', message: `企业微信应用消息上游返回 ${httpStatus}` }
  }
  return {
    ok: false,
    kind: 'REJECTED',
    code: `WECOM_APP_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
    message: errmsg || '企业微信应用消息被拒绝',
  }
}
