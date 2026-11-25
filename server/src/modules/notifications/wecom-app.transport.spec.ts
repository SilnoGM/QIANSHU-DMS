import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import { WecomAppHttpTransport } from './wecom-app.transport'

const configuration: WecomConfiguration = {
  baseUrl: 'https://qyapi.weixin.qq.com',
  workerEnabled: true,
  pollMs: 5_000,
  batchSize: 20,
  requestTimeoutMs: 1_000,
  appMinSendIntervalMs: 1_000,
  robotMinSendIntervalMs: 3_000,
  maxTextBytes: 2_048,
}

function configService(): ConfigService {
  return { get: () => configuration } as unknown as ConfigService
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

describe('WecomAppHttpTransport', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('sends text to a member with access_token in query', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'msg-1' }))
    const transport = new WecomAppHttpTransport(configService())

    const result = await transport.sendText({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: '采购单待审核',
    })

    expect(result).toEqual({ ok: true, msgId: 'msg-1' })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBeInstanceOf(URL)
    if (url instanceof URL) {
      expect(url.origin).toBe('https://qyapi.weixin.qq.com')
      expect(url.pathname).toBe('/cgi-bin/message/send')
      expect(url.searchParams.get('access_token')).toBe('token-1')
    }
    expect(init?.method).toBe('POST')
    const body = init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        touser: 'zhangsan',
        agentid: 1000001,
        msgtype: 'text',
        text: { content: '采购单待审核' },
      })
    }
  })

  it('classifies rate limiting', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 45009, errmsg: 'api freq out of limit' }))
    const transport = new WecomAppHttpTransport(configService())

    await expect(transport.sendText({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: 'x',
    })).resolves.toMatchObject({ ok: false, kind: 'RATE_LIMITED' })
  })

  it('classifies an untrusted egress IP with an actionable message', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({
        errcode: 60020,
        errmsg: 'not allow to access from your ip, hint: [179557...]',
      }))
    const transport = new WecomAppHttpTransport(configService())

    const result = await transport.sendText({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: 'x',
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'WECOM_APP_IP_NOT_ALLOWED',
    })
    if (result.ok) {
      throw new Error('expected an untrusted IP failure')
    }
    expect(result.message).toContain('可信 IP')
  })

  it('classifies an invalid recipient and keeps invaliduser', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({
        errcode: 81013,
        errmsg: 'user & party & tag all invalid',
        invaliduser: 'lisi',
      }))
    const transport = new WecomAppHttpTransport(configService())

    await expect(transport.sendText({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'lisi',
      content: 'x',
    })).resolves.toMatchObject({
      ok: false,
      kind: 'INVALID_RECIPIENT',
      invalidUserIds: ['lisi'],
    })
  })

  it('rejects over-limit text before calling the network', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    const transport = new WecomAppHttpTransport(configService())

    const result = await transport.sendText({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      content: '中'.repeat(700),
    })

    expect(result).toMatchObject({ ok: false, code: 'WECOM_TEXT_TOO_LONG' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uploads an image and returns media_id', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok', media_id: 'media-1' }))
    const transport = new WecomAppHttpTransport(configService())

    const result = await transport.uploadImage({
      accessToken: 'token-1',
      buffer: Buffer.from('image'),
      mimeType: 'image/png',
      filename: 'proof.png',
    })

    expect(result).toEqual({ ok: true, mediaId: 'media-1' })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBeInstanceOf(URL)
    if (url instanceof URL) {
      expect(url.pathname).toBe('/cgi-bin/media/upload')
      expect(url.searchParams.get('type')).toBe('image')
    }
    expect(init?.body).toBeInstanceOf(FormData)
  })

  it('sends an image message with media_id', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok', msgid: 'msg-2' }))
    const transport = new WecomAppHttpTransport(configService())

    const result = await transport.sendImage({
      accessToken: 'token-1',
      agentId: 1000001,
      toUser: 'zhangsan',
      mediaId: 'media-1',
    })

    expect(result).toEqual({ ok: true, msgId: 'msg-2' })
    const [, init] = fetchSpy.mock.calls[0] ?? []
    const body = init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        touser: 'zhangsan',
        agentid: 1000001,
        msgtype: 'image',
        image: { media_id: 'media-1' },
      })
    }
  })
})
