import { normalizeMediaEnvironment } from './media.config'

const NODE_ENV_VALUES = ['development', 'test', 'production'] as const
const DEFAULT_APP_ORIGIN = 'http://127.0.0.1:9000'
const DEFAULT_TRUST_PROXY_HOPS = 0
const MAX_TRUST_PROXY_HOPS = 2
const DEFAULT_ARGON2_CONCURRENCY = 2
const MAX_ARGON2_CONCURRENCY = 64
const DEFAULT_ARGON2_QUEUE_LIMIT = 32
const MAX_ARGON2_QUEUE_LIMIT = 4_096
const HMAC_KEY_BYTES = 32
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const AUTH_HMAC_KEY_NAMES = [
  'AUTH_USERNAME_HMAC_KEY',
  'AUTH_USER_ID_HMAC_KEY',
  'AUTH_IP_HMAC_KEY',
] as const

type NodeEnvironment = (typeof NODE_ENV_VALUES)[number]
type AuthHmacKeyName = (typeof AUTH_HMAC_KEY_NAMES)[number]

function validationError(key: string, constraint: string): Error {
  // 环境变量可能包含密码或连接信息，因此异常只描述键名和固定约束，绝不拼接原值或底层解析器错误。
  return new Error(`Environment validation failed: ${key} ${constraint}`)
}

function normalizeNodeEnvironment(value: unknown): NodeEnvironment {
  const nodeEnvironment = value ?? 'development'

  if (
    typeof nodeEnvironment !== 'string' ||
    !NODE_ENV_VALUES.includes(nodeEnvironment as NodeEnvironment)
  ) {
    throw validationError(
      'NODE_ENV',
      'must be one of development, test, production',
    )
  }

  return nodeEnvironment as NodeEnvironment
}

function normalizePort(value: unknown): number {
  if (value === undefined) {
    return 3000
  }

  // Record 输入在类型层允许任意值；先收窄到环境变量实际支持的原始类型，避免触发恶意 valueOf 或泄漏转换异常。
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw validationError(
      'PORT',
      'must be an integer between 1 and 65535',
    )
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw validationError(
      'PORT',
      'must be an integer between 1 and 65535',
    )
  }

  return port
}

function normalizeDatabaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError('DATABASE_URL', 'is required')
  }

  const databaseUrl = value.trim()

  if (
    !databaseUrl.startsWith('postgres://') &&
    !databaseUrl.startsWith('postgresql://')
  ) {
    throw validationError(
      'DATABASE_URL',
      'must use postgres:// or postgresql:// URL',
    )
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    throw validationError('DATABASE_URL', 'must be a valid URL')
  }

  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw validationError(
      'DATABASE_URL',
      'must use postgres:// or postgresql:// URL',
    )
  }

  return databaseUrl
}

function normalizeBoundedInteger(
  key: string,
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') {
    return defaultValue
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw validationError(
      key,
      `must be an integer between ${minimum} and ${maximum}`,
    )
  }

  const normalized = Number(value)
  if (
    !Number.isInteger(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw validationError(
      key,
      `must be an integer between ${minimum} and ${maximum}`,
    )
  }

  return normalized
}

function normalizeAppOrigin(
  value: unknown,
  nodeEnvironment: NodeEnvironment,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (nodeEnvironment === 'production') {
      throw validationError('APP_ORIGIN', 'is required')
    }

    return DEFAULT_APP_ORIGIN
  }

  const candidate = value.trim()
  let parsed: URL

  try {
    parsed = new URL(candidate)
  }
  catch {
    throw validationError('APP_ORIGIN', 'must be a valid absolute origin')
  }

  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw validationError(
      'APP_ORIGIN',
      'must be an origin without credentials, path, query, or fragment',
    )
  }

  if (nodeEnvironment === 'production') {
    if (parsed.protocol !== 'https:') {
      throw validationError('APP_ORIGIN', 'must use https in production')
    }
  }
  else {
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !LOOPBACK_HOSTS.has(parsed.hostname)
    ) {
      throw validationError(
        'APP_ORIGIN',
        'must use an exact loopback host outside production',
      )
    }
  }

  return parsed.origin
}

function normalizeAuthHmacKey(
  key: AuthHmacKeyName,
  value: unknown,
  nodeEnvironment: NodeEnvironment,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (nodeEnvironment === 'production') {
      throw validationError(key, 'is required in production')
    }

    return undefined
  }

  const candidate = value.trim()
  let decoded: Buffer

  try {
    decoded = Buffer.from(candidate, 'base64url')
  }
  catch {
    throw validationError(
      key,
      'must be base64url encoding exactly 32 bytes',
    )
  }

  // round-trip 同时拒绝 padding、非 canonical 字符和 Node 宽松解码接受的尾随垃圾。
  if (
    decoded.length !== HMAC_KEY_BYTES ||
    decoded.toString('base64url') !== candidate
  ) {
    throw validationError(
      key,
      'must be base64url encoding exactly 32 bytes',
    )
  }

  return candidate
}

