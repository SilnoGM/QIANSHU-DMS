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

interface AssistantTransportOptions {
  readonly fetchImpl?: typeof fetch
  readonly lookup?: AssistantLookup
}

/**
 * GeWe 文字消息适配器。
 *
 * 只负责一次 HTTP 调用与响应分类，不做重试、限速或状态更新；这些由派发器负责。
 * Token 只从配置读取，不进入日志、异常消息或返回值。
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
  }): Promise<AssistantTransportResult> {
    const config = this.configService.get<AssistantConfiguration>('assistant')
    if (config === undefined) {
      return { ok: false, kind: 'REJECTED', code: 'ASSISTANT_TOKEN_MISSING', message: '未配置 ASSISTANT_GEWE_TOKEN' }
    }

    const result = await postAssistantJson(config, POST_TEXT_PATH, {
      appId: input.appId,
      toWxid: input.toWxid,
      content: input.content,
    }, {
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
