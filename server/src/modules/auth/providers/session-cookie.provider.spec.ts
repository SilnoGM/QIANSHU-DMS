import { ConfigService } from '@nestjs/config'

import { SessionCookieProvider } from './session-cookie.provider'

const NOW = new Date('2026-07-17T02:00:00.000Z')
const SESSION_VALUE =
  '4a980e3f-87ab-4e4a-91bb-16debb514b01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DAY_MS = 24 * 60 * 60 * 1_000

function createProvider(
  nodeEnvironment: 'development' | 'test' | 'production',
): SessionCookieProvider {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(nodeEnvironment),
  } as unknown as ConfigService

  return new SessionCookieProvider(configService)
}

describe('SessionCookieProvider', () => {
  it('reads only the current environment cookie from a raw Cookie header', () => {
    const developmentProvider = createProvider('development')
    const productionProvider = createProvider('production')
    const header = `other=value; qianshu_session_dev=${SESSION_VALUE}`

    expect(developmentProvider.readValue(header)).toBe(SESSION_VALUE)
    expect(productionProvider.readValue(header)).toBeNull()
  })

  it('rejects duplicate, empty or non-string Cookie header values', () => {
    const provider = createProvider('development')

    expect(
      provider.readValue(
        `qianshu_session_dev=${SESSION_VALUE}; qianshu_session_dev=${SESSION_VALUE}`,
      ),
    ).toBeNull()
    expect(provider.readValue('qianshu_session_dev=')).toBeNull()
    expect(provider.readValue(['qianshu_session_dev=value'])).toBeNull()
  })

  it('builds the production __Host- cookie with all required attributes', () => {
    const provider = createProvider('production')
    const absoluteExpiresAt = new Date(NOW.getTime() + 7 * DAY_MS)

    expect(provider.create(SESSION_VALUE, absoluteExpiresAt, NOW)).toEqual({
      name: '__Host-qianshu_session',
      value: SESSION_VALUE,
      options: {
        expires: absoluteExpiresAt,
        httpOnly: true,
        maxAge: 7 * DAY_MS,
        path: '/',
        sameSite: 'strict',
        secure: true,
      },
    })
  })

  it.each(['development', 'test'] as const)(
    'uses the isolated non-secure development cookie in %s',
    (nodeEnvironment) => {
      const provider = createProvider(nodeEnvironment)
      const absoluteExpiresAt = new Date(NOW.getTime() + DAY_MS)

      expect(provider.create(SESSION_VALUE, absoluteExpiresAt, NOW)).toEqual({
        name: 'qianshu_session_dev',
        value: SESSION_VALUE,
        options: {
          expires: absoluteExpiresAt,
          httpOnly: true,
          maxAge: DAY_MS,
          path: '/',
          sameSite: 'strict',
          secure: false,
        },
      })
    },
  )

  it('caps both browser expiry attributes at the 30-day absolute lifetime', () => {
    const provider = createProvider('production')
    const callerExpiry = new Date(NOW.getTime() + 45 * DAY_MS)
    const maximumExpiry = new Date(NOW.getTime() + 30 * DAY_MS)

    expect(provider.create(SESSION_VALUE, callerExpiry, NOW).options).toEqual(
      expect.objectContaining({
        expires: maximumExpiry,
        maxAge: 30 * DAY_MS,
      }),
    )
  })

  it('rounds Max-Age down to complete seconds without extending expiry', () => {
    const provider = createProvider('production')
    const absoluteExpiresAt = new Date(NOW.getTime() + 60_999)
    const cookie = provider.create(SESSION_VALUE, absoluteExpiresAt, NOW)

    expect(cookie.options.maxAge).toBe(60_000)
    expect(cookie.options.expires).toEqual(absoluteExpiresAt)
  })

  it.each([
    new Date(NOW.getTime()),
    new Date(NOW.getTime() - 1),
    new Date('invalid'),
  ])('rejects a non-future or invalid absolute expiry', (absoluteExpiresAt) => {
    const provider = createProvider('production')

    expect(() =>
      provider.create(SESSION_VALUE, absoluteExpiresAt, NOW),
    ).toThrow('Session cookie expiry must be in the future')
  })

  it('rejects an invalid clock value without including input data', () => {
    const provider = createProvider('production')

    expect(() =>
      provider.create(SESSION_VALUE, new Date(NOW.getTime() + DAY_MS), new Date('invalid')),
    ).toThrow('Session cookie expiry must be in the future')
  })

  it.each(['development', 'test', 'production'] as const)(
    'clears the %s cookie with the same scoped security attributes',
    (nodeEnvironment) => {
      const provider = createProvider(nodeEnvironment)
      const active = provider.create(
        SESSION_VALUE,
        new Date(NOW.getTime() + DAY_MS),
        NOW,
      )
      const cleared = provider.clear()

      expect(cleared).toEqual({
        name: active.name,
        value: '',
        options: {
          expires: new Date(0),
          httpOnly: active.options.httpOnly,
          maxAge: 0,
          path: active.options.path,
          sameSite: active.options.sameSite,
          secure: active.options.secure,
        },
      })
      expect(cleared.options).not.toHaveProperty('domain')
    },
  )
})
