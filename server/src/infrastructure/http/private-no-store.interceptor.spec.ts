import type {
  CallHandler,
  ExecutionContext,
} from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { firstValueFrom, of, throwError } from 'rxjs'

import {
  IMMUTABLE_MEDIA_CACHE_CONTROL,
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

const HANDLER_MARKER = function handlerMarker(): void {}
const CLASS_MARKER = class ClassMarker {}

function createContext(
  request: object,
  response: ResponseDouble,
): ExecutionContext {
  return {
    getClass: () => CLASS_MARKER,
    getHandler: () => HANDLER_MARKER,
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

/**
 * 只替换反射结果，其余行为走真实实现：默认返回 false（未标注 -> 维持 no-store）。
 */
function createInterceptor(immutableMedia = false) {
  const getAllAndOverride = jest.fn().mockReturnValue(immutableMedia)
  return {
    getAllAndOverride,
    interceptor: new PrivateNoStoreInterceptor({
      getAllAndOverride,
    } as unknown as Reflector),
  }
}

describe('PrivateNoStoreInterceptor', () => {
  const { interceptor } = createInterceptor()

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

  it('relaxes only the routes that explicitly declare immutable media content', async () => {
    const { getAllAndOverride, interceptor: relaxed } = createInterceptor(true)
    const response = createResponse()

    await firstValueFrom(
      relaxed.intercept(
        createContext({ path: '/api/products/p/media/m/content' }, response),
        createHandler(() => of(undefined)),
      ),
    )

    expect(response.headers.get('cache-control')).toBe(
      IMMUTABLE_MEDIA_CACHE_CONTROL,
    )
    // 豁免必须同时看 handler 与 class 元数据，路由改名时不会因 URL 匹配而静默失效。
    expect(getAllAndOverride).toHaveBeenCalledWith(
      expect.any(String),
      [HANDLER_MARKER, CLASS_MARKER],
    )
  })

  it('falls back to private no-store when the execution context cannot provide handlers', async () => {
    const { interceptor: relaxed } = createInterceptor(true)
    const response = createResponse()
    const hostileContext = {
      getClass: () => CLASS_MARKER,
      getHandler: () => {
        throw new Error('hostile handler getter')
      },
      switchToHttp: () => ({
        getRequest: () => ({ path: '/api/products/p/media/m/content' }),
        getResponse: () => response,
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext

    await expect(
      firstValueFrom(
        relaxed.intercept(hostileContext, createHandler(() => of(undefined))),
      ),
    ).resolves.toBeUndefined()
    expect(response.headers.get('cache-control')).toBe(
      PRIVATE_NO_STORE_CACHE_CONTROL,
    )
  })

  it('keeps the relaxed policy off the health route even when the class is annotated', async () => {
    const { interceptor: relaxed } = createInterceptor(true)
    const response = createResponse()
    const terminusCacheControl = 'no-cache, no-store, must-revalidate'
    response.headers.set('cache-control', terminusCacheControl)

    await firstValueFrom(
      relaxed.intercept(
        createContext({ path: '/api/health' }, response),
        createHandler(() => of(undefined)),
      ),
    )

    expect(response.headers.get('cache-control')).toBe(terminusCacheControl)
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Cache-Control',
      expect.anything(),
    )
  })
})
