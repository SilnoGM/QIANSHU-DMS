import { randomBytes } from 'node:crypto'

import { registerAs } from '@nestjs/config'

export const DEFAULT_NOTIFICATION_MEDIA_URL_TTL_SECONDS = 900

const HMAC_KEY_BYTES = 32
const CONFIGURATION_ERROR = 'Notification media configuration is incomplete'

type RandomBytesSource = (size: number) => Buffer

export interface NotificationMediaConfiguration {
  /**
   * 公开取流地址的签名密钥。
   *
   * 与认证域的三个 HMAC key 刻意分离：泄露媒体链接不能推出会话标识，
   * 轮换签名密钥也不会让用户掉线。
   */
  readonly urlSecret: Buffer
  readonly urlTtlSeconds: number
}

function readNodeEnvironment(value: unknown): 'development' | 'test' | 'production' {
  return value === 'test' || value === 'production' ? value : 'development'
}

function readSecret(
  value: unknown,
  nodeEnvironment: 'development' | 'test' | 'production',
  randomBytesSource: RandomBytesSource,
): Buffer {
  if (typeof value === 'string' && value.length > 0) {
    const candidate = value.trim()
    const decoded = Buffer.from(candidate, 'base64url')
    if (decoded.length === HMAC_KEY_BYTES && decoded.toString('base64url') === candidate) {
      return decoded
    }
  }

  if (nodeEnvironment === 'production') {
    // 启动边界只返回固定错误，不拼接原始值或解码细节。
    throw new Error(CONFIGURATION_ERROR)
  }

  const generated = randomBytesSource(HMAC_KEY_BYTES)
  if (generated.length !== HMAC_KEY_BYTES) {
    throw new Error(CONFIGURATION_ERROR)
  }
  return Buffer.from(generated)
}

/**
 * development/test 缺少签名密钥时使用进程级随机值：重启后旧链接立即失效，
 * 这正是可接受的行为——派发器每次发送都会现签新链接。
 */
export function createNotificationMediaConfiguration(
  environment: Record<string, unknown> = process.env,
  randomBytesSource: RandomBytesSource = randomBytes,
): NotificationMediaConfiguration {
  return {
    urlSecret: readSecret(
      environment.NOTIFICATION_MEDIA_URL_SECRET,
      readNodeEnvironment(environment.NODE_ENV),
      randomBytesSource,
    ),
    urlTtlSeconds: DEFAULT_NOTIFICATION_MEDIA_URL_TTL_SECONDS,
  }
}

export default registerAs('notificationMedia', () => createNotificationMediaConfiguration())
