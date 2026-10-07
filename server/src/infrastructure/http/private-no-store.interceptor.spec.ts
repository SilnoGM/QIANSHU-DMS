import type {
  CallHandler,
  ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { firstValueFrom, of, throwError } from 'rxjs'

import {
  IMMUTABLE_MEDIA_CACHE_CONTROL,
  ImmutableMediaContentCache,
  PRIVATE_NO_STORE_CACHE_CONTROL,
  PrivateNoStoreInterceptor,
} from './private-no-store.interceptor'

interface ResponseDouble {
  headers: Map<string, unknown>
  setHeader: jest.Mock<void, [string, unknown]>
}

function createResponse(): ResponseDouble {
  const headers = new Map<string, unknown>()

  return {
    headers,
    setHeader: jest.fn((name: string, value: unknown) => {
      headers.set(name.toLowerCase(), value)
    }),
  }
}

function createContext(
  request: object,
  response: ResponseDouble,
  targets: { readonly handler?: object, readonly klass?: object } = {},
): ExecutionContext {
  return {
    getClass: () => targets.klass ?? class UnmarkedController {},
    getHandler: () => targets.handler ?? function unmarkedHandler() {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext
}

function createHandler(
  handle: CallHandler['handle'],
): CallHandler {
  return { handle }
}

describe('PrivateNoStoreInterceptor', () => {
  const interceptor = new PrivateNoStoreInterceptor(new Reflector())

  it('sets the private no-store header before a successful application handler runs', async () => {
    const response = createResponse()
    const handler = createHandler(() => {
      expect(response.headers.get('cache-control')).toBe(
        PRIVATE_NO_STORE_CACHE_CONTROL,
      )
      return of({ ok: true })
    })

    await expect(
      firstValueFrom(
        interceptor.intercept(
          createContext({ path: '/api/auth/me' }, response),
          handler,
        ),
      ),
    ).resolves.toEqual({ ok: true })
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })

  it('allows long-lived private caching only on routes that declare immutable media', async () => {
    class CachedMediaController {
      @ImmutableMediaContentCache()
      content(): unknown { return undefined }
    }
    const response = createResponse()

    await expect(
      firstValueFrom(
        interceptor.intercept(
          createContext({ path: '/api/products/p1/media/m1/content' }, response, {
            handler: CachedMediaController.prototype.content,
            klass: CachedMediaController,
          }),
          createHandler(() => of({ ok: true })),
        ),
      ),
    ).resolves.toEqual({ ok: true })

    expect(response.headers.get('cache-control')).toBe(
      IMMUTABLE_MEDIA_CACHE_CONTROL,
    )
    // 鉴权路由只能进入浏览器私有缓存；公共缓存会绕过会话与权限。
    expect(IMMUTABLE_MEDIA_CACHE_CONTROL).not.toContain('public')
  })

  it('sets the header before a handler throws synchronously', () => {
    const response = createResponse()
    const handlerError = new Error('handler failed')
    const handler = createHandler(() => {
      expect(response.headers.get('cache-control')).toBe(
        PRIVATE_NO_STORE_CACHE_CONTROL,
      )
      throw handlerError
    })

    expect(() =>
      interceptor.intercept(
        createContext({ originalUrl: '/api/auth/login' }, response),
        handler,
      ),
    ).toThrow(handlerError)
  })

  it('keeps the header when the handler observable fails', async () => {
    const response = createResponse()
    const handlerError = new Error('observable failed')

    await expect(
      firstValueFrom(
        interceptor.intercept(
          createContext({ url: '/api/users' }, response),
          createHandler(() => throwError(() => handlerError)),
        ),
      ),
    ).rejects.toBe(handlerError)
    expect(response.headers.get('cache-control')).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })

  it.each([
    ['sets', 'session=value; Path=/api; HttpOnly'],
    ['clears', 'session=; Path=/api; Max-Age=0; HttpOnly'],
  ])(
    '%s a session cookie without dropping the private no-store header',
    async (_operation, cookie) => {
      const response = createResponse()
      const handler = createHandler(() => {
        response.setHeader('Set-Cookie', cookie)
        return of(undefined)
      })

      await firstValueFrom(
        interceptor.intercept(
          createContext({ path: '/api/auth/logout' }, response),
          handler,
        ),
      )

      expect(response.headers.get('cache-control')).toBe(
        PRIVATE_NO_STORE_CACHE_CONTROL,
      )
      expect(response.headers.get('set-cookie')).toBe(cookie)
    },
  )

  it.each([
    { path: '/api/health' },
    { originalUrl: '/api/health?probe=database' },
    { url: '/api/health?probe=database' },
  ])('preserves the Terminus header for the exact health route: %p', async (request) => {
    const response = createResponse()
    const terminusCacheControl = 'no-cache, no-store, must-revalidate'
    response.headers.set('cache-control', terminusCacheControl)

    await firstValueFrom(
      interceptor.intercept(
        createContext(request, response),
        createHandler(() => of(undefined)),
      ),
    )

    expect(response.headers.get('cache-control')).toBe(terminusCacheControl)
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Cache-Control',
      expect.anything(),
    )
  })

  it.each([
    '/api/health/',
    '/api/health-check',
    '/api/contract/health',
    '/health',
  ])('does not exempt a health-like route: %s', async (path) => {
    const response = createResponse()

    await firstValueFrom(
      interceptor.intercept(
        createContext({ path }, response),
        createHandler(() => of(undefined)),
      ),
    )

    expect(response.headers.get('cache-control')).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })

  it('uses the safe private no-store default when a request URL getter throws', async () => {
    const response = createResponse()
    const request = Object.defineProperty({}, 'path', {
      get: () => {
        throw new Error('malicious URL getter')
      },
    })

    await expect(
      firstValueFrom(
        interceptor.intercept(
          createContext(request, response),
          createHandler(() => of(undefined)),
        ),
      ),
    ).resolves.toBeUndefined()
    expect(response.headers.get('cache-control')).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })

  it('uses the safe default when a secondary URL getter is hostile', async () => {
    const response = createResponse()
    const request = Object.defineProperties({}, {
      path: { value: '/api/health', enumerable: true },
      originalUrl: {
        enumerable: true,
        get: () => {
          throw new Error('hostile original URL getter')
        },
      },
    })

    await firstValueFrom(
      interceptor.intercept(
        createContext(request, response),
        createHandler(() => of(undefined)),
      ),
    )

    expect(response.headers.get('cache-control')).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })
})
