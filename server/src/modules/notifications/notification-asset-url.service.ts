import { createHmac, timingSafeEqual } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { AuthConfiguration } from '../../config/auth.config'

const NEWS_IMAGE_PURPOSE = 'NEWS_IMAGE'
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
const MINIMUM_SECRET_LENGTH = 32

/**
 * NEWS 图片需要企业微信主动抓取公网 URL；DMS 媒体默认私有，因此签发短期 HMAC token。
 * token 只包含资产 ID、用途和过期时间，不包含用户或通知内容。
 */
@Injectable()
export class NotificationAssetUrlService {
  constructor(private readonly configService: ConfigService) {}

  createNewsImageUrl(assetId: string): string | null {
    const secret = this.secret()
    const origin = this.appOrigin()
    if (secret === null) {
      return null
    }
    const payload = Buffer.from(JSON.stringify({
      a: assetId,
      p: NEWS_IMAGE_PURPOSE,
      e: Math.floor(Date.now() / 1_000) + TOKEN_TTL_SECONDS,
    })).toString('base64url')
    const signature = createHmac('sha256', secret).update(payload).digest('base64url')
    return `${origin}/api/public/notification-assets/${payload}.${signature}`
  }

  verifyNewsImageToken(token: string): string | null {
    const secret = this.secret()
    if (secret === null) {
      return null
    }
    const separator = token.lastIndexOf('.')
    if (separator <= 0 || separator === token.length - 1) {
      return null
    }
    const payload = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    const actualBytes = Buffer.from(signature)
    const expectedBytes = Buffer.from(expected)
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      return null
    }
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      if (
        parsed.p !== NEWS_IMAGE_PURPOSE
        || typeof parsed.a !== 'string'
        || parsed.a.length === 0
        || typeof parsed.e !== 'number'
        || parsed.e <= Math.floor(Date.now() / 1_000)
      ) {
        return null
      }
      return parsed.a
    }
    catch {
      return null
    }
  }

  private secret(): string | null {
    const value = this.configService.get<string>('NOTIFICATION_ASSET_URL_SECRET')
    return typeof value === 'string' && value.length >= MINIMUM_SECRET_LENGTH ? value : null
  }

  private appOrigin(): string {
    const auth = this.configService.get<AuthConfiguration>('auth')
    return (auth?.appOrigin ?? 'http://127.0.0.1:9000').replace(/\/$/u, '')
  }
}
