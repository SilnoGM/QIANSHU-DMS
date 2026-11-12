import type { AssistantSendGateService } from './assistant-send-gate.service'
import { GatedAssistantTransport } from './gated-assistant.transport'
import type { GeweAssistantTransport } from './gewe-assistant.transport'

describe('GatedAssistantTransport', () => {
  it('routes every sendText through the shared gate', async () => {
    const delegate = {
      sendText: jest.fn().mockResolvedValue({ ok: true, msgId: 'msg-1', newMsgId: 'new-1' }),
    }
    const gate = {
      run: jest.fn(async (send: () => Promise<unknown>) => send()),
    }
    const transport = new GatedAssistantTransport(
      delegate as unknown as GeweAssistantTransport,
      gate as unknown as AssistantSendGateService,
    )

    await expect(transport.sendText({
      appId: 'app-1',
      toWxid: 'wxid-1',
      content: 'hello',
      ats: 'wxid-2',
    })).resolves.toEqual({ ok: true, msgId: 'msg-1', newMsgId: 'new-1' })

    expect(gate.run).toHaveBeenCalledTimes(1)
    expect(delegate.sendText).toHaveBeenCalledWith({
      appId: 'app-1',
      toWxid: 'wxid-1',
      content: 'hello',
      ats: 'wxid-2',
    })
  })
})
