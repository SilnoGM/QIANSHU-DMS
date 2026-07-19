import { createHmac } from 'node:crypto'

import { ConfigService } from '@nestjs/config'

import { AuthSubjectHasher } from './auth-subject-hasher'

const USERNAME_KEY = Buffer.alloc(32, 0x11)
const USER_ID_KEY = Buffer.alloc(32, 0x22)
const IP_KEY = Buffer.alloc(32, 0x33)

type AuthHmacKeyPath =
  | 'auth.hmacKeys.username'
  | 'auth.hmacKeys.userId'
  | 'auth.hmacKeys.ip'

function createConfigService(
  overrides: Partial<Record<AuthHmacKeyPath, unknown>> = {},
): ConfigService {
  const values: Record<AuthHmacKeyPath, unknown> = {
    'auth.hmacKeys.username': USERNAME_KEY,
    'auth.hmacKeys.userId': USER_ID_KEY,
    'auth.hmacKeys.ip': IP_KEY,
    ...overrides,
  }

  return {
    getOrThrow: jest.fn((path: AuthHmacKeyPath) => {
      const value = values[path]

      if (value === undefined) {
        throw new Error('missing configuration')
      }

      return value
    }),
  } as unknown as ConfigService
}

describe('AuthSubjectHasher', () => {
  it('uses one independent HMAC-SHA-256 key for every subject namespace', () => {
    const configService = createConfigService()
    const hasher = new AuthSubjectHasher(configService)

    expect(hasher.hashUsername('silnogm')).toEqual(
      createHmac('sha256', USERNAME_KEY).update('silnogm', 'utf8').digest(),
    )
    expect(hasher.hashUserId('user-123')).toEqual(
      createHmac('sha256', USER_ID_KEY).update('user-123', 'utf8').digest(),
    )
    expect(hasher.hashIp('203.0.113.7')).toEqual(
      createHmac('sha256', IP_KEY).update('203.0.113.7', 'utf8').digest(),
    )
    expect(configService.getOrThrow).toHaveBeenCalledTimes(3)
    expect(configService.getOrThrow).toHaveBeenNthCalledWith(
      1,
      'auth.hmacKeys.username',
    )
    expect(configService.getOrThrow).toHaveBeenNthCalledWith(
      2,
      'auth.hmacKeys.userId',
    )
    expect(configService.getOrThrow).toHaveBeenNthCalledWith(
      3,
      'auth.hmacKeys.ip',
    )
  })

  it('always returns a fresh 32-byte Buffer that callers cannot mutate globally', () => {
    const hasher = new AuthSubjectHasher(createConfigService())
    const first = hasher.hashUsername('silnogm')
    const expected = Buffer.from(first)

    first.fill(0)
    const second = hasher.hashUsername('silnogm')

    expect(second).toHaveLength(32)
    expect(second).toEqual(expected)
    expect(second).not.toBe(first)
  })

  it('copies configured keys so later external mutation cannot change hashes', () => {
    const usernameKey = Buffer.from(USERNAME_KEY)
    const hasher = new AuthSubjectHasher(
      createConfigService({ 'auth.hmacKeys.username': usernameKey }),
    )
    const expected = hasher.hashUsername('silnogm')

    usernameKey.fill(0xff)

    expect(hasher.hashUsername('silnogm')).toEqual(expected)
  })

  it.each([
    ['username', (hasher: AuthSubjectHasher) => hasher.hashUsername('')],
    ['userId', (hasher: AuthSubjectHasher) => hasher.hashUserId('')],
    ['ip', (hasher: AuthSubjectHasher) => hasher.hashIp('')],
  ])('rejects an empty %s subject with one fixed message', (_, hash) => {
    const hasher = new AuthSubjectHasher(createConfigService())

    expect(() => hash(hasher)).toThrow('Invalid authentication subject')
  })

  it('rejects a non-string runtime subject without echoing it', () => {
    const hasher = new AuthSubjectHasher(createConfigService())
    const unsafeSubject = { secret: 'must-not-leak' }

    expect(() =>
      hasher.hashIp(unsafeSubject as unknown as string),
    ).toThrow('Invalid authentication subject')

    try {
      hasher.hashIp(unsafeSubject as unknown as string)
    }
    catch (error) {
      expect((error as Error).message).not.toContain('must-not-leak')
    }
  })

  it.each([
    undefined,
    'not-a-buffer',
    Buffer.alloc(0),
    Buffer.alloc(31),
    Buffer.alloc(33),
  ])('rejects an invalid HMAC key with one fixed message', (invalidKey) => {
    expect(() =>
      new AuthSubjectHasher(
        createConfigService({ 'auth.hmacKeys.username': invalidKey }),
      ),
    ).toThrow('Authentication subject HMAC configuration is invalid')
  })

  it.each([
    ['auth.hmacKeys.userId', USERNAME_KEY],
    ['auth.hmacKeys.ip', USERNAME_KEY],
    ['auth.hmacKeys.ip', USER_ID_KEY],
  ] as const)(
    'rejects reused key material at %s to keep namespaces independent',
    (path, duplicateKey) => {
      expect(() =>
        new AuthSubjectHasher(
          createConfigService({ [path]: duplicateKey }),
        ),
      ).toThrow('Authentication subject HMAC configuration is invalid')
    },
  )
})
