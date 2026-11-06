import type { AssistantTransport, AssistantTransportResult } from './notification.types'

/** 测试替身：记录调用并按队列返回预设结果，绝不访问网络。 */
export class FakeAssistantTransport implements AssistantTransport {
  readonly calls: Array<{ readonly appId: string, readonly toWxid: string, readonly content: string }> = []
  private readonly results: AssistantTransportResult[]

  constructor(results: readonly AssistantTransportResult[] = []) {
    this.results = [...results]
  }

  sendText(input: {
    readonly appId: string
    readonly toWxid: string
    readonly content: string
  }): Promise<AssistantTransportResult> {
    this.calls.push({ ...input })
    return Promise.resolve(this.results.shift() ?? {
      ok: true,
      msgId: 'fake-msg-id',
      newMsgId: 'fake-new-msg-id',
    })
  }
}
