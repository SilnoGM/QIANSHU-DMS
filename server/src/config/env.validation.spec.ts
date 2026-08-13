import { validateEnvironment } from './env.validation'

describe('validateEnvironment', () => {
  const validDatabaseUrl = 'postgresql://localhost:5432/qianshu_test'
  const validDevelopmentOrigin = 'http://127.0.0.1:9000'
  const productionKeys = {
    AUTH_USERNAME_HMAC_KEY: Buffer.alloc(32, 1).toString('base64url'),
    AUTH_USER_ID_HMAC_KEY: Buffer.alloc(32, 2).toString('base64url'),
    AUTH_IP_HMAC_KEY: Buffer.alloc(32, 3).toString('base64url'),
  }

  it('uses development and port 3000 when optional values are missing', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: validDatabaseUrl,
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
      APP_ORIGIN: validDevelopmentOrigin,
      TRUST_PROXY_HOPS: 0,
      AUTH_ARGON2_CONCURRENCY: 2,
      AUTH_ARGON2_QUEUE_LIMIT: 32,
      MEDIA_STORAGE_DRIVER: 'local',
      MEDIA_STORAGE_ROOT: '/var/lib/qianshu-dms/media',
      MEDIA_STAGING_TTL_HOURS: 24,
      MEDIA_TRASH_RETENTION_DAYS: 7,
    })
  })

  it('normalizes explicit values and preserves unknown keys', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '43100',
        DATABASE_URL: `  ${validDatabaseUrl}  `,
        APP_ORIGIN: '  http://localhost:9000  ',
        TRUST_PROXY_HOPS: '1',
        AUTH_ARGON2_CONCURRENCY: '3',
        AUTH_ARGON2_QUEUE_LIMIT: '48',
        MEDIA_STORAGE_DRIVER: 'local',
        MEDIA_STORAGE_ROOT: '  /srv/qianshu-media/  ',
        MEDIA_STAGING_TTL_HOURS: '36',
        MEDIA_TRASH_RETENTION_DAYS: '14',
        CUSTOM_SETTING: 'kept',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      PORT: 43100,
      DATABASE_URL: validDatabaseUrl,
      APP_ORIGIN: 'http://localhost:9000',
      TRUST_PROXY_HOPS: 1,
      AUTH_ARGON2_CONCURRENCY: 3,
      AUTH_ARGON2_QUEUE_LIMIT: 48,
      MEDIA_STORAGE_DRIVER: 'local',
      MEDIA_STORAGE_ROOT: '/srv/qianshu-media',
      MEDIA_STAGING_TTL_HOURS: 36,
      MEDIA_TRASH_RETENTION_DAYS: 14,
      CUSTOM_SETTING: 'kept',
    })
  })

  it('accepts the postgres hierarchical URL scheme', () => {
    const databaseUrl = 'postgres://localhost:5432/qianshu_test'

    expect(validateEnvironment({ DATABASE_URL: databaseUrl }).DATABASE_URL).toBe(
      databaseUrl,
    )
  })

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    (nodeEnv) => {
      expect(
        validateEnvironment({
          NODE_ENV: nodeEnv,
          DATABASE_URL: validDatabaseUrl,
          ...(nodeEnv === 'production'
            ? {
                APP_ORIGIN: 'https://dms.example.com',
                TRUST_PROXY_HOPS: '1',
                ...productionKeys,
              }
            : {}),
        }).NODE_ENV,
      ).toBe(nodeEnv)
    },
  )

  it.each([
    [undefined, 'Environment validation failed: DATABASE_URL is required'],
    ['', 'Environment validation failed: DATABASE_URL is required'],
    ['   ', 'Environment validation failed: DATABASE_URL is required'],
  ])('rejects a missing or empty DATABASE_URL', (databaseUrl, expected) => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow(expected)
  })

  it('rejects a DATABASE_URL with an unsupported protocol without echoing it', () => {
    const unsafeValue = 'mysql://user:do-not-print@localhost:3306/qianshu'

    expect(() =>
      validateEnvironment({
        DATABASE_URL: unsafeValue,
      }),
    ).toThrow(
      'Environment validation failed: DATABASE_URL must use postgres:// or postgresql:// URL',
    )

    try {
      validateEnvironment({ DATABASE_URL: unsafeValue })
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toContain(unsafeValue)
      expect((error as Error).message).not.toContain('do-not-print')
    }
  })

  it.each(['postgresql:foo', 'postgresql:/foo', 'postgres:opaque'])(
    'rejects a non-hierarchical PostgreSQL URI without echoing it',
    (databaseUrl) => {
      try {
        validateEnvironment({ DATABASE_URL: databaseUrl })
        throw new Error('Expected validation to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe(
          'Environment validation failed: DATABASE_URL must use postgres:// or postgresql:// URL',
        )
        expect((error as Error).message).not.toContain(databaseUrl)
      }
    },
  )

  it('rejects an unparseable DATABASE_URL without exposing parser details', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'postgresql://[invalid',
      }),
    ).toThrow(
      'Environment validation failed: DATABASE_URL must be a valid URL',
    )
  })

  it.each([0, 65536, 1.5, 'not-a-number'])(
    'rejects invalid PORT=%s',
    (port) => {
      expect(() =>
        validateEnvironment({
          PORT: port,
          DATABASE_URL: validDatabaseUrl,
        }),
      ).toThrow(
        'Environment validation failed: PORT must be an integer between 1 and 65535',
      )
    },
  )

  it.each([1, 65535])('accepts boundary PORT=%s', (port) => {
    expect(
      validateEnvironment({
        PORT: port,
        DATABASE_URL: validDatabaseUrl,
      }).PORT,
    ).toBe(port)
  })

  it.each([true, false, null, Symbol('port')])(
    'rejects a non-string and non-number PORT',
    (port) => {
      expect(() =>
        validateEnvironment({
          PORT: port,
          DATABASE_URL: validDatabaseUrl,
        }),
      ).toThrow(
        'Environment validation failed: PORT must be an integer between 1 and 65535',
      )
    },
  )

  it('does not invoke or expose coercion errors from an unknown PORT value', () => {
    const unsafePort = {
      valueOf() {
        throw new Error('port-do-not-print')
      },
    }

    try {
      validateEnvironment({
        PORT: unsafePort,
        DATABASE_URL: validDatabaseUrl,
      })
      throw new Error('Expected validation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(
        'Environment validation failed: PORT must be an integer between 1 and 65535',
      )
      expect((error as Error).message).not.toContain('port-do-not-print')
    }
  })

  it('rejects an unsupported NODE_ENV', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'staging',
        DATABASE_URL: validDatabaseUrl,
      }),
    ).toThrow(
      'Environment validation failed: NODE_ENV must be one of development, test, production',
    )
  })

  describe('media storage environment', () => {
    it.each([
      ['MEDIA_STORAGE_DRIVER', 's3', 'must be local'],
      ['MEDIA_STORAGE_ROOT', 'relative/media', 'must be an absolute non-root path'],
      ['MEDIA_STAGING_TTL_HOURS', '0', 'must be an integer between 1 and 168'],
      ['MEDIA_TRASH_RETENTION_DAYS', '6', 'must be an integer between 7 and 3650'],
    ])('rejects invalid %s without echoing its value', (key, value, constraint) => {
      try {
        validateEnvironment({
          DATABASE_URL: validDatabaseUrl,
          [key]: value,
        })
        throw new Error('Expected media environment validation to fail')
      }
      catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe(
          `Environment validation failed: ${key} ${constraint}`,
        )
        if (value.includes('/') || value === 's3') {
          expect((error as Error).message).not.toContain(value)
        }
      }
    })
  })

  describe('authentication environment', () => {
    it('accepts a complete production origin, proxy and independent HMAC key set', () => {
      expect(
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: validDatabaseUrl,
          APP_ORIGIN: 'https://dms.example.com',
          TRUST_PROXY_HOPS: '1',
          ...productionKeys,
        }),
      ).toMatchObject({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://dms.example.com',
        TRUST_PROXY_HOPS: 1,
        ...productionKeys,
      })
    })

    it.each([
      ['http://dms.example.com', 'must use https in production'],
      ['https://user@dms.example.com', 'must be an origin without credentials, path, query, or fragment'],
      ['https://dms.example.com/app', 'must be an origin without credentials, path, query, or fragment'],
      ['https://dms.example.com?x=1', 'must be an origin without credentials, path, query, or fragment'],
    ])('rejects invalid production APP_ORIGIN=%s', (appOrigin, constraint) => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: validDatabaseUrl,
          APP_ORIGIN: appOrigin,
          TRUST_PROXY_HOPS: '1',
          ...productionKeys,
        }),
      ).toThrow(`Environment validation failed: APP_ORIGIN ${constraint}`)
    })

    it.each([
      'http://192.168.1.20:9000',
      'https://development.example.com',
    ])('rejects non-loopback development APP_ORIGIN=%s', (appOrigin) => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: validDatabaseUrl,
          APP_ORIGIN: appOrigin,
        }),
      ).toThrow(
        'Environment validation failed: APP_ORIGIN must use an exact loopback host outside production',
      )
    })

    it('requires production APP_ORIGIN without exposing an unsafe value', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: validDatabaseUrl,
          TRUST_PROXY_HOPS: '1',
          ...productionKeys,
        }),
      ).toThrow('Environment validation failed: APP_ORIGIN is required')
    })

    it.each([
      ['TRUST_PROXY_HOPS', -1],
      ['TRUST_PROXY_HOPS', 3],
      ['AUTH_ARGON2_CONCURRENCY', 0],
      ['AUTH_ARGON2_CONCURRENCY', 65],
      ['AUTH_ARGON2_QUEUE_LIMIT', -1],
      ['AUTH_ARGON2_QUEUE_LIMIT', 4097],
    ])('rejects invalid bounded integer %s=%s', (key, value) => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL: validDatabaseUrl,
          [key]: value,
        }),
      ).toThrow(`Environment validation failed: ${key} must be an integer`)
    })

    it.each([
      'AUTH_USERNAME_HMAC_KEY',
      'AUTH_USER_ID_HMAC_KEY',
      'AUTH_IP_HMAC_KEY',
    ])('requires %s in production', (missingKey) => {
      const input: Record<string, unknown> = {
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        APP_ORIGIN: 'https://dms.example.com',
        TRUST_PROXY_HOPS: '1',
        ...productionKeys,
      }
      delete input[missingKey]

      expect(() => validateEnvironment(input)).toThrow(
        `Environment validation failed: ${missingKey} is required in production`,
      )
    })

    it('rejects malformed or short HMAC keys without echoing them', () => {
      const unsafeKey = 'short-secret-do-not-print'

      expect(() =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: validDatabaseUrl,
          APP_ORIGIN: 'https://dms.example.com',
          TRUST_PROXY_HOPS: '1',
          ...productionKeys,
          AUTH_IP_HMAC_KEY: unsafeKey,
        }),
      ).toThrow(
        'Environment validation failed: AUTH_IP_HMAC_KEY must be base64url encoding exactly 32 bytes',
      )
    })

    it('rejects reused HMAC keys', () => {
      expect(() =>
        validateEnvironment({
          NODE_ENV: 'production',
          DATABASE_URL: validDatabaseUrl,
          APP_ORIGIN: 'https://dms.example.com',
          TRUST_PROXY_HOPS: '1',
          ...productionKeys,
          AUTH_IP_HMAC_KEY: productionKeys.AUTH_USERNAME_HMAC_KEY,
        }),
      ).toThrow(
        'Environment validation failed: AUTH_HMAC_KEYS must be distinct',
      )
    })
  })
})
