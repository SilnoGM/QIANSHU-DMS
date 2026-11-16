import type { AssistantTransport, AssistantTransportResult } from './notification.types'

/** 测试替身：记录调用并按队列返回预设结果，绝不访问网络。 */
export class FakeAssistantTransport implements AssistantTransport {
  readonly calls: Array<{ readonly appId: string, readonly toWxid: string, readonly content: string, readonly ats?: string }> = []
  readonly imageCalls: Array<{ readonly appId: string, readonly toWxid: string, readonly imageUrl: string }> = []
  private readonly results: AssistantTransportResult[]
  private readonly imageResults: AssistantTransportResult[]

  constructor(
    results: readonly AssistantTransportResult[] = [],
    imageResults: readonly AssistantTransportResult[] = [],
  ) {
    this.results = [...results]
    this.imageResults = [...imageResults]
  }

  sendText(input: {
    readonly appId: string
    readonly toWxid: string
    readonly content: string
    readonly ats?: string
  }): Promise<AssistantTransportResult> {
    this.calls.push({ ...input })
    return Promise.resolve(this.results.shift() ?? {
      ok: true,
      msgId: 'fake-msg-id',
      newMsgId: 'fake-new-msg-id',
    })
  }

  sendImage(input: {
    readonly appId: string
    readonly toWxid: string
    readonly imageUrl: string
  }): Promise<AssistantTransportResult> {
    this.imageCalls.push({ ...input })
    return Promise.resolve(this.imageResults.shift() ?? {
      ok: true,
      msgId: 'fake-image-msg-id',
      newMsgId: 'fake-image-new-msg-id',
    })
  }
}
