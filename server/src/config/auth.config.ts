import { randomBytes } from 'node:crypto'

import { registerAs } from '@nestjs/config'

export const SESSION_IDLE_TIMEOUT_MS = 48 * 60 * 60 * 1_000
export const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1_000
export const SESSION_TOUCH_WINDOW_MS = 5 * 60 * 1_000

const AUTH_CONFIGURATION_ERROR = 'Authentication configuration is incomplete'
const HMAC_KEY_BYTES = 32

export interface AuthConfiguration {
  nodeEnv: 'development' | 'test' | 'production'
  appOrigin: string
  trustProxyHops: number
  argon2: {
    concurrency: number
    queueLimit: number
  }
  hmacKeys: {
    username: Buffer
    userId: Buffer
    ip: Buffer
  }
  session: {
    idleTimeoutMs: number
    absoluteTimeoutMs: number
    touchWindowMs: number
  }
}

type RandomBytesSource = (size: number) => Buffer

function readNodeEnvironment(
  value: unknown,
): AuthConfiguration['nodeEnv'] {
  return value === 'test' || value === 'production'
    ? value
    : 'development'
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.length > 0) {
    return Number(value)
  }

  return fallback
}

function readHmacKey(
  value: unknown,
  nodeEnvironment: AuthConfiguration['nodeEnv'],
  randomBytesSource: RandomBytesSource,
): Buffer {
  if (typeof value === 'string' && value.length > 0) {
    const candidate = value.trim()
    const decoded = Buffer.from(candidate, 'base64url')
    if (
      decoded.length === HMAC_KEY_BYTES &&
      decoded.toString('base64url') === candidate
    ) {
      return decoded
    }
  }

  if (nodeEnvironment === 'production') {
    // 启动边界只返回固定错误；真实 key 或解码细节绝不进入日志。
    throw new Error(AUTH_CONFIGURATION_ERROR)
  }

  const generated = randomBytesSource(HMAC_KEY_BYTES)
  if (generated.length !== HMAC_KEY_BYTES) {
    throw new Error(AUTH_CONFIGURATION_ERROR)
  }

  return Buffer.from(generated)
}

/**
 * 把已经过 env.validation 的扁平环境值转换为认证运行时配置。
 *
 * development/test 缺少 HMAC key 时使用进程级 CSPRNG 值，避免在仓库中硬编码
 * 任何通用密钥；production 则必须由部署环境提供三个相互独立的 key。
 */
export function createAuthConfiguration(
  environment: Record<string, unknown> = process.env,
  randomBytesSource: RandomBytesSource = randomBytes,
): AuthConfiguration {
  const nodeEnvironment = readNodeEnvironment(environment.NODE_ENV)

  return {
    nodeEnv: nodeEnvironment,
    appOrigin:
      typeof environment.APP_ORIGIN === 'string'
        ? environment.APP_ORIGIN.trim()
        : 'http://127.0.0.1:9000',
    trustProxyHops: readNumber(environment.TRUST_PROXY_HOPS, 0),
    argon2: {
      concurrency: readNumber(environment.AUTH_ARGON2_CONCURRENCY, 2),
      queueLimit: readNumber(environment.AUTH_ARGON2_QUEUE_LIMIT, 32),
    },
    hmacKeys: {
      username: readHmacKey(
        environment.AUTH_USERNAME_HMAC_KEY,
        nodeEnvironment,
        randomBytesSource,
      ),
      userId: readHmacKey(
        environment.AUTH_USER_ID_HMAC_KEY,
        nodeEnvironment,
        randomBytesSource,
      ),
      ip: readHmacKey(
        environment.AUTH_IP_HMAC_KEY,
        nodeEnvironment,
        randomBytesSource,
      ),
    },
    session: {
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
      touchWindowMs: SESSION_TOUCH_WINDOW_MS,
    },
  }
}

export default registerAs('auth', () => createAuthConfiguration())
