import { Injectable } from '@nestjs/common'

import type { AssistantTransport, AssistantTransportResult } from './notification.types'
import { AssistantSendGateService } from './assistant-send-gate.service'
import { GeweAssistantTransport } from './gewe-assistant.transport'

type SendTextInput = Parameters<AssistantTransport['sendText']>[0]

/**
 * 所有生产 sendText 的统一出口。
 *
 * 队列派发、渠道测试、绑定验证、模板测试和群 @ 都通过同一 token 注入本适配器，
 * 由 AssistantSendGateService 串行化并执行全局最小间隔。
 */
@Injectable()
export class GatedAssistantTransport implements AssistantTransport {
  constructor(
    private readonly delegate: GeweAssistantTransport,
    private readonly gate: AssistantSendGateService,
  ) {}

  sendText(input: SendTextInput): Promise<AssistantTransportResult> {
    return this.gate.run(() => this.delegate.sendText(input))
  }
}
