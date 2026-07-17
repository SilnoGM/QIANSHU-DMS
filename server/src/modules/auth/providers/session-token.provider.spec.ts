import { createHash } from 'node:crypto'

import { SessionTokenProvider } from './session-token.provider'

const CANONICAL_SESSION_ID = '4a980e3f-87ab-4e4a-91bb-16debb514b01'
const OTHER_SESSION_ID = 'eddbafc3-d3c7-4d90-8e59-3874b1ea691a'
const ZERO_SECRET = Buffer.alloc(32).toString('base64url')

describe('SessionTokenProvider', () => {
  const provider = new SessionTokenProvider()

  it('generates a UUID selector and a 256-bit CSPRNG secret', () => {
    const generated = provider.generate()

    expect(generated.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(generated.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(generated.secret, 'base64url')).toHaveLength(32)
    expect(generated.value).toBe(
      `${generated.sessionId}.${generated.secret}`,
    )
    expect(generated.tokenHash).toHaveLength(32)
    expect(generated.tokenHash).toEqual(
      createHash('sha256')
        .update(Buffer.from(generated.secret, 'base64url'))
        .digest(),
    )
  })

  it('does not reuse the selector or secret across generated tokens', () => {
    const first = provider.generate()
    const second = provider.generate()

    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.secret).not.toBe(first.secret)
    expect(second.value).not.toBe(first.value)
    expect(second.tokenHash).not.toEqual(first.tokenHash)
  })

  it('parses one canonical uuid.secret token', () => {
    expect(
      provider.parse(`${CANONICAL_SESSION_ID}.${ZERO_SECRET}`),
    ).toEqual({
      sessionId: CANONICAL_SESSION_ID,
      secret: ZERO_SECRET,
    })
  })

  it.each([
    '',
    CANONICAL_SESSION_ID,
    `${CANONICAL_SESSION_ID}.${ZERO_SECRET}.extra`,
    `.${ZERO_SECRET}`,
    `${CANONICAL_SESSION_ID}.`,
  ])('rejects a token that is not exactly two segments: %j', (value) => {
    expect(provider.parse(value)).toBeNull()
  })

  it.each([
    'not-a-uuid',
    CANONICAL_SESSION_ID.toUpperCase(),
    CANONICAL_SESSION_ID.replace('-4', '-z'),
    OTHER_SESSION_ID.replace(/-/g, ''),
  ])('rejects a non-canonical UUID selector: %s', (sessionId) => {
    expect(provider.parse(`${sessionId}.${ZERO_SECRET}`)).toBeNull()
  })

  it.each([
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}=`,
    `${'A'.repeat(42)}+`,
    `${'A'.repeat(42)}/`,
  ])('rejects an invalid or incorrectly sized secret: %j', (secret) => {
    expect(provider.parse(`${CANONICAL_SESSION_ID}.${secret}`)).toBeNull()
  })

  it('rejects a base64url spelling with non-zero unused bits', () => {
    const nonCanonicalSecret = `${'A'.repeat(42)}B`

    expect(Buffer.from(nonCanonicalSecret, 'base64url')).toHaveLength(32)
    expect(
      Buffer.from(nonCanonicalSecret, 'base64url').toString('base64url'),
    ).not.toBe(nonCanonicalSecret)
    expect(
      provider.parse(`${CANONICAL_SESSION_ID}.${nonCanonicalSecret}`),
    ).toBeNull()
  })

  it('returns null instead of throwing for a non-string runtime value', () => {
    expect(provider.parse(undefined as unknown as string)).toBeNull()
  })

  it('hashes the decoded secret bytes with SHA-256', () => {
    expect(provider.hashSecret(ZERO_SECRET)).toEqual(
      createHash('sha256').update(Buffer.alloc(32)).digest(),
    )
  })

  it('rejects a non-canonical secret before hashing it', () => {
    expect(() => provider.hashSecret(`${'A'.repeat(42)}B`)).toThrow(
      'Invalid session secret',
    )
  })

  it('compares the secret hash and rejects a different same-length hash', () => {
    const expectedHash = provider.hashSecret(ZERO_SECRET)
    const differentHash = Buffer.from(expectedHash)
    differentHash[0] ^= 0xff

    expect(provider.matchesTokenHash(ZERO_SECRET, expectedHash)).toBe(true)
    expect(provider.matchesTokenHash(ZERO_SECRET, differentHash)).toBe(false)
  })

  it.each([Buffer.alloc(0), Buffer.alloc(31), Buffer.alloc(33)])(
    'safely returns false instead of throwing for a %i-byte expected hash',
    (expectedHash) => {
      expect(() =>
        provider.matchesTokenHash(ZERO_SECRET, expectedHash),
      ).not.toThrow()
      expect(provider.matchesTokenHash(ZERO_SECRET, expectedHash)).toBe(false)
    },
  )

  it('safely returns false for an invalid runtime hash value', () => {
    const invalidHash = undefined as unknown as Uint8Array

    expect(() =>
      provider.matchesTokenHash(ZERO_SECRET, invalidHash),
    ).not.toThrow()
    expect(provider.matchesTokenHash(ZERO_SECRET, invalidHash)).toBe(false)
  })
})
