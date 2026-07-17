import type { ExecutionContext } from '@nestjs/common'
import { HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { getOptionalRequestAuthContext } from '../auth-context'
import type {
  AuthenticatedSession,
  AuthSessionService,
} from '../auth-session.service'
import { OptionalSession, Public } from '../decorators/auth.decorators'
import type { SessionCookieProvider } from '../providers/session-cookie.provider'
import { AuthenticationGuard } from './authentication.guard'

const COOKIE_HEADER = 'theme=dark; qianshu_session_dev=selector.secret'
const TOKEN_VALUE = 'selector.secret'
const SESSION: AuthenticatedSession = {
  id: '772b69e5-fe77-4316-9cb0-b9ac8ac4d09a',
  userId: 'ab55ea71-fdeb-4126-a811-bc8382f59f9e',
  username: 'operator',
  displayName: '操作员',
  mustChangePassword: false,
  createdAt: new Date('2026-07-17T01:00:00.000Z'),
  lastActivityAt: new Date('2026-07-17T02:00:00.000Z'),
  idleExpiresAt: new Date('2026-07-19T02:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-08-16T01:00:00.000Z'),
}

class RouteFixture {
  @Public()
  publicRoute(): void {}

  @OptionalSession()
  optionalRoute(): void {}

  requiredRoute(): void {}
}

type SessionServiceMock = Pick<
  AuthSessionService,
  'authenticate' | 'validateWithoutTouch'
>

type CookieProviderMock = Pick<SessionCookieProvider, 'readValue'>

function createContext(
  request: unknown,
  handler: RouteFixture[keyof RouteFixture],
): ExecutionContext {
  return {
    getClass: () => RouteFixture,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as T,
    }),
  } as unknown as ExecutionContext
}

function createGuard() {
  const sessionService: jest.Mocked<SessionServiceMock> = {
    authenticate: jest.fn(),
    validateWithoutTouch: jest.fn(),
  }
  const cookieProvider: jest.Mocked<CookieProviderMock> = {
    readValue: jest.fn((header: unknown) =>
      header === COOKIE_HEADER ? TOKEN_VALUE : null,
    ),
  }

  return {
    cookieProvider,
    guard: new AuthenticationGuard(
      new Reflector(),
      cookieProvider as unknown as SessionCookieProvider,
      sessionService as unknown as AuthSessionService,
    ),
    sessionService,
  }
}

async function expectAuthenticationRequired(run: () => Promise<unknown>) {
  const error = await run().catch((caught: unknown) => caught)

  expect(error).toBeInstanceOf(ApiException)
  expect(error).toMatchObject({
    code: 'AUTHENTICATION_REQUIRED',
    publicMessage: '需要登录',
  })
  expect((error as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED)
}

describe('AuthenticationGuard', () => {
  it('skips public routes without reading a Cookie or touching a Session', async () => {
    const { cookieProvider, guard, sessionService } = createGuard()
    const request = { headers: { cookie: COOKIE_HEADER } }

    await expect(
      guard.canActivate(createContext(request, RouteFixture.prototype.publicRoute)),
    ).resolves.toBe(true)
    expect(cookieProvider.readValue).not.toHaveBeenCalled()
    expect(sessionService.authenticate).not.toHaveBeenCalled()
    expect(sessionService.validateWithoutTouch).not.toHaveBeenCalled()
  })

  it('authenticates and attaches a required Session identity', async () => {
    const { guard, sessionService } = createGuard()
    sessionService.authenticate.mockResolvedValue(SESSION)
    const request = { headers: { cookie: COOKIE_HEADER } }

    await expect(
      guard.canActivate(
        createContext(request, RouteFixture.prototype.requiredRoute),
      ),
    ).resolves.toBe(true)
    expect(sessionService.authenticate).toHaveBeenCalledWith(TOKEN_VALUE)
    expect(getOptionalRequestAuthContext(request)).toMatchObject({
      sessionId: SESSION.id,
      userId: SESSION.userId,
      mustChangePassword: false,
    })
    expect(JSON.stringify(getOptionalRequestAuthContext(request))).not.toContain(
      TOKEN_VALUE,
    )
  })

  it.each([
    ['a missing Cookie Header', {}],
    ['an unreadable headers object', {
      get headers(): never {
        throw new Error('sensitive header getter')
      },
    }],
  ])('returns one fixed 401 for %s', async (_label, request) => {
    const { guard, sessionService } = createGuard()

    await expectAuthenticationRequired(() =>
      guard.canActivate(
        createContext(request, RouteFixture.prototype.requiredRoute),
      ),
    )
    expect(sessionService.authenticate).not.toHaveBeenCalled()
  })

  it('returns the same fixed 401 when Session validation returns no identity', async () => {
    const { guard, sessionService } = createGuard()
    sessionService.authenticate.mockResolvedValue(null)

    await expectAuthenticationRequired(() =>
      guard.canActivate(
        createContext(
          { headers: { cookie: COOKIE_HEADER } },
          RouteFixture.prototype.requiredRoute,
        ),
      ),
    )
  })

  it('allows an anonymous optional-session request without a database call', async () => {
    const { guard, sessionService } = createGuard()

    await expect(
      guard.canActivate(
        createContext({}, RouteFixture.prototype.optionalRoute),
      ),
    ).resolves.toBe(true)
    expect(sessionService.authenticate).not.toHaveBeenCalled()
    expect(sessionService.validateWithoutTouch).not.toHaveBeenCalled()
  })

  it('allows an invalid optional Session without attaching an identity', async () => {
    const { guard, sessionService } = createGuard()
    sessionService.validateWithoutTouch.mockResolvedValue(null)
    const request = { headers: { cookie: COOKIE_HEADER } }

    await expect(
      guard.canActivate(
        createContext(request, RouteFixture.prototype.optionalRoute),
      ),
    ).resolves.toBe(true)
    expect(sessionService.validateWithoutTouch).toHaveBeenCalledWith(TOKEN_VALUE)
    expect(sessionService.authenticate).not.toHaveBeenCalled()
    expect(getOptionalRequestAuthContext(request)).toBeNull()
  })

  it('validates an optional Session without extending its activity window', async () => {
    const { guard, sessionService } = createGuard()
    sessionService.validateWithoutTouch.mockResolvedValue(SESSION)
    const request = { headers: { cookie: COOKIE_HEADER } }

    await expect(
      guard.canActivate(
        createContext(request, RouteFixture.prototype.optionalRoute),
      ),
    ).resolves.toBe(true)
    expect(sessionService.validateWithoutTouch).toHaveBeenCalledWith(TOKEN_VALUE)
    expect(sessionService.authenticate).not.toHaveBeenCalled()
    expect(getOptionalRequestAuthContext(request)?.sessionId).toBe(SESSION.id)
  })

  it('does not hide a fixed service-unavailable failure as an invalid Session', async () => {
    const { guard, sessionService } = createGuard()
    const unavailable = new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AUTH_SERVICE_UNAVAILABLE',
      '认证服务暂时不可用',
    )
    sessionService.authenticate.mockRejectedValue(unavailable)

    await expect(
      guard.canActivate(
        createContext(
          { headers: { cookie: COOKIE_HEADER } },
          RouteFixture.prototype.requiredRoute,
        ),
      ),
    ).rejects.toBe(unavailable)
  })
})
