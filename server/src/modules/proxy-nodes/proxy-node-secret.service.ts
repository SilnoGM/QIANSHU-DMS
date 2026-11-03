import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

export const PROXY_NODE_SECRET_KEY = Symbol('qianshu.proxy-node.secret-key')

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const PAYLOAD_PARTS = 4

export class ProxyNodeSecretUnavailableError extends Error {
  constructor() {
    super('Proxy node secret key is not configured')
    this.name = 'ProxyNodeSecretUnavailableError'
  }
}

export class ProxyNodeSecretInvalidError extends Error {
  constructor() {
    // 不携带密文、IV、tag 或底层异常，避免把凭据细节带进日志与响应。
    super('Proxy node secret payload is invalid')
    this.name = 'ProxyNodeSecretInvalidError'
  }
}

/**
 * 静态节点密码的静态加密。
 *
 * 密文格式为 `v1.<iv>.<tag>.<ciphertext>`，三段均为 base64url。版本段为将来
 * 轮换算法/密钥留出识别位；当前只接受 v1。密钥来自环境变量，不落库、不返回给前端。
 */
@Injectable()
export class ProxyNodeSecretService {
  private readonly key: Buffer | null

  constructor(@Inject(PROXY_NODE_SECRET_KEY) rawKey: string | null) {
    if (rawKey === null) {
      this.key = null
      return
    }

    const decoded = Buffer.from(rawKey, 'base64url')
    if (decoded.length !== KEY_BYTES || decoded.toString('base64url') !== rawKey) {
      throw new ProxyNodeSecretInvalidError()
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
      throw new ProxyNodeSecretInvalidError()
    }

    try {
      const iv = Buffer.from(parts[1] ?? '', 'base64url')
      const tag = Buffer.from(parts[2] ?? '', 'base64url')
      const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new ProxyNodeSecretInvalidError()
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8')
    }
    catch (error) {
      if (error instanceof ProxyNodeSecretInvalidError) {
        throw error
      }
      throw new ProxyNodeSecretInvalidError()
    }
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new ProxyNodeSecretUnavailableError()
    }
    return this.key
  }
}
