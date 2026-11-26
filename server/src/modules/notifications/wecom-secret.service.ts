import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

export const WECOM_SECRET_KEY = Symbol('qianshu.wecom.secret-key')

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const PAYLOAD_PARTS = 4

export class WecomSecretUnavailableError extends Error {
  constructor() {
    super('WECOM secret key is not configured')
    this.name = 'WecomSecretUnavailableError'
  }
}

export class WecomSecretInvalidError extends Error {
  constructor() {
    // 不携带密文、IV、tag 或底层异常，避免把凭据细节带进日志与响应。
    super('WECOM secret payload is invalid')
    this.name = 'WecomSecretInvalidError'
  }
}

/**
 * WECOM 应用 Secret 与群机器人 webhook key 的静态加密。
 *
 * 密文格式为 `v1.<iv>.<tag>.<ciphertext>`，三段均为 base64url；密钥来自
 * `WECOM_APP_SECRET_KEY` 环境变量，不落库、不返回前端、不写日志。
 */
@Injectable()
export class WecomSecretService {
  private readonly key: Buffer | null

  constructor(@Inject(WECOM_SECRET_KEY) rawKey: string | null) {
    if (rawKey === null) {
      this.key = null
      return
    }

    const decoded = Buffer.from(rawKey, 'base64url')
    if (decoded.length !== KEY_BYTES || decoded.toString('base64url') !== rawKey) {
      throw new WecomSecretInvalidError()
    }
    this.key = decoded
  }

  get available(): boolean {
    return this.key !== null
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey()
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()

    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.')
  }

  decrypt(payload: string): string {
    const key = this.requireKey()
    const parts = payload.split('.')
    if (parts.length !== PAYLOAD_PARTS || parts[0] !== VERSION) {
      throw new WecomSecretInvalidError()
    }

    try {
      const iv = Buffer.from(parts[1] ?? '', 'base64url')
      const tag = Buffer.from(parts[2] ?? '', 'base64url')
      const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new WecomSecretInvalidError()
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8')
    }
    catch (error) {
      if (error instanceof WecomSecretInvalidError) {
        throw error
      }
      throw new WecomSecretInvalidError()
    }
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new WecomSecretUnavailableError()
    }
    return this.key
  }
}
