import * as argon2 from 'argon2'

export const PASSWORD_MIN_CODE_POINTS = 15
export const PASSWORD_MAX_CODE_POINTS = 128

export const ARGON2_MEMORY_COST_KIB = 19_456
export const ARGON2_TIME_COST = 2
export const ARGON2_PARALLELISM = 1

const DEFAULT_MAX_ACTIVE = 2
const DEFAULT_MAX_QUEUED = 32

/**
 * 不对应任何真实用户的固定 PHC。登录名不存在时仍执行同成本 verify，避免通过
 * “是否发生 Argon2”区分账号是否存在。固定值允许多实例保持一致，也避免启动时
 * 临时 Hash 占用容量；其明文不是凭证，因此不属于需要保密的配置。
 */
export const DEFAULT_DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$xLYES6A99J5FnmCarE8NKA$9Q+8rOd/zsZ92EuGJlFe32JtYzQLhdG7y8mWIzUPYuE'

export interface PasswordHashOptions {
  type: typeof argon2.argon2id
  memoryCost: number
  timeCost: number
  parallelism: number
  hashLength: number
}

export const PASSWORD_HASH_OPTIONS: Readonly<PasswordHashOptions> =
  Object.freeze({
    type: argon2.argon2id,
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: 32,
  })

/**
 * 将原生库隔离在很小的接口后，单元测试可以精确控制慢任务、失败和队列顺序，
 * 同时生产代码仍直接使用经过固定版本审查的 node-argon2 实现。
 */
export interface PasswordArgon2Driver {
  hash(
    normalizedPassword: string,
    options: Readonly<PasswordHashOptions>,
  ): Promise<string>
  verify(passwordHash: string, normalizedPassword: string): Promise<boolean>
}

export interface PasswordProviderOptions {
  maxActive?: number
  maxQueued?: number
  dummyHash?: string
  driver?: PasswordArgon2Driver
}

interface QueuedOperation {
  operation(): Promise<unknown>
  resolve(value: unknown): void
  reject(reason: unknown): void
}

const nativeArgon2Driver: PasswordArgon2Driver = {
  hash: (normalizedPassword, options) =>
    argon2.hash(normalizedPassword, options),
  verify: (passwordHash, normalizedPassword) =>
    argon2.verify(passwordHash, normalizedPassword),
}

export class PasswordPolicyViolationError extends Error {
  readonly code = 'PASSWORD_POLICY_VIOLATION'

  constructor() {
    super('Password must contain 15 to 128 Unicode code points')
    this.name = 'PasswordPolicyViolationError'
  }
}

export class AuthCapacityUnavailableError extends Error {
  readonly code = 'AUTH_CAPACITY_UNAVAILABLE'

  constructor() {
    super('Argon2 capacity is temporarily unavailable')
    this.name = 'AuthCapacityUnavailableError'
  }
}

export class PasswordOperationFailedError extends Error {
  readonly code = 'PASSWORD_OPERATION_FAILED'

  constructor() {
    // 不设置 cause：原生异常可能包含输入或本机实现细节，不能穿透到 API 层或日志。
    super('Password operation failed')
    this.name = 'PasswordOperationFailedError'
  }
}

/** 密码只做 NFC，不得 trim；空格本身属于密码内容。 */
export const normalizePassword = (password: string): string =>
  password.normalize('NFC')

export const isPasswordCodePointLengthValid = (password: string): boolean => {
  let codePointLength = 0
  const codePoints = password[Symbol.iterator]()

  // 不创建完整 code point 数组，并在超过上限时立即停止，避免异常大输入产生额外内存峰值。
  while (!codePoints.next().done) {
    codePointLength += 1
    if (codePointLength > PASSWORD_MAX_CODE_POINTS) {
      return false
    }
  }

  return (
    codePointLength >= PASSWORD_MIN_CODE_POINTS &&
    codePointLength <= PASSWORD_MAX_CODE_POINTS
  )
}

/**
 * 所有创建、修改和重置密码路径共用此入口，避免某个调用方在 Hash 前漏掉规范化
 * 或把 UTF-16 code unit 误当成 Unicode code point。
 */
export const normalizeAndValidatePassword = (password: string): string => {
  const normalizedPassword = normalizePassword(password)

  if (!isPasswordCodePointLengthValid(normalizedPassword)) {
    throw new PasswordPolicyViolationError()
  }

  return normalizedPassword
}

export class PasswordProvider {
  private readonly maxActive: number
  private readonly maxQueued: number
  private readonly dummyHash: string
  private readonly driver: PasswordArgon2Driver
  private readonly queue: QueuedOperation[] = []
  private active = 0

  constructor(options: PasswordProviderOptions = {}) {
    this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE
    this.maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED
    this.dummyHash = options.dummyHash ?? DEFAULT_DUMMY_PASSWORD_HASH
    this.driver = options.driver ?? nativeArgon2Driver

    if (!Number.isInteger(this.maxActive) || this.maxActive < 1) {
      throw new TypeError('maxActive must be a positive integer')
    }
    if (!Number.isInteger(this.maxQueued) || this.maxQueued < 0) {
      throw new TypeError('maxQueued must be a non-negative integer')
    }
    if (this.dummyHash.length === 0) {
      throw new TypeError('dummyHash must not be empty')
    }
  }

  async hash(password: string): Promise<string> {
    const normalizedPassword = normalizeAndValidatePassword(password)

    return this.runPasswordOperation(() =>
      this.driver.hash(normalizedPassword, PASSWORD_HASH_OPTIONS),
    )
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const normalizedPassword = normalizePassword(password)

    // 登录输入同样先做长度上限检查，超限或明显不满足策略时不占用昂贵的 Argon2 slot。
    // 调用登录 Service 时应统一映射为 INVALID_CREDENTIALS，不能把具体原因返回客户端。
    if (!isPasswordCodePointLengthValid(normalizedPassword)) {
      return false
    }

    return this.runPasswordOperation(() =>
      this.driver.verify(passwordHash, normalizedPassword),
    )
  }

  /** 账号不存在时调用此方法，保证与真实账号共用完全相同的容量限制与 verify 路径。 */
  verifyWithDummyHash(password: string): Promise<boolean> {
    return this.verify(password, this.dummyHash)
  }

  private async runPasswordOperation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.runBounded(operation)
    } catch (error) {
      if (error instanceof AuthCapacityUnavailableError) {
        throw error
      }

      // 原生异常只在本边界终止；固定错误不会携带密码、PHC 或底层实现信息。
      throw new PasswordOperationFailedError()
    }
  }

  private runBounded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active < this.maxActive) {
      return this.startOperation(operation)
    }

    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new AuthCapacityUnavailableError())
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        operation,
        resolve: (value) => resolve(value as T),
        reject,
      })
    })
  }

  private async startOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.active += 1

    try {
      return await operation()
    } finally {
      this.active -= 1
      this.startNextQueuedOperation()
    }
  }

  private startNextQueuedOperation(): void {
    const next = this.queue.shift()
    if (next === undefined) {
      return
    }

    // startOperation 在调用异步 driver 前同步占住 active slot，因此 drain 期间不会超卖并发。
    void this.startOperation(next.operation).then(next.resolve, next.reject)
  }
}
