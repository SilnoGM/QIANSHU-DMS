import { validateEnvironment } from './env.validation'

describe('validateEnvironment', () => {
  const validDatabaseUrl = 'postgresql://localhost:5432/qianshu_test'

  it('uses development and port 3000 when optional values are missing', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: validDatabaseUrl,
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: validDatabaseUrl,
    })
  })

  it('normalizes explicit values and preserves unknown keys', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '43100',
        DATABASE_URL: `  ${validDatabaseUrl}  `,
        CUSTOM_SETTING: 'kept',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      PORT: 43100,
      DATABASE_URL: validDatabaseUrl,
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
})
