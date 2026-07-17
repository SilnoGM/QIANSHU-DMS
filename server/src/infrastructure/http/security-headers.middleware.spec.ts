import { createSecurityHeadersMiddleware } from './security-headers.middleware'

function createResponse() {
  const headers = new Map<string, string>()

  return {
    headers,
    response: {
      setHeader: jest.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value)
      }),
    },
  }
}

describe('createSecurityHeadersMiddleware', () => {
  it('sets the production API security headers before continuing', () => {
    const { headers, response } = createResponse()
    const next = jest.fn()

    createSecurityHeadersMiddleware('production')({}, response, next)

    expect(headers).toEqual(new Map([
      [
        'content-security-policy',
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ],
      ['referrer-policy', 'no-referrer'],
      [
        'strict-transport-security',
        'max-age=31536000; includeSubDomains',
      ],
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
    ]))
    expect(next).toHaveBeenCalledTimes(1)
    expect(response.setHeader.mock.invocationCallOrder.at(-1)).toBeLessThan(
      next.mock.invocationCallOrder[0] ?? Infinity,
    )
  })

  it.each(['development', 'test'] as const)(
    'omits HSTS outside production while keeping the remaining headers in %s',
    (nodeEnvironment) => {
      const { headers, response } = createResponse()
      const next = jest.fn()

      createSecurityHeadersMiddleware(nodeEnvironment)({}, response, next)

      expect(headers.has('strict-transport-security')).toBe(false)
      expect(headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      )
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('x-frame-options')).toBe('DENY')
      expect(headers.get('referrer-policy')).toBe('no-referrer')
      expect(next).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects an unsupported runtime environment with a fixed message', () => {
    expect(() =>
      createSecurityHeadersMiddleware('staging' as 'production'),
    ).toThrow('Unsupported security header environment')
  })
})
