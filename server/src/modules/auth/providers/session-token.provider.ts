import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'

import { Injectable } from '@nestjs/common'

const SESSION_SECRET_BYTE_LENGTH = 32
const SESSION_TOKEN_HASH_BYTE_LENGTH = 32
const SESSION_SECRET_ENCODED_LENGTH = 43
const SESSION_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const INVALID_SESSION_SECRET_MESSAGE = 'Invalid session secret'
const CONSTANT_TIME_DUMMY_HASH = Buffer.alloc(SESSION_TOKEN_HASH_BYTE_LENGTH)

export type ParsedSessionToken = Readonly<{
  sessionId: string
  secret: string
}>

export type GeneratedSessionToken = Readonly<
  ParsedSessionToken & {
    tokenHash: Buffer
    value: string
  }
>

/**
 * 创建和校验 opaque Session Token。
 *
 * Cookie 中保存 `uuid.secret`，数据库只保存 selector 和 secret 的 SHA-256；
 * 这里不承载 JWT、Remember Me 或设备信息。
 */
@Injectable()
export class SessionTokenProvider {
  generate(): GeneratedSessionToken {
    const sessionId = randomUUID()
    const secretBytes = randomBytes(SESSION_SECRET_BYTE_LENGTH)
    const secret = secretBytes.toString('base64url')

    return {
      sessionId,
      secret,
      tokenHash: this.hashSecretBytes(secretBytes),
      value: `${sessionId}.${secret}`,
    }
  }

  parse(value: string): ParsedSessionToken | null {
    if (typeof value !== 'string') {
      return null
    }

    const segments = value.split('.')

    if (segments.length !== 2) {
      return null
    }

    const [sessionId, secret] = segments

    if (!SESSION_ID_PATTERN.test(sessionId) || !this.decodeSecret(secret)) {
      return null
    }

    return { sessionId, secret }
  }

  hashSecret(secret: string): Buffer {
    const secretBytes = this.decodeSecret(secret)

    if (!secretBytes) {
      throw new Error(INVALID_SESSION_SECRET_MESSAGE)
    }

    return this.hashSecretBytes(secretBytes)
  }

  matchesTokenHash(secret: string, expectedTokenHash: Uint8Array): boolean {
    const secretBytes = this.decodeSecret(secret)
    const hasValidSecret = secretBytes !== null
    const actualTokenHash = this.hashSecretBytes(
      secretBytes ?? Buffer.alloc(SESSION_SECRET_BYTE_LENGTH),
    )
    const hasValidExpectedHash =
      expectedTokenHash instanceof Uint8Array &&
      expectedTokenHash.byteLength === SESSION_TOKEN_HASH_BYTE_LENGTH
    const comparableExpectedHash = hasValidExpectedHash
      ? Buffer.from(expectedTokenHash)
      : CONSTANT_TIME_DUMMY_HASH

    // timingSafeEqual 要求长度一致；无效长度也走固定 32-byte 比较，再用布尔标记返回 false。
    const hashesMatch = timingSafeEqual(
      actualTokenHash,
      comparableExpectedHash,
    )

    return hasValidSecret && hasValidExpectedHash && hashesMatch
  }

  private decodeSecret(secret: string): Buffer | null {
    if (
      typeof secret !== 'string' ||
      secret.length !== SESSION_SECRET_ENCODED_LENGTH ||
      !SESSION_SECRET_PATTERN.test(secret)
    ) {
      return null
    }

    const decoded = Buffer.from(secret, 'base64url')

    // Node 的 base64url 解码器有意宽松，必须重新编码以拒绝 padding 或非零 unused bits 等别名。
    if (
      decoded.byteLength !== SESSION_SECRET_BYTE_LENGTH ||
      decoded.toString('base64url') !== secret
    ) {
      return null
    }

    return decoded
  }

  private hashSecretBytes(secretBytes: Uint8Array): Buffer {
    return createHash('sha256').update(secretBytes).digest()
  }
}
