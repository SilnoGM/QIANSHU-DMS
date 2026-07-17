import { createHmac } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

const HMAC_KEY_BYTE_LENGTH = 32
const INVALID_SUBJECT_MESSAGE = 'Invalid authentication subject'
const INVALID_CONFIGURATION_MESSAGE =
  'Authentication subject HMAC configuration is invalid'

type AuthHmacKeyPath =
  | 'auth.hmacKeys.username'
  | 'auth.hmacKeys.userId'
  | 'auth.hmacKeys.ip'

/**
 * 为认证限流与审计主体生成不可逆、固定长度的数据库标识。
 *
 * username、userId 和来源 IP 必须使用三个独立 key，避免相同明文在不同命名空间
 * 产生可关联的摘要。构造时复制 key，调用时始终创建新摘要 Buffer，调用方无法通过
 * 修改外部 Buffer 影响后续结果。
 */
@Injectable()
export class AuthSubjectHasher {
  private readonly usernameKey: Buffer
  private readonly userIdKey: Buffer
  private readonly ipKey: Buffer

  constructor(configService: ConfigService) {
    this.usernameKey = this.readKey(
      configService,
      'auth.hmacKeys.username',
    )
    this.userIdKey = this.readKey(configService, 'auth.hmacKeys.userId')
    this.ipKey = this.readKey(configService, 'auth.hmacKeys.ip')

    if (
      this.usernameKey.equals(this.userIdKey) ||
      this.usernameKey.equals(this.ipKey) ||
      this.userIdKey.equals(this.ipKey)
    ) {
      throw new Error(INVALID_CONFIGURATION_MESSAGE)
    }
  }

  hashUsername(normalizedUsername: string): Buffer {
    return this.hash(normalizedUsername, this.usernameKey)
  }

  hashUserId(userId: string): Buffer {
    return this.hash(userId, this.userIdKey)
  }

  hashIp(sourceIp: string): Buffer {
    return this.hash(sourceIp, this.ipKey)
  }

  private hash(subject: string, key: Buffer): Buffer {
    if (typeof subject !== 'string' || subject.length === 0) {
      // 主体可能来自请求输入，错误中不得包含原值或解析细节。
      throw new Error(INVALID_SUBJECT_MESSAGE)
    }

    return createHmac('sha256', key).update(subject, 'utf8').digest()
  }

  private readKey(
    configService: ConfigService,
    path: AuthHmacKeyPath,
  ): Buffer {
    let key: unknown

    try {
      key = configService.getOrThrow<unknown>(path)
    }
    catch {
      // ConfigService 的原始错误可能带配置路径或解析细节，对外统一为固定错误。
      throw new Error(INVALID_CONFIGURATION_MESSAGE)
    }

    if (!Buffer.isBuffer(key) || key.byteLength !== HMAC_KEY_BYTE_LENGTH) {
      throw new Error(INVALID_CONFIGURATION_MESSAGE)
    }

    return Buffer.from(key)
  }
}
