import { ConfigService } from '@nestjs/config'

import type { AssistantConfiguration } from '../../config/assistant.config'
import type { AssistantLookup } from './assistant-outbound-url'
import { GeweAssistantTransport } from './gewe-assistant.transport'

function configuration(overrides: Partial<AssistantConfiguration> = {}): AssistantConfiguration {
  return {
    baseUrl: 'https://api.geweapi.com',
    token: 'test-token',
    workerEnabled: true,
    pollMs: 5_000,
    batchSize: 20,
    requestTimeoutMs: 1_000,
    ...overrides,
  }
}

function configService(value: AssistantConfiguration): ConfigService {
  return { get: () => value } as unknown as ConfigService
}

const publicLookup: AssistantLookup = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }])

function jsonFetch(payload: unknown, status: number): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(payload), { status }))
}

describe('GeweAssistantTransport', () => {
  it('sends postText with token header and parses msg ids', async () => {
    const calls: Array<{ readonly input: RequestInfo | URL, readonly init?: RequestInit }> = []
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push({ input, init })
      return Promise.resolve(new Response(JSON.stringify({
        ret: 200,
        msg: '操作成功',
        data: { msgId: 12, newMsgId: '9154432038' },
      }), { status: 200 }))
    }

    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl,
      lookup: publicLookup,
    })
    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: '你好' })

    expect(result).toEqual({ ok: true, msgId: '12', newMsgId: '9154432038' })
    const input = calls[0]?.input
    expect(input).toBeInstanceOf(URL)
    if (input instanceof URL) {
      expect(input.toString()).toBe('https://api.geweapi.com/gewe/v2/api/message/postText')
    }
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toMatchObject({
      'X-GEWE-TOKEN': 'test-token',
      'Content-Type': 'application/json',
    })
    const body = calls[0]?.init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        appId: 'wx-app',
        toWxid: 'wxid-user',
        content: '你好',
      })
    }
  })

  it('classifies an offline response', async () => {
    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl: jsonFetch({ ret: 503, msg: '节点离线' }, 503),
      lookup: publicLookup,
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'OFFLINE' })
  })

  it('classifies a rejected response without retrying', async () => {
    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl: jsonFetch({ ret: 403, msg: '无权限' }, 403),
      lookup: publicLookup,
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'REJECTED' })
  })

  it('classifies a timeout', async () => {
    const timeoutFetch: typeof fetch = () => {
      const error = new Error('timeout')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }
    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl: timeoutFetch,
      lookup: publicLookup,
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'TIMEOUT' })
  })

  it('does not call the network when the token is missing', async () => {
    const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    const transport = new GeweAssistantTransport(configService(configuration({ token: null })), {
      fetchImpl,
      lookup: publicLookup,
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'REJECTED', code: 'ASSISTANT_TOKEN_MISSING' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a private DNS result before calling the network', async () => {
    const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl,
      lookup: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'REJECTED', code: 'ASSISTANT_BASE_URL_INVALID' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('classifies a DNS failure as a retryable network error', async () => {
    const transport = new GeweAssistantTransport(configService(configuration()), {
      fetchImpl: jsonFetch({ ret: 200 }, 200),
      lookup: () => Promise.reject(new Error('ENOTFOUND')),
    })

    const result = await transport.sendText({ appId: 'wx-app', toWxid: 'wxid-user', content: 'x' })
    expect(result).toMatchObject({ ok: false, kind: 'NETWORK', code: 'ASSISTANT_DNS_ERROR' })
  })
})
