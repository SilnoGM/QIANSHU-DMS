import {
  assertAllowedAssistantBaseUrl,
  buildAssistantApiUrl,
  isBlockedOutboundAddress,
  resolveAssistantHost,
} from './assistant-outbound-url'

describe('isBlockedOutboundAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', address => {
    expect(isBlockedOutboundAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows public address %s',
    address => {
      expect(isBlockedOutboundAddress(address)).toBe(false)
    },
  )
})

describe('assertAllowedAssistantBaseUrl', () => {
  it('accepts the fixed GeWe HTTPS host', () => {
    expect(assertAllowedAssistantBaseUrl('https://api.geweapi.com').hostname).toBe('api.geweapi.com')
  })

  it.each([
    'http://api.geweapi.com',
    'https://evil.example.com',
    'https://user:pass@api.geweapi.com',
    'https://api.geweapi.com:8443',
    'https://api.geweapi.com?token=x',
    'https://api.geweapi.com#x',
  ])('rejects %s', value => {
    expect(() => assertAllowedAssistantBaseUrl(value)).toThrow()
  })
})

describe('resolveAssistantHost', () => {
  it('rejects a private resolved address', async () => {
    await expect(resolveAssistantHost('api.geweapi.com', () => Promise.resolve([
      { address: '127.0.0.1', family: 4 },
    ]))).rejects.toThrow('ASSISTANT_BASE_URL_PRIVATE_ADDRESS')
  })

  it('rejects an empty DNS result', async () => {
    await expect(resolveAssistantHost('api.geweapi.com', () => Promise.resolve([])))
      .rejects.toThrow('ASSISTANT_BASE_URL_DNS_EMPTY')
  })

  it('rejects a host outside the allowlist', async () => {
    await expect(resolveAssistantHost('evil.example.com', () => Promise.resolve([
      { address: '93.184.216.34', family: 4 },
    ]))).rejects.toThrow('ASSISTANT_BASE_URL_HOST_NOT_ALLOWED')
  })

  it('accepts a public address', async () => {
    await expect(resolveAssistantHost('api.geweapi.com', () => Promise.resolve([
      { address: '93.184.216.34', family: 4 },
    ]))).resolves.toHaveLength(1)
  })
})

describe('buildAssistantApiUrl', () => {
  it('builds a fixed API path', () => {
    expect(buildAssistantApiUrl('https://api.geweapi.com', '/gewe/v2/api/message/postText').toString())
      .toBe('https://api.geweapi.com/gewe/v2/api/message/postText')
  })

  it.each(['../secret', '/a\\b', 'https://evil.example.com/x'])('rejects %s', path => {
    expect(() => buildAssistantApiUrl('https://api.geweapi.com', path)).toThrow()
  })
})
