const NODE_ENV_VALUES = ['development', 'test', 'production'] as const

type NodeEnvironment = (typeof NODE_ENV_VALUES)[number]

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

/**
 * 校验并规范化 Nest 配置输入。
 *
 * 保留未知键是为了让 Nest ConfigModule 仍可向后续、独立的配置命名空间传递环境变量；
 * 本函数只接管当前启动基线明确拥有的三个键，避免无意删除宿主环境中的其他配置。
 */
export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> & {
  NODE_ENV: NodeEnvironment
  PORT: number
  DATABASE_URL: string
} {
  return {
    ...input,
    NODE_ENV: normalizeNodeEnvironment(input.NODE_ENV),
    PORT: normalizePort(input.PORT),
    DATABASE_URL: normalizeDatabaseUrl(input.DATABASE_URL),
  }
}
