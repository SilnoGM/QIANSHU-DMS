import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  AuthCapacityUnavailableError,
  PasswordOperationFailedError,
  PasswordPolicyViolationError,
  PasswordProvider,
  type PasswordArgon2Driver,
  type PasswordHashOptions,
} from './password.provider'
import type { AuthMetricLogger } from '../../../infrastructure/observability/auth-metric.logger'

const validPassword = 'correct-password'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })

  return { promise, resolve }
}

const createDriver = (
  overrides: Partial<PasswordArgon2Driver> = {},
): jest.Mocked<PasswordArgon2Driver> =>
  ({
    hash: jest.fn(() => Promise.resolve('$argon2id$test-hash')),
    verify: jest.fn(() => Promise.resolve(true)),
    ...overrides,
  }) as jest.Mocked<PasswordArgon2Driver>

describe('PasswordProvider password policy', () => {
  it('在 hash 前执行 NFC，且不 trim 密码', async () => {
    const driver = createDriver()
    const provider = new PasswordProvider({ driver })
    const password = `  cafe\u0301-password  `

    await expect(provider.hash(password)).resolves.toBe('$argon2id$test-hash')
    expect(driver.hash).toHaveBeenCalledWith(
      '  café-password  ',
      expect.objectContaining({
        memoryCost: ARGON2_MEMORY_COST_KIB,
        timeCost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
      }) as PasswordHashOptions,
    )
  })

  it.each([
    ['低于 8 个 Unicode code point', '😀'.repeat(7)],
    ['超过 20 个 Unicode code point', '😀'.repeat(21)],
  ])('拒绝%s', async (_description, password) => {
    const driver = createDriver()
    const provider = new PasswordProvider({ driver })

    await expect(provider.hash(password)).rejects.toBeInstanceOf(
      PasswordPolicyViolationError,
    )
    expect(driver.hash).not.toHaveBeenCalled()
  })

  it.each([8, 20])(
    '按 Unicode code point 接受 %i 个字符的边界',
    async (length) => {
      const driver = createDriver()
      const provider = new PasswordProvider({ driver })

      await expect(provider.hash('😀'.repeat(length))).resolves.toBe(
        '$argon2id$test-hash',
      )
    },
  )

  it('verify 对输入执行相同 NFC 规范化', async () => {
    const driver = createDriver()
    const provider = new PasswordProvider({ driver })

    await expect(
      provider.verify('cafe\u0301-secure-password', '$argon2id$stored'),
    ).resolves.toBe(true)
    expect(driver.verify).toHaveBeenCalledWith(
      '$argon2id$stored',
      'café-secure-password',
    )
  })

  it('verify 在 Argon2 前拒绝超过 20 个字符的输入且返回 false', async () => {
    const driver = createDriver()
    const provider = new PasswordProvider({ driver })

    await expect(
      provider.verify('a'.repeat(21), '$argon2id$stored'),
    ).resolves.toBe(false)
    expect(driver.verify).not.toHaveBeenCalled()
  })

  it('可注入固定 dummy hash，并通过同一个有界 verify 通道执行', async () => {
    const driver = createDriver({
      verify: jest.fn(() => Promise.resolve(false)),
    })
    const provider = new PasswordProvider({
      driver,
      dummyHash: '$argon2id$fixed-dummy',
    })

    await expect(provider.verifyWithDummyHash(validPassword)).resolves.toBe(false)
    expect(driver.verify).toHaveBeenCalledWith(
      '$argon2id$fixed-dummy',
      validPassword,
    )
  })
})

