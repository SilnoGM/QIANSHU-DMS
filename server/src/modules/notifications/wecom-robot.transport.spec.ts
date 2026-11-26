import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import { WecomRobotHttpTransport } from './wecom-robot.transport'

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

describe('WecomRobotHttpTransport', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('sends text with mentioned_list and webhook key in query', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok' }))
    const transport = new WecomRobotHttpTransport(configService())

    const result = await transport.sendText({
      webhookKey: 'webhook-key-1',
      content: '财务群通知',
      mentionedUserIds: ['@all'],
    })

    expect(result).toEqual({ ok: true, msgId: null })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBeInstanceOf(URL)
    if (url instanceof URL) {
      expect(url.origin).toBe('https://qyapi.weixin.qq.com')
      expect(url.pathname).toBe('/cgi-bin/webhook/send')
      expect(url.searchParams.get('key')).toBe('webhook-key-1')
    }
    const body = init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        msgtype: 'text',
        text: {
          content: '财务群通知',
          mentioned_list: ['@all'],
        },
      })
    }
  })

  it('omits mentioned_list when no mention is configured', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0 }))
    const transport = new WecomRobotHttpTransport(configService())

    await transport.sendText({ webhookKey: 'webhook-key-1', content: 'x' })

    const [, init] = fetchSpy.mock.calls[0] ?? []
    const body = init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        msgtype: 'text',
        text: { content: 'x' },
      })
    }
  })

  it('classifies an invalid webhook', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 93000, errmsg: 'invalid webhook url' }))
    const transport = new WecomRobotHttpTransport(configService())

    await expect(transport.sendText({
      webhookKey: 'bad',
      content: 'x',
    })).resolves.toMatchObject({ ok: false, kind: 'WEBHOOK_INVALID' })
  })

  it('classifies rate limiting', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 45009, errmsg: 'api freq out of limit' }))
    const transport = new WecomRobotHttpTransport(configService())

    await expect(transport.sendText({
      webhookKey: 'key',
      content: 'x',
    })).resolves.toMatchObject({ ok: false, kind: 'RATE_LIMITED' })
  })

  it('sends an image message with base64 and md5', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ errcode: 0, errmsg: 'ok' }))
    const transport = new WecomRobotHttpTransport(configService())

    const result = await transport.sendImage({
      webhookKey: 'webhook-key-1',
      base64: 'aW1hZ2U=',
      md5: '0123456789abcdef0123456789abcdef',
    })

    expect(result).toEqual({ ok: true, msgId: null })
    const [, init] = fetchSpy.mock.calls[0] ?? []
    const body = init?.body
    expect(typeof body).toBe('string')
    if (typeof body === 'string') {
      expect(JSON.parse(body)).toEqual({
        msgtype: 'image',
        image: {
          base64: 'aW1hZ2U=',
          md5: '0123456789abcdef0123456789abcdef',
        },
      })
    }
  })
})
