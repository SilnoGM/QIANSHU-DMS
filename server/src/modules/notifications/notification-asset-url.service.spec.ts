import { createHmac } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import { NotificationAssetUrlService } from './notification-asset-url.service'

const SECRET = 'test-notification-asset-secret-32chars'
const ASSET_ID = '00000000-0000-4000-8000-000000000444'

function config(secret: string | undefined, origin = 'https://dms.example.com'): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'NOTIFICATION_ASSET_URL_SECRET') {
        return secret
      }
      if (key === 'auth') {
        return { appOrigin: origin }
      }
      return undefined
    },
  } as unknown as ConfigService
}

function tokenFromUrl(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1)
}

describe('NotificationAssetUrlService', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('signs and verifies a news image URL for the configured origin', () => {
    const service = new NotificationAssetUrlService(config(SECRET, 'https://dms.example.com/'))
    const url = service.createNewsImageUrl(ASSET_ID)

    expect(url).toMatch(/^https:\/\/dms\.example\.com\/api\/public\/notification-assets\/[^/]+\.[^/]+$/u)
    const token = tokenFromUrl(url!)
    expect(service.verifyNewsImageToken(token)).toBe(ASSET_ID)
  })

  it('disables signing without a sufficiently long secret', () => {
    const missing = new NotificationAssetUrlService(config(undefined))
    expect(missing.createNewsImageUrl(ASSET_ID)).toBeNull()
    expect(missing.verifyNewsImageToken('payload.signature')).toBeNull()

    const short = new NotificationAssetUrlService(config('too-short'))
    expect(short.createNewsImageUrl(ASSET_ID)).toBeNull()
  })

  it('rejects tampered signatures and payloads', () => {
    const service = new NotificationAssetUrlService(config(SECRET))
    const token = tokenFromUrl(service.createNewsImageUrl(ASSET_ID)!)
    const [payload, signature] = token.split('.') as [string, string]

    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    expect(service.verifyNewsImageToken(`${payload}.${tamperedSignature}`)).toBeNull()

    const forgedPayload = Buffer.from(JSON.stringify({
      a: '00000000-0000-4000-8000-000000000555',
      p: 'NEWS_IMAGE',
      e: Math.floor(Date.now() / 1_000) + 60,
    })).toString('base64url')
    expect(service.verifyNewsImageToken(`${forgedPayload}.${signature}`)).toBeNull()
    expect(service.verifyNewsImageToken('')).toBeNull()
  })

  it('rejects expired tokens and tokens signed for another purpose', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-11-26T00:00:00.000Z'))
    const service = new NotificationAssetUrlService(config(SECRET))
    const token = tokenFromUrl(service.createNewsImageUrl(ASSET_ID)!)
    expect(service.verifyNewsImageToken(token)).toBe(ASSET_ID)

    jest.setSystemTime(new Date('2026-12-04T00:00:00.000Z'))
    expect(service.verifyNewsImageToken(token)).toBeNull()

    const payload = Buffer.from(JSON.stringify({
      a: ASSET_ID,
      p: 'SOMETHING_ELSE',
      e: Math.floor(Date.now() / 1_000) + 60,
    })).toString('base64url')
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url')
    expect(service.verifyNewsImageToken(`${payload}.${signature}`)).toBeNull()
  })
})
