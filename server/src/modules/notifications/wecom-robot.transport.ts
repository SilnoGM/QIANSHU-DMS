import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import type { WecomRobotTransport, WecomTransportResult } from './wecom.types'
import { utf8Bytes } from './wecom.types'

const MAX_RESPONSE_BYTES = 64 * 1024

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * 企业微信内部群机器人传输（一期只实现 text 与 @）。
 *
 * webhook key 只通过 query 传递，不写日志；群成员无法通过该接口校验，
 * 只能保证 userid 格式合法，是否在群内由管理端 SOP 保障。
 */
@Injectable()
export class WecomRobotHttpTransport implements WecomRobotTransport {
  constructor(private readonly configService: ConfigService) {}

  async sendText(input: {
    readonly webhookKey: string
    readonly content: string
    readonly mentionedUserIds?: readonly string[]
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    if (input.webhookKey.trim().length === 0) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_KEY_MISSING', message: '群机器人 webhook key 为空' }
    }
    if (utf8Bytes(input.content) > config.maxTextBytes) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_TEXT_TOO_LONG', message: '企业微信消息超过 2048 字节' }
    }

    const url = new URL('/cgi-bin/webhook/send', config.baseUrl)
    url.searchParams.set('key', input.webhookKey)

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
          msgtype: 'text',
          text: {
            content: input.content,
            ...(input.mentionedUserIds === undefined || input.mentionedUserIds.length === 0
              ? {}
              : { mentioned_list: [...input.mentionedUserIds] }),
          },
        }),
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, kind: 'TIMEOUT', code: 'WECOM_ROBOT_TIMEOUT', message: '企业微信群机器人请求超时' }
      }
      return { ok: false, kind: 'NETWORK', code: 'WECOM_ROBOT_NETWORK', message: '企业微信群机器人网络请求失败' }
    }
    finally {
      clearTimeout(timeout)
    }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_ROBOT_READ_FAILED', message: '读取企业微信群机器人响应失败' }
    }
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_ROBOT_RESPONSE_TOO_LARGE', message: '企业微信群机器人响应过大' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_ROBOT_INVALID_JSON', message: '企业微信群机器人返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      return { ok: true, msgId: null }
    }

    if (errcode === 45009 || response.status === 429) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_ROBOT_RATE_LIMITED', message: '企业微信群机器人被限流' }
    }
    if (errcode === 93000) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_WEBHOOK_INVALID', message: errmsg || '群机器人 webhook 无效' }
    }
    if (response.status >= 500) {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_ROBOT_UPSTREAM', message: `企业微信群机器人上游返回 ${response.status}` }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_ROBOT_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '企业微信群机器人请求被拒绝',
    }
  }

  async sendMarkdown(input: {
    readonly webhookKey: string
    readonly content: string
    readonly version?: 'markdown' | 'markdown_v2'
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    if (input.webhookKey.trim().length === 0) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_KEY_MISSING', message: '群机器人 webhook key 为空' }
    }
    const msgtype = input.version === 'markdown_v2' ? 'markdown_v2' : 'markdown'
    if (utf8Bytes(input.content) > 4_096) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_ROBOT_MARKDOWN_TOO_LONG', message: '企业微信群机器人 Markdown 超过 4096 字节' }
    }
    return this.sendJsonPayload(input.webhookKey, {
      msgtype,
      [msgtype]: { content: input.content },
    }, 'MARKDOWN')
  }

  private async sendJsonPayload(
    webhookKey: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    const url = new URL('/cgi-bin/webhook/send', config.baseUrl)
    url.searchParams.set('key', webhookKey)
    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: `WECOM_ROBOT_${label}_TIMEOUT`, message: '企业微信群机器人请求超时' }
        : { ok: false, kind: 'NETWORK', code: `WECOM_ROBOT_${label}_NETWORK`, message: '企业微信群机器人网络请求失败' }
    }
    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: `WECOM_ROBOT_${label}_RESPONSE_TOO_LARGE`, message: '企业微信群机器人响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: `WECOM_ROBOT_${label}_INVALID_JSON`, message: '企业微信群机器人返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      return { ok: true, msgId: null }
    }
    if (errcode === 45009 || response.status === 429) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_ROBOT_RATE_LIMITED', message: '企业微信群机器人被限流' }
    }
    if (errcode === 93000) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_WEBHOOK_INVALID', message: errmsg || '群机器人 webhook 无效' }
    }
    if (response.status >= 500) {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_ROBOT_UPSTREAM', message: `企业微信群机器人上游返回 ${response.status}` }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_ROBOT_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '企业微信群机器人请求被拒绝',
    }
  }

  async sendImage(input: {
    readonly webhookKey: string
    readonly base64: string
    readonly md5: string
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    if (input.webhookKey.trim().length === 0) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_KEY_MISSING', message: '群机器人 webhook key 为空' }
    }
    const url = new URL('/cgi-bin/webhook/send', config.baseUrl)
    url.searchParams.set('key', input.webhookKey)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'image',
          image: { base64: input.base64, md5: input.md5 },
        }),
        redirect: 'error',
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: 'WECOM_ROBOT_IMAGE_TIMEOUT', message: '群机器人图片消息超时' }
        : { ok: false, kind: 'NETWORK', code: 'WECOM_ROBOT_IMAGE_NETWORK', message: '群机器人图片消息网络请求失败' }
    }

    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_ROBOT_IMAGE_RESPONSE_TOO_LARGE', message: '群机器人图片响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_ROBOT_IMAGE_INVALID_JSON', message: '群机器人图片返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      return { ok: true, msgId: null }
    }
    if (errcode === 45009 || response.status === 429) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_ROBOT_RATE_LIMITED', message: '群机器人图片被限流' }
    }
    if (errcode === 93000) {
      return { ok: false, kind: 'WEBHOOK_INVALID', code: 'WECOM_ROBOT_WEBHOOK_INVALID', message: errmsg || '群机器人 webhook 无效' }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_ROBOT_IMAGE_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '群机器人图片被拒绝',
    }
  }
}
