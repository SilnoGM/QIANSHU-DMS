import { ConfigService } from '@nestjs/config'

import type { WecomConfiguration } from '../../config/wecom.config'
import { WecomTokenService } from './wecom-token.service'

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

function configService(value: WecomConfiguration | undefined = configuration): ConfigService {
  return { get: () => value } as unknown as ConfigService
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

describe('WecomTokenService', () => {
  it('caches access_token per app and does not fetch twice', async () => {
    const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(jsonResponse({
        errcode: 0,
        access_token: 'token-1',
        expires_in: 7_200,
      }))
    const service = new WecomTokenService(configService(), fetchImpl)
    const tokenInput = { appKey: 'default', corpId: 'ww-1', secret: 'secret' }

    await expect(service.getAccessToken(tokenInput)).resolves.toEqual({ ok: true, accessToken: 'token-1' })
    await expect(service.getAccessToken(tokenInput)).resolves.toEqual({ ok: true, accessToken: 'token-1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const requestUrl = fetchImpl.mock.calls[0]?.[0]
    expect(requestUrl).toBeInstanceOf(URL)
    if (requestUrl instanceof URL) {
      expect(requestUrl.origin).toBe('https://qyapi.weixin.qq.com')
      expect(requestUrl.pathname).toBe('/cgi-bin/gettoken')
      expect(requestUrl.searchParams.get('corpid')).toBe('ww-1')
      expect(requestUrl.searchParams.get('corpsecret')).toBe('secret')
    }
  })

  it('invalidates the cached token when upstream rejects it', async () => {
    const fetchImpl = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }))
    const service = new WecomTokenService(configService(), fetchImpl)

    await expect(service.getAccessToken({
      appKey: 'default',
      corpId: 'ww-1',
      secret: 'secret',
    })).resolves.toMatchObject({ ok: false, kind: 'TOKEN_INVALID' })
  })

  it('returns a configuration error when the wecom config is missing', async () => {
    const missingConfig = { get: () => undefined } as unknown as ConfigService
    const service = new WecomTokenService(missingConfig, jest.fn())
    await expect(service.getAccessToken({
      appKey: 'default',
      corpId: 'ww-1',
      secret: 'secret',
    })).resolves.toMatchObject({ ok: false, code: 'WECOM_CONFIG_MISSING' })
  })

  it('classifies a timeout without leaking the secret', async () => {
    const fetchImpl: typeof fetch = () => {
      const error = new Error('timeout')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }
    const service = new WecomTokenService(configService(), fetchImpl)
    const result = await service.getAccessToken({
      appKey: 'default',
      corpId: 'ww-1',
      secret: 'super-secret',
    })
    expect(result).toMatchObject({ ok: false, kind: 'TIMEOUT', code: 'WECOM_TOKEN_TIMEOUT' })
    expect(JSON.stringify(result)).not.toContain('super-secret')
  })
})
