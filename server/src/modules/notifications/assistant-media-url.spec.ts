import { ConfigService } from '@nestjs/config'

import { AssistantMediaUrlService } from './assistant-media-url'

const SECRET = Buffer.alloc(32, 7)
const DELIVERY_MEDIA_ID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.UTC(2026, 10, 16, 8, 0, 0)

function service(appOrigin = 'https://dms.example.com'): AssistantMediaUrlService {
  const config = {
    get: (key: string) => {
      if (key === 'notificationMedia') {
        return { urlSecret: SECRET, urlTtlSeconds: 900 }
      }
      if (key === 'auth') {
        return { appOrigin }
      }
      return undefined
    },
  }
  return new AssistantMediaUrlService(config as unknown as ConfigService)
}

function tokenOf(url: string): string {
  const index = url.lastIndexOf('/')
  return url.slice(index + 1)
}

describe('AssistantMediaUrlService', () => {
  it('signs a short-lived public URL that verifies back to the delivery media item', () => {
    const url = service().sign(DELIVERY_MEDIA_ID, NOW)

    expect(url.startsWith('https://dms.example.com/api/public/notification-media/')).toBe(true)
    expect(service().verify(tokenOf(url), NOW)).toEqual({ ok: true, deliveryMediaId: DELIVERY_MEDIA_ID })
  })

  it('normalizes a trailing slash on the configured origin', () => {
    const url = service('https://dms.example.com/').sign(DELIVERY_MEDIA_ID, NOW)
    expect(url.startsWith('https://dms.example.com/api/public/notification-media/')).toBe(true)
  })

  it('rejects an expired token and never extends its own lifetime', () => {
    const url = service().sign(DELIVERY_MEDIA_ID, NOW)
    const token = tokenOf(url)

    expect(service().verify(token, NOW + 899_000)).toEqual({ ok: true, deliveryMediaId: DELIVERY_MEDIA_ID })
    expect(service().verify(token, NOW + 901_000)).toEqual({ ok: false })
  })

  it('rejects tampered payloads and signatures', () => {
    const token = tokenOf(service().sign(DELIVERY_MEDIA_ID, NOW))
    const [payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const forged = Buffer.from(JSON.stringify({
      ...decoded,
      d: '22222222-2222-4222-8222-222222222222',
    })).toString('base64url')

    expect(service().verify(`${forged}.${signature}`, NOW)).toEqual({ ok: false })
    expect(service().verify(`${payload}.${signature.slice(0, -2)}AA`, NOW)).toEqual({ ok: false })
  })

  it('rejects malformed tokens instead of throwing', () => {
    for (const token of ['', 'abc', 'a.b.c', '!!.??', `${Buffer.from('{}').toString('base64url')}.x`]) {
      expect(service().verify(token, NOW)).toEqual({ ok: false })
    }
  })
})
