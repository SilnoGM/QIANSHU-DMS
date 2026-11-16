import { createHmac, timingSafeEqual } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { API_PREFIX } from '../../app.constants'
import type { AuthConfiguration } from '../../config/auth.config'
import type { NotificationMediaConfiguration } from '../../config/notification-media.config'

const TOKEN_VERSION = 1
const MAX_TOKEN_LENGTH = 4_096
const PUBLIC_MEDIA_PATH = 'public/notification-media'

export type AssistantMediaUrlVerification =
  | { readonly ok: true, readonly deliveryMediaId: string }
  | { readonly ok: false }

interface TokenPayload {
  readonly v: number
  readonly d: string
  readonly e: number
}

function splitOrigin(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/**
 * 公开取流链接的签名与校验。
 *
 * 链接里绑定「投递附件项」而不是资产 ID：校验时还能顺带确认该附件仍属于一条
 * 未取消的投递，并把首次拉取时间写回 `fetched_at`，用于判断上游是否真的来取图。
 *
 * 任何校验失败都返回 `{ ok: false }`，不区分原因、不抛异常——这是一个匿名入口，
 * 错误差异只会给探测者提供信息。
 */
@Injectable()
export class AssistantMediaUrlService {
  constructor(private readonly configService: ConfigService) {}

  sign(deliveryMediaId: string, now: number = Date.now()): string {
    const configuration = this.configuration()
    const payload: TokenPayload = {
      v: TOKEN_VERSION,
      d: deliveryMediaId,
      e: Math.floor(now / 1_000) + configuration.urlTtlSeconds,
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = this.signature(configuration.urlSecret, encoded)
    return `${this.origin()}/${API_PREFIX}/${PUBLIC_MEDIA_PATH}/${encoded}.${signature}`
  }

  verify(token: string, now: number = Date.now()): AssistantMediaUrlVerification {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return { ok: false }
    }
    const parts = token.split('.')
    if (parts.length !== 2) {
      return { ok: false }
    }
    const [encoded, signature] = parts
    if (encoded === undefined || signature === undefined || encoded.length === 0 || signature.length === 0) {
      return { ok: false }
    }

    const configuration = this.configuration()
    const expected = Buffer.from(this.signature(configuration.urlSecret, encoded), 'utf8')
    const provided = Buffer.from(signature, 'utf8')
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return { ok: false }
    }

    let payload: TokenPayload
    try {
      const decoded: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        return { ok: false }
      }
      payload = decoded as TokenPayload
    }
    catch {
      return { ok: false }
    }

    if (payload.v !== TOKEN_VERSION || typeof payload.d !== 'string' || payload.d.length === 0) {
      return { ok: false }
    }
    if (typeof payload.e !== 'number' || !Number.isSafeInteger(payload.e) || payload.e * 1_000 <= now) {
      return { ok: false }
    }
    return { ok: true, deliveryMediaId: payload.d }
  }

  private signature(secret: Buffer, encoded: string): string {
    return createHmac('sha256', secret).update(encoded).digest('base64url')
  }

  private configuration(): NotificationMediaConfiguration {
    const configuration = this.configService.get<NotificationMediaConfiguration>('notificationMedia')
    if (configuration === undefined) {
      throw new Error('Notification media configuration is unavailable')
    }
    return configuration
  }

  private origin(): string {
    const auth = this.configService.get<AuthConfiguration>('auth')
    return splitOrigin(auth?.appOrigin ?? '')
  }
}
