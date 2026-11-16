import { lookup as dnsLookup } from 'node:dns/promises'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { AssistantLookup } from './assistant-outbound-url'
import {
  asRecord,
  asStringId,
  assistantTransportFailure,
  postAssistantJson,
} from './assistant-http'
import type { AssistantTransport, AssistantTransportResult } from './notification.types'
import { ASSISTANT_TRANSPORT_OPTIONS } from './notification.types'

const POST_TEXT_PATH = '/gewe/v2/api/message/postText'
const POST_IMAGE_PATH = '/gewe/v2/api/message/postImage'

interface AssistantTransportOptions {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: AssistantLookup
}

/**
 * GeWe 消息适配器（文本与图片）。
 *
 * 只负责一次 HTTP 调用与响应分类，不做重试、限速或状态更新；生产注入的是
 * GatedAssistantTransport，由它在调用本适配器前串行化并执行全局最小间隔。
 * Token 只从配置读取，不进入日志、异常消息或返回值。
 *
 * 图片是「按 URL 由上游拉取」的能力：调用方必须在发送时现签短时效地址，
 * 不允许把长期可访问链接写进模板或投递内容。
 */
@Injectable()
export class GeweAssistantTransport implements AssistantTransport {
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
    readonly ats?: string
  }): Promise<AssistantTransportResult> {
    return this.post(POST_TEXT_PATH, {
      appId: input.appId,
      toWxid: input.toWxid,
      content: input.content,
      ...(input.ats !== undefined ? { ats: input.ats } : {}),
    })
  }

  async sendImage(input: {
    readonly appId: string
    readonly toWxid: string
    readonly imageUrl: string
  }): Promise<AssistantTransportResult> {
    return this.post(POST_IMAGE_PATH, {
      appId: input.appId,
      toWxid: input.toWxid,
      imgUrl: input.imageUrl,
    })
  }

  private async post(path: string, body: Record<string, unknown>): Promise<AssistantTransportResult> {
    const config = this.configService.get<AssistantConfiguration>('assistant')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_TOKEN_MISSING', message: '未配置 ASSISTANT_GEWE_TOKEN' }
    }

    const result = await postAssistantJson(config, path, body, {
      fetchImpl: this.fetchImpl,
      lookup: this.lookup,
    })

    if (!result.ok) {
      return assistantTransportFailure(result)
    }
    const data = asRecord(result.data)
    return {
      ok: true,
      msgId: asStringId(data?.msgId),
      newMsgId: asStringId(data?.newMsgId),
    }
  }
}
