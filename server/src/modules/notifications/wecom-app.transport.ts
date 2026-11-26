import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import type { WecomAppTransport, WecomImageUrlResult, WecomMediaUploadResult, WecomMpnewsArticle, WecomNewsArticle, WecomTransportResult } from './wecom.types'
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

  async sendMarkdown(input: {
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
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MARKDOWN_TOO_LONG', message: '企业微信 Markdown 超过 2048 字节' }
    }
    return this.sendJsonMessage(config.baseUrl, input.accessToken, {
      touser: input.toUser,
      agentid: input.agentId,
      msgtype: 'markdown',
      markdown: { content: input.content },
    }, 'MARKDOWN')
  }

  async sendTextcard(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly title: string
    readonly description: string
    readonly url: string
    readonly btntxt?: string | null
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    return this.sendJsonMessage(config.baseUrl, input.accessToken, {
      touser: input.toUser,
      agentid: input.agentId,
      msgtype: 'textcard',
      textcard: {
        title: input.title,
        description: input.description,
        url: input.url,
        ...(input.btntxt === undefined || input.btntxt === null ? {} : { btntxt: input.btntxt }),
      },
    }, 'TEXTCARD')
  }

  async sendNews(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly articles: readonly WecomNewsArticle[]
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    return this.sendJsonMessage(config.baseUrl, input.accessToken, {
      touser: input.toUser,
      agentid: input.agentId,
      msgtype: 'news',
      news: {
        articles: input.articles.map(article => ({
          title: article.title,
          ...(article.description === undefined || article.description === null ? {} : { description: article.description }),
          url: article.url,
          ...(article.picurl === undefined || article.picurl === null ? {} : { picurl: article.picurl }),
        })),
      },
    }, 'NEWS')
  }

  private async sendJsonMessage(
    baseUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
    label: string,
  ): Promise<WecomTransportResult> {
    const url = new URL('/cgi-bin/message/send', baseUrl)
    url.searchParams.set('access_token', accessToken)

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
        ? { ok: false, kind: 'TIMEOUT', code: `WECOM_${label}_TIMEOUT`, message: '企业微信消息请求超时' }
        : { ok: false, kind: 'NETWORK', code: `WECOM_${label}_NETWORK`, message: '企业微信消息网络请求失败' }
    }

    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: `WECOM_${label}_RESPONSE_TOO_LARGE`, message: '企业微信消息响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: `WECOM_${label}_INVALID_JSON`, message: '企业微信消息返回非 JSON' }
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

  async uploadImage(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomMediaUploadResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    const url = new URL('/cgi-bin/media/upload', config.baseUrl)
    url.searchParams.set('access_token', input.accessToken)
    url.searchParams.set('type', 'image')
    const form = new FormData()
    form.append('media', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        body: form,
        redirect: 'error',
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: 'WECOM_MEDIA_TIMEOUT', message: '企业微信图片上传超时' }
        : { ok: false, kind: 'NETWORK', code: 'WECOM_MEDIA_NETWORK', message: '企业微信图片上传网络请求失败' }
    }

    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MEDIA_RESPONSE_TOO_LARGE', message: '企业微信图片上传响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_MEDIA_INVALID_JSON', message: '企业微信图片上传返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      const mediaId = typeof payload?.media_id === 'string' ? payload.media_id : ''
      if (mediaId.length === 0) {
        return { ok: false, kind: 'UNKNOWN', code: 'WECOM_MEDIA_INVALID_RESPONSE', message: '企业微信未返回 media_id' }
      }
      return { ok: true, mediaId }
    }
    if (errcode === 40006) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MEDIA_TOO_LARGE', message: errmsg || '企业微信图片超过 10MB' }
    }
    if (errcode === 40007) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MEDIA_INVALID', message: errmsg || '企业微信 media_id 无效' }
    }
    if (errcode === 45009) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_MEDIA_RATE_LIMITED', message: '企业微信图片上传被限流' }
    }
    if (errcode === 40001 || errcode === 42001 || errcode === 40014) {
      return { ok: false, kind: 'TOKEN_INVALID', code: 'WECOM_MEDIA_TOKEN_INVALID', message: errmsg || '企业微信 access_token 无效' }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_MEDIA_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '企业微信图片上传被拒绝',
    }
  }

  async uploadFile(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomMediaUploadResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    const url = new URL('/cgi-bin/media/upload', config.baseUrl)
    url.searchParams.set('access_token', input.accessToken)
    url.searchParams.set('type', 'file')
    const form = new FormData()
    form.append('media', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, { method: 'POST', body: form, redirect: 'error' })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: 'WECOM_FILE_TIMEOUT', message: '企业微信文件上传超时' }
        : { ok: false, kind: 'NETWORK', code: 'WECOM_FILE_NETWORK', message: '企业微信文件上传网络请求失败' }
    }
    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_FILE_RESPONSE_TOO_LARGE', message: '企业微信文件上传响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_FILE_INVALID_JSON', message: '企业微信文件上传返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      const mediaId = typeof payload?.media_id === 'string' ? payload.media_id : ''
      return mediaId.length > 0
        ? { ok: true, mediaId }
        : { ok: false, kind: 'UNKNOWN', code: 'WECOM_FILE_INVALID_RESPONSE', message: '企业微信未返回 media_id' }
    }
    if (errcode === 40006) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_FILE_TOO_LARGE', message: errmsg || '企业微信文件超过 20MB' }
    }
    if (errcode === 40007) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_FILE_INVALID', message: errmsg || '企业微信 media_id 无效' }
    }
    if (errcode === 45009) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_FILE_RATE_LIMITED', message: '企业微信文件上传被限流' }
    }
    if (errcode === 40001 || errcode === 42001 || errcode === 40014) {
      return { ok: false, kind: 'TOKEN_INVALID', code: 'WECOM_FILE_TOKEN_INVALID', message: errmsg || '企业微信 access_token 无效' }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_FILE_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '企业微信文件上传被拒绝',
    }
  }

  async uploadImageUrl(input: {
    readonly accessToken: string
    readonly buffer: Buffer
    readonly mimeType: string
    readonly filename: string
  }): Promise<WecomImageUrlResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    const url = new URL('/cgi-bin/media/uploadimg', config.baseUrl)
    url.searchParams.set('access_token', input.accessToken)
    const form = new FormData()
    form.append('media', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), input.filename)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        body: form,
        redirect: 'error',
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: 'WECOM_IMAGE_URL_TIMEOUT', message: '企业微信正文图片上传超时' }
        : { ok: false, kind: 'NETWORK', code: 'WECOM_IMAGE_URL_NETWORK', message: '企业微信正文图片上传网络请求失败' }
    }

    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_IMAGE_URL_RESPONSE_TOO_LARGE', message: '企业微信正文图片上传响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_IMAGE_URL_INVALID_JSON', message: '企业微信正文图片上传返回非 JSON' }
    }
    const payload = asRecord(parsed)
    const errcode = Number(payload?.errcode)
    const errmsg = typeof payload?.errmsg === 'string' ? payload.errmsg.slice(0, 200) : ''
    if (errcode === 0) {
      const imageUrl = typeof payload?.url === 'string' ? payload.url : ''
      if (imageUrl.length === 0) {
        return { ok: false, kind: 'UNKNOWN', code: 'WECOM_IMAGE_URL_INVALID_RESPONSE', message: '企业微信未返回图片 URL' }
      }
      return { ok: true, url: imageUrl }
    }
    if (errcode === 40006) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_IMAGE_URL_TOO_LARGE', message: errmsg || '企业微信正文图片超过 2MB' }
    }
    if (errcode === 45009) {
      return { ok: false, kind: 'RATE_LIMITED', code: 'WECOM_IMAGE_URL_RATE_LIMITED', message: '企业微信正文图片上传被限流' }
    }
    if (errcode === 40001 || errcode === 42001 || errcode === 40014) {
      return { ok: false, kind: 'TOKEN_INVALID', code: 'WECOM_IMAGE_URL_TOKEN_INVALID', message: errmsg || '企业微信 access_token 无效' }
    }
    return {
      ok: false,
      kind: 'REJECTED',
      code: `WECOM_IMAGE_URL_REJECTED_${Number.isFinite(errcode) ? errcode : 'unknown'}`,
      message: errmsg || '企业微信正文图片上传被拒绝',
    }
  }

  async sendMpnews(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly articles: readonly WecomMpnewsArticle[]
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
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
          msgtype: 'mpnews',
          mpnews: {
            articles: input.articles.map(article => ({
              title: article.title,
              thumb_media_id: article.thumbMediaId,
              ...(article.author === null || article.author === undefined ? {} : { author: article.author }),
              ...(article.contentSourceUrl === null || article.contentSourceUrl === undefined ? {} : { content_source_url: article.contentSourceUrl }),
              content: article.content,
              ...(article.digest === null || article.digest === undefined ? {} : { digest: article.digest }),
            })),
          },
          safe: 2,
        }),
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, kind: 'TIMEOUT', code: 'WECOM_MPNEWS_TIMEOUT', message: '企业微信图文消息请求超时' }
      }
      return { ok: false, kind: 'NETWORK', code: 'WECOM_MPNEWS_NETWORK', message: '企业微信图文消息网络请求失败' }
    }
    finally {
      clearTimeout(timeout)
    }

    let text: string
    try {
      text = await response.text()
    }
    catch {
      return { ok: false, kind: 'NETWORK', code: 'WECOM_MPNEWS_READ_FAILED', message: '读取企业微信图文消息响应失败' }
    }
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_MPNEWS_RESPONSE_TOO_LARGE', message: '企业微信图文消息响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_MPNEWS_INVALID_JSON', message: '企业微信图文消息返回非 JSON' }
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

  async sendFile(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly mediaId: string
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    return this.sendJsonMessage(config.baseUrl, input.accessToken, {
      touser: input.toUser,
      agentid: input.agentId,
      msgtype: 'file',
      file: { media_id: input.mediaId },
    }, 'FILE')
  }

  async sendImage(input: {
    readonly accessToken: string
    readonly agentId: number
    readonly toUser: string
    readonly mediaId: string
  }): Promise<WecomTransportResult> {
    const config = this.configService.get<WecomConfiguration>('wecom')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_CONFIG_MISSING', message: 'WECOM 配置缺失' }
    }
    const url = new URL('/cgi-bin/message/send', config.baseUrl)
    url.searchParams.set('access_token', input.accessToken)

    let response: Awaited<ReturnType<typeof fetch>>
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: input.toUser,
          agentid: input.agentId,
          msgtype: 'image',
          image: { media_id: input.mediaId },
        }),
        redirect: 'error',
      })
    }
    catch (error) {
      const name = error instanceof Error ? error.name : ''
      return name === 'TimeoutError' || name === 'AbortError'
        ? { ok: false, kind: 'TIMEOUT', code: 'WECOM_IMAGE_TIMEOUT', message: '企业微信图片消息超时' }
        : { ok: false, kind: 'NETWORK', code: 'WECOM_IMAGE_NETWORK', message: '企业微信图片消息网络请求失败' }
    }

    const text = await response.text().catch(() => '')
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) {
      return { ok: false, kind: 'REJECTED', code: 'WECOM_IMAGE_RESPONSE_TOO_LARGE', message: '企业微信图片消息响应过大' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return { ok: false, kind: 'UNKNOWN', code: 'WECOM_IMAGE_INVALID_JSON', message: '企业微信图片消息返回非 JSON' }
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
    return {
      ok: false,
      kind: 'REJECTED',
      code: 'WECOM_APP_IP_NOT_ALLOWED',
      message: '当前服务器出口 IP 不在企业微信应用可信 IP 列表，请在企业微信后台添加后重试',
    }
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
