import {
  createAuthConfiguration,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_WINDOW_MS,
} from './auth.config'

describe('createAuthConfiguration', () => {
  it('keeps the confirmed 48-hour, 30-day and 5-minute Session timings', () => {
    const configuration = createAuthConfiguration(
      {
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://127.0.0.1:9000',
        TRUST_PROXY_HOPS: 0,
        AUTH_ARGON2_CONCURRENCY: 2,
        AUTH_ARGON2_QUEUE_LIMIT: 32,
      },
      size => Buffer.alloc(size, 7),
    )

    expect(SESSION_IDLE_TIMEOUT_MS).toBe(48 * 60 * 60 * 1_000)
    expect(SESSION_ABSOLUTE_TIMEOUT_MS).toBe(30 * 24 * 60 * 60 * 1_000)
    expect(SESSION_TOUCH_WINDOW_MS).toBe(5 * 60 * 1_000)
    expect(configuration.session).toEqual({
      absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      touchWindowMs: SESSION_TOUCH_WINDOW_MS,
    })
  })

  it('decodes three independent configured HMAC keys', () => {
    const configuration = createAuthConfiguration({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://dms.example.com',
      TRUST_PROXY_HOPS: 1,
      AUTH_ARGON2_CONCURRENCY: 4,
      AUTH_ARGON2_QUEUE_LIMIT: 64,
      AUTH_USERNAME_HMAC_KEY: Buffer.alloc(32, 1).toString('base64url'),
      AUTH_USER_ID_HMAC_KEY: Buffer.alloc(32, 2).toString('base64url'),
      AUTH_IP_HMAC_KEY: Buffer.alloc(32, 3).toString('base64url'),
    })

    expect(configuration).toMatchObject({
      appOrigin: 'https://dms.example.com',
      argon2: { concurrency: 4, queueLimit: 64 },
      nodeEnv: 'production',
      trustProxyHops: 1,
    })
    expect(configuration.hmacKeys.username).toEqual(Buffer.alloc(32, 1))
    expect(configuration.hmacKeys.userId).toEqual(Buffer.alloc(32, 2))
    expect(configuration.hmacKeys.ip).toEqual(Buffer.alloc(32, 3))
  })

  it('creates process-local random development keys without hard-coded fallbacks', () => {
    let sequence = 0
    const configuration = createAuthConfiguration(
      {
        NODE_ENV: 'development',
        APP_ORIGIN: 'http://localhost:9000',
        TRUST_PROXY_HOPS: 0,
        AUTH_ARGON2_CONCURRENCY: 2,
        AUTH_ARGON2_QUEUE_LIMIT: 32,
      },
      (size) => {
        sequence += 1
        return Buffer.alloc(size, sequence)
      },
    )

    expect(configuration.hmacKeys.username).toEqual(Buffer.alloc(32, 1))
    expect(configuration.hmacKeys.userId).toEqual(Buffer.alloc(32, 2))
    expect(configuration.hmacKeys.ip).toEqual(Buffer.alloc(32, 3))
  })

  it('fails with a fixed message when production keys are missing', () => {
    expect(() =>
      createAuthConfiguration({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://dms.example.com',
        TRUST_PROXY_HOPS: 1,
        AUTH_ARGON2_CONCURRENCY: 2,
        AUTH_ARGON2_QUEUE_LIMIT: 32,
      }),
    ).toThrow('Authentication configuration is incomplete')
  })
})
