import type { ExecutionContext } from '@nestjs/common'
import { HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ApiException } from '../../../infrastructure/http/api.exception'
import { attachRequestAuthContext } from '../auth-context'
import type { AuthenticatedSession } from '../auth-session.service'
import {
  AllowPasswordChangeRequired,
  RequireAuthenticatedSession,
} from '../decorators/auth.decorators'
import { PasswordChangeRequiredGuard } from './password-change-required.guard'

const BASE_SESSION: AuthenticatedSession = {
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
  @AllowPasswordChangeRequired()
  allowedRoute(): void {}

  @RequireAuthenticatedSession()
  authenticatedSessionRoute(): void {}

  protectedRoute(): void {}
}

function createContext(request: object, handler: () => void): ExecutionContext {
  return {
    getClass: () => RouteFixture,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as T,
    }),
  } as unknown as ExecutionContext
}

describe('PasswordChangeRequiredGuard', () => {
  const guard = new PasswordChangeRequiredGuard(new Reflector())

  it('allows a normal authenticated Session', () => {
    const request = {}
    attachRequestAuthContext(request, BASE_SESSION)

    expect(
      guard.canActivate(
        createContext(request, RouteFixture.prototype.protectedRoute),
      ),
    ).toBe(true)
  })

  it('allows an explicitly allowlisted route during forced password change', () => {
    const request = {}
    attachRequestAuthContext(request, {
      ...BASE_SESSION,
      mustChangePassword: true,
    })

    expect(
      guard.canActivate(createContext(request, RouteFixture.prototype.allowedRoute)),
    ).toBe(true)
  })

  it('returns one fixed 403 for every other forced-password-change request', () => {
    const request = {}
    attachRequestAuthContext(request, {
      ...BASE_SESSION,
      mustChangePassword: true,
    })

    let thrown: unknown
    try {
      guard.canActivate(
        createContext(request, RouteFixture.prototype.protectedRoute),
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ApiException)
    expect(thrown).toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
      publicMessage: '必须先修改密码',
    })
    expect((thrown as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN)
  })

  it('does not treat an authenticated Session declaration as a forced-password-change allowlist', () => {
    const request = {}
    attachRequestAuthContext(request, {
      ...BASE_SESSION,
      mustChangePassword: true,
    })

    expect(() =>
      guard.canActivate(
        createContext(
          request,
          RouteFixture.prototype.authenticatedSessionRoute,
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PASSWORD_CHANGE_REQUIRED',
        publicMessage: '必须先修改密码',
      }),
    )
  })

  it('does not block a public or anonymous optional request without identity', () => {
    expect(
      guard.canActivate(
        createContext({}, RouteFixture.prototype.protectedRoute),
      ),
    ).toBe(true)
  })
})
