import type { ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { CsrfProtectionGuard } from './csrf-protection.guard'

const APP_ORIGIN = 'https://dms.example.com'
const SENSITIVE_CANARY = 'csrf-sensitive-canary'

interface RequestFixture {
  headers?: object
  method?: unknown
  path?: string
  rawHeaders?: unknown
}

const validHeaders = {
  'content-type': 'application/json',
  origin: APP_ORIGIN,
  'sec-fetch-site': 'same-origin',
  'x-qianshu-csrf': '1',
}

function createGuard(): CsrfProtectionGuard {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key !== 'auth.appOrigin') {
        throw new Error('Unexpected configuration key')
      }

      return APP_ORIGIN
    }),
  } as unknown as ConfigService

  return new CsrfProtectionGuard(configService)
}

function createContext(request: RequestFixture): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as T,
    }),
  } as unknown as ExecutionContext
}

function expectCsrfRejected(run: () => unknown): void {
  let thrown: unknown

  try {
    run()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ApiException)
  expect(thrown).toMatchObject({
    status: 403,
    code: 'CSRF_REJECTED',
    publicMessage: '请求来源校验失败',
  })
}

describe('CsrfProtectionGuard', () => {
  it.each(['GET', 'HEAD'])('allows safe %s requests without CSRF headers', (method) => {
    const guard = createGuard()

    expect(guard.canActivate(createContext({ method }))).toBe(true)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'allows %s only when every CSRF signal is valid',
    (method) => {
      const guard = createGuard()

      expect(
        guard.canActivate(
          createContext({
            method,
            headers: validHeaders,
          }),
        ),
      ).toBe(true)
    },
  )

  it.each([
    'application/json;charset=utf-8',
    'APPLICATION/JSON ; charset = UTF-8',
    'application/json; profile="https://example.com/schema"',
    'application/json; charset="utf-8"; version=1',
  ])('accepts application/json with legal media type parameters: %s', (contentType) => {
    const guard = createGuard()

    expect(
      guard.canActivate(
        createContext({
          method: 'POST',
          headers: { ...validHeaders, 'content-type': contentType },
        }),
      ),
    ).toBe(true)
  })

  it.each([
    'multipart/form-data; boundary=qianshu-media-boundary',
    'MULTIPART/FORM-DATA ; boundary="qianshu-media-boundary"',
  ])('accepts multipart/form-data while preserving every other CSRF signal: %s', (contentType) => {
    const guard = createGuard()

    expect(guard.canActivate(createContext({
      method: 'POST',
      headers: { ...validHeaders, 'content-type': contentType },
    }))).toBe(true)
  })

  it.each([
    ['missing Origin', { ...validHeaders, origin: undefined }],
    ['null Origin', { ...validHeaders, origin: 'null' }],
    ['mismatched Origin', { ...validHeaders, origin: 'https://attacker.example' }],
    ['missing CSRF marker', { ...validHeaders, 'x-qianshu-csrf': undefined }],
    ['non-exact CSRF marker', { ...validHeaders, 'x-qianshu-csrf': ' 1' }],
    ['missing Content-Type', { ...validHeaders, 'content-type': undefined }],
    ['non-JSON Content-Type', { ...validHeaders, 'content-type': 'text/plain' }],
    ['JSON-like Content-Type', { ...validHeaders, 'content-type': 'application/jsonp' }],
    ['multipart-like Content-Type', { ...validHeaders, 'content-type': 'multipart/form-datax' }],
    ['malformed multipart parameters', { ...validHeaders, 'content-type': 'multipart/form-data;' }],
    ['malformed JSON parameters', { ...validHeaders, 'content-type': 'application/json;' }],
    ['cross-site fetch', { ...validHeaders, 'sec-fetch-site': 'cross-site' }],
    ['case-varied cross-site fetch', { ...validHeaders, 'sec-fetch-site': 'Cross-Site' }],
  ])('rejects an unsafe request with %s', (_caseName, headers) => {
    const guard = createGuard()

    expectCsrfRejected(() =>
      guard.canActivate(createContext({ method: 'POST', headers })),
    )
  })

  it.each([
    ['origin', { ...validHeaders, origin: [APP_ORIGIN] }],
    ['x-qianshu-csrf', { ...validHeaders, 'x-qianshu-csrf': ['1'] }],
    ['content-type', { ...validHeaders, 'content-type': ['application/json'] }],
    ['sec-fetch-site', { ...validHeaders, 'sec-fetch-site': ['same-origin'] }],
  ])('rejects an array value for the %s header', (_headerName, headers) => {
    const guard = createGuard()

    expectCsrfRejected(() =>
      guard.canActivate(createContext({ method: 'POST', headers })),
    )
  })

  it.each(['Origin', 'X-Qianshu-CSRF', 'Content-Type', 'Sec-Fetch-Site'])(
    'rejects duplicate raw %s headers',
    (headerName) => {
      const guard = createGuard()
      const headerValue =
        validHeaders[headerName.toLowerCase() as keyof typeof validHeaders]

      expectCsrfRejected(() =>
        guard.canActivate(
          createContext({
            method: 'POST',
            headers: validHeaders,
            rawHeaders: [
              headerName,
              headerValue,
              headerName.toLowerCase(),
              headerValue,
            ],
          }),
        ),
      )
    },
  )

  it('rejects case-varied duplicate keys in the normalized header object', () => {
    const guard = createGuard()

    expectCsrfRejected(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          headers: { ...validHeaders, Origin: APP_ORIGIN },
        }),
      ),
    )
  })

  it('converts an exceptional header getter into the fixed rejection contract', () => {
    const guard = createGuard()
    const headers = { ...validHeaders }
    Object.defineProperty(headers, 'origin', {
      enumerable: true,
      get: () => {
        throw new Error(SENSITIVE_CANARY)
      },
    })

    let thrown: unknown
    try {
      guard.canActivate(createContext({ method: 'POST', headers }))
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiException)
    expect(thrown).toMatchObject({
      status: 403,
      code: 'CSRF_REJECTED',
      publicMessage: '请求来源校验失败',
    })
    expect(JSON.stringify(thrown)).not.toContain(SENSITIVE_CANARY)
  })

  it('does not skip CSRF checks for the public login route', () => {
    const guard = createGuard()

    expectCsrfRejected(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          path: '/api/auth/login',
          headers: {},
        }),
      ),
    )
  })
})
