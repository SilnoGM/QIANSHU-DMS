import { randomBytes } from 'node:crypto'

import {
  ProxyNodeSecretInvalidError,
  ProxyNodeSecretService,
  ProxyNodeSecretUnavailableError,
} from './proxy-node-secret.service'

function createKey(): string {
  return randomBytes(32).toString('base64url')
}

describe('ProxyNodeSecretService', () => {
  it('round-trips a password without exposing it in the payload', () => {
    const service = new ProxyNodeSecretService(createKey())
    const plaintext = ['test', 'password', 'value'].join('-')
    const payload = service.encrypt(plaintext)

    expect(payload.startsWith('v1.')).toBe(true)
    expect(payload).not.toContain(plaintext)
    expect(service.decrypt(payload)).toBe(plaintext)
  })

  it('uses a random IV so the same plaintext yields different payloads', () => {
    const service = new ProxyNodeSecretService(createKey())
    const plaintext = ['same', 'input'].join('-')

    expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext))
  })

  it('rejects tampered payloads and malformed shapes', () => {
    const service = new ProxyNodeSecretService(createKey())
    const payload = service.encrypt(['tamper', 'test'].join('-'))
    const parts = payload.split('.')
    const ciphertext = parts[3] ?? ''
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`,
    ].join('.')

    expect(() => service.decrypt(tampered)).toThrow(ProxyNodeSecretInvalidError)
    expect(() => service.decrypt('not-a-payload')).toThrow(ProxyNodeSecretInvalidError)
    expect(() => service.decrypt('v2.a.b.c')).toThrow(ProxyNodeSecretInvalidError)
  })

  it('fails closed when the key is absent', () => {
    const service = new ProxyNodeSecretService(null)

    expect(service.available).toBe(false)
    expect(() => service.encrypt('value')).toThrow(ProxyNodeSecretUnavailableError)
    expect(() => service.decrypt('v1.a.b.c')).toThrow(ProxyNodeSecretUnavailableError)
  })

  it('rejects non-canonical or wrong-length keys', () => {
    expect(() => new ProxyNodeSecretService('short')).toThrow(ProxyNodeSecretInvalidError)

    const nonCanonical = `${randomBytes(32).toString('base64url')}===`
    expect(() => new ProxyNodeSecretService(nonCanonical)).toThrow(ProxyNodeSecretInvalidError)
  })
})