describe('PasswordProvider Argon2 capacity', () => {
  it('记录 active、queue、拒绝与成功/失败延迟，且 Label 只有固定枚举', async () => {
    const firstHash = createDeferred<string>()
    const queuedVerify = createDeferred<boolean>()
    const driver = createDriver({
      hash: jest
        .fn()
        .mockImplementationOnce(() => firstHash.promise)
        .mockRejectedValueOnce(new Error('native failure with password canary')),
      verify: jest.fn(() => queuedVerify.promise),
    })
    const metrics: jest.Mocked<Pick<
      AuthMetricLogger,
      | 'recordArgon2Capacity'
      | 'recordArgon2Latency'
      | 'recordArgon2Rejected'
    >> = {
      recordArgon2Capacity: jest.fn(),
      recordArgon2Latency: jest.fn(),
      recordArgon2Rejected: jest.fn(),
    }
    const clockValues = [10, 15, 20, 29]
    const provider = new PasswordProvider({
      driver,
      maxActive: 1,
      maxQueued: 1,
      metrics,
      monotonicNow: () => clockValues.shift() ?? 29,
    })

    const active = provider.hash(validPassword)
    const queued = provider.verify(validPassword, '$argon2id$stored')
    const rejected = provider.hash('another-password')

    await expect(rejected).rejects.toBeInstanceOf(AuthCapacityUnavailableError)
    expect(metrics.recordArgon2Rejected).toHaveBeenCalledWith('hash')
    expect(metrics.recordArgon2Capacity).toHaveBeenCalledWith(1, 0)
    expect(metrics.recordArgon2Capacity).toHaveBeenCalledWith(1, 1)

    firstHash.resolve('$argon2id$first')
    await expect(active).resolves.toBe('$argon2id$first')
    expect(metrics.recordArgon2Latency).toHaveBeenCalledWith(
      'hash',
      'success',
      5,
    )
    expect(metrics.recordArgon2Capacity).toHaveBeenCalledWith(1, 0)

    queuedVerify.resolve(true)
    await expect(queued).resolves.toBe(true)
    expect(metrics.recordArgon2Latency).toHaveBeenCalledWith(
      'verify',
      'success',
      9,
    )
    expect(metrics.recordArgon2Capacity).toHaveBeenLastCalledWith(0, 0)

    const failed = provider.hash(validPassword)
    await expect(failed).rejects.toBeInstanceOf(PasswordOperationFailedError)
    expect(metrics.recordArgon2Latency).toHaveBeenLastCalledWith(
      'hash',
      'failure',
      0,
    )
    expect(JSON.stringify(metrics)).not.toContain(validPassword)
  })

  it('让 hash 与 verify 共用有界 active 和 queue，并在饱和时返回固定错误', async () => {
    const firstHash = createDeferred<string>()
    const queuedVerify = createDeferred<boolean>()
    const driver = createDriver({
      hash: jest.fn(() => firstHash.promise),
      verify: jest.fn(() => queuedVerify.promise),
    })
    const provider = new PasswordProvider({
      driver,
      maxActive: 1,
      maxQueued: 1,
    })

    const active = provider.hash(validPassword)
    const queued = provider.verify(validPassword, '$argon2id$stored')
    const rejected = provider.hash('another-password')

    await expect(rejected).rejects.toMatchObject({
      name: 'AuthCapacityUnavailableError',
      code: 'AUTH_CAPACITY_UNAVAILABLE',
      message: 'Argon2 capacity is temporarily unavailable',
    })
    await expect(rejected).rejects.toBeInstanceOf(AuthCapacityUnavailableError)
    expect(JSON.stringify(await rejected.catch((error: unknown) => error))).not.toContain(
      'another-password',
    )
    expect(driver.hash).toHaveBeenCalledTimes(1)
    expect(driver.verify).not.toHaveBeenCalled()

    firstHash.resolve('$argon2id$first')
    await expect(active).resolves.toBe('$argon2id$first')
    expect(driver.verify).toHaveBeenCalledTimes(1)

    queuedVerify.resolve(true)
    await expect(queued).resolves.toBe(true)
  })

  it('不向调用方泄露 Argon2 底层异常', async () => {
    const driver = createDriver({
      hash: jest.fn(() =>
        Promise.reject(
          new Error(`native failure containing ${validPassword}`),
        ),
      ),
    })
    const provider = new PasswordProvider({ driver })

    const operation = provider.hash(validPassword)

    await expect(operation).rejects.toBeInstanceOf(PasswordOperationFailedError)
    await expect(operation).rejects.toMatchObject({
      code: 'PASSWORD_OPERATION_FAILED',
      message: 'Password operation failed',
    })
    expect(JSON.stringify(await operation.catch((error: unknown) => error))).not.toContain(
      validPassword,
    )
  })
})

describe('PasswordProvider Argon2 integration', () => {
  it('生成 Argon2id PHC，并使用不低于设计基线的参数', async () => {
    const provider = new PasswordProvider({ maxActive: 1, maxQueued: 0 })
    const hash = await provider.hash(validPassword)

    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
    )
    await expect(provider.verify(validPassword, hash)).resolves.toBe(true)
    await expect(provider.verify('incorrect-password', hash)).resolves.toBe(false)
    await expect(provider.verifyWithDummyHash(validPassword)).resolves.toBe(false)
  })
})