function normalizeAuthHmacKeys(
  input: Record<string, unknown>,
  nodeEnvironment: NodeEnvironment,
): Partial<Record<AuthHmacKeyName, string>> {
  const normalized: Partial<Record<AuthHmacKeyName, string>> = {}

  for (const key of AUTH_HMAC_KEY_NAMES) {
    const value = normalizeAuthHmacKey(key, input[key], nodeEnvironment)
    if (value !== undefined) {
      normalized[key] = value
    }
  }

  const values = Object.values(normalized)
  if (new Set(values).size !== values.length) {
    throw validationError('AUTH_HMAC_KEYS', 'must be distinct')
  }

  return normalized
}

/**
 * 校验并规范化 Nest 配置输入。
 *
 * 保留未知键是为了让 Nest ConfigModule 仍可向后续、独立的配置命名空间传递环境变量；
 * 本函数只接管当前启动基线明确拥有的键，避免无意删除宿主环境中的其他配置。
 */
export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> & {
  NODE_ENV: NodeEnvironment
  PORT: number
  DATABASE_URL: string
  APP_ORIGIN: string
  TRUST_PROXY_HOPS: number
  AUTH_ARGON2_CONCURRENCY: number
  AUTH_ARGON2_QUEUE_LIMIT: number
  MEDIA_STORAGE_DRIVER: 'local'
  MEDIA_STORAGE_ROOT: string
  MEDIA_STAGING_TTL_HOURS: number
  MEDIA_TRASH_RETENTION_DAYS: number
  AUTH_USERNAME_HMAC_KEY?: string
  AUTH_USER_ID_HMAC_KEY?: string
  AUTH_IP_HMAC_KEY?: string
} {
  const nodeEnvironment = normalizeNodeEnvironment(input.NODE_ENV)
  const hmacKeys = normalizeAuthHmacKeys(input, nodeEnvironment)
  const mediaEnvironment = normalizeMediaEnvironment(input)
  const normalized: Record<string, unknown> & {
    NODE_ENV: NodeEnvironment
    PORT: number
    DATABASE_URL: string
    APP_ORIGIN: string
    TRUST_PROXY_HOPS: number
    AUTH_ARGON2_CONCURRENCY: number
    AUTH_ARGON2_QUEUE_LIMIT: number
    MEDIA_STORAGE_DRIVER: 'local'
    MEDIA_STORAGE_ROOT: string
    MEDIA_STAGING_TTL_HOURS: number
    MEDIA_TRASH_RETENTION_DAYS: number
  } = {
    ...input,
    NODE_ENV: nodeEnvironment,
    PORT: normalizePort(input.PORT),
    DATABASE_URL: normalizeDatabaseUrl(input.DATABASE_URL),
    APP_ORIGIN: normalizeAppOrigin(input.APP_ORIGIN, nodeEnvironment),
    TRUST_PROXY_HOPS: normalizeBoundedInteger(
      'TRUST_PROXY_HOPS',
      input.TRUST_PROXY_HOPS,
      DEFAULT_TRUST_PROXY_HOPS,
      0,
      MAX_TRUST_PROXY_HOPS,
    ),
    AUTH_ARGON2_CONCURRENCY: normalizeBoundedInteger(
      'AUTH_ARGON2_CONCURRENCY',
      input.AUTH_ARGON2_CONCURRENCY,
      DEFAULT_ARGON2_CONCURRENCY,
      1,
      MAX_ARGON2_CONCURRENCY,
    ),
    AUTH_ARGON2_QUEUE_LIMIT: normalizeBoundedInteger(
      'AUTH_ARGON2_QUEUE_LIMIT',
      input.AUTH_ARGON2_QUEUE_LIMIT,
      DEFAULT_ARGON2_QUEUE_LIMIT,
      0,
      MAX_ARGON2_QUEUE_LIMIT,
    ),
    ...mediaEnvironment,
    ...hmacKeys,
  }

  // 非 production 的空占位符代表启动时生成随机进程级 key，不能把空字符串留给 ConfigService。
  for (const key of AUTH_HMAC_KEY_NAMES) {
    if (!(key in hmacKeys)) {
      delete normalized[key]
    }
  }

  return normalized
}
