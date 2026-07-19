import type { ExecutionContext } from '@nestjs/common'
import { HttpStatus } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AccessControlService } from '../../access-control/access-control.service'
import { ApiException } from '../../../infrastructure/http/api.exception'
import { attachRequestAuthContext } from '../auth-context'
import type { AuthenticatedSession } from '../auth-session.service'
import {
  AllowPasswordChangeRequired,
  RequirePermissions,
} from '../decorators/auth.decorators'
import { PermissionGuard } from './permission.guard'

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
  @RequirePermissions('users:read', 'users:update')
  protectedRoute(): void {}

  @AllowPasswordChangeRequired()
  allowlistedAuthRoute(): void {}

  noPermissionRoute(): void {}
}

type AccessControlMock = Pick<
  AccessControlService,
  'getPermissionCodes' | 'hasAll'
>

function createContext(request: object, handler: () => void): ExecutionContext {
  return {
    getClass: () => RouteFixture,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: <T = unknown>() => request as T,
    }),
  } as unknown as ExecutionContext
}

function createGuard() {
  const accessControl: jest.Mocked<AccessControlMock> = {
    getPermissionCodes: jest.fn(),
    hasAll: jest.fn((granted, required) =>
      required.every((code) => granted.includes(code)),
    ),
  }

  return {
    accessControl,
    guard: new PermissionGuard(
      new Reflector(),
      accessControl as unknown as AccessControlService,
    ),
  }
}

describe('PermissionGuard', () => {
  it('loads current database permissions on every request and requires all codes', async () => {
    const { accessControl, guard } = createGuard()
    const requestOne = {}
    const requestTwo = {}
    attachRequestAuthContext(requestOne, SESSION)
    attachRequestAuthContext(requestTwo, SESSION)
    accessControl.getPermissionCodes
      .mockResolvedValueOnce(['users:read', 'users:update'])
      .mockResolvedValueOnce(['users:read', 'users:update'])

    await expect(
      guard.canActivate(
        createContext(requestOne, RouteFixture.prototype.protectedRoute),
      ),
    ).resolves.toBe(true)
    await expect(
      guard.canActivate(
        createContext(requestTwo, RouteFixture.prototype.protectedRoute),
      ),
    ).resolves.toBe(true)
    expect(accessControl.getPermissionCodes).toHaveBeenNthCalledWith(
      1,
      SESSION.userId,
    )
    expect(accessControl.getPermissionCodes).toHaveBeenNthCalledWith(
      2,
      SESSION.userId,
    )
    expect(accessControl.hasAll).toHaveBeenCalledWith(
      ['users:read', 'users:update'],
      ['users:read', 'users:update'],
    )
  })

  it('returns one fixed 403 when any required permission is missing', async () => {
    const { accessControl, guard } = createGuard()
    const request = {}
    attachRequestAuthContext(request, SESSION)
    accessControl.getPermissionCodes.mockResolvedValue(['users:read'])

    const error = await guard
      .canActivate(
        createContext(request, RouteFixture.prototype.protectedRoute),
      )
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      publicMessage: '权限不足',
    })
    expect((error as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN)
  })

  it('allows an explicitly allowlisted Auth route without an authorization query', async () => {
    const { accessControl, guard } = createGuard()

    await expect(
      guard.canActivate(
        createContext({}, RouteFixture.prototype.allowlistedAuthRoute),
      ),
    ).resolves.toBe(true)
    expect(accessControl.getPermissionCodes).not.toHaveBeenCalled()
  })

  it('denies a normal route that forgot to declare its required permissions', async () => {
    const { accessControl, guard } = createGuard()
    const request = {}
    attachRequestAuthContext(request, SESSION)

    const error = await guard
      .canActivate(
        createContext(request, RouteFixture.prototype.noPermissionRoute),
      )
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({
      code: 'FORBIDDEN',
      publicMessage: '权限不足',
    })
    expect((error as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN)
    expect(accessControl.getPermissionCodes).not.toHaveBeenCalled()
  })

  it('returns authentication-required if a permission route has no identity', async () => {
    const { accessControl, guard } = createGuard()

    const error = await guard
      .canActivate(
        createContext({}, RouteFixture.prototype.protectedRoute),
      )
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      publicMessage: '需要登录',
    })
    expect((error as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED)
    expect(accessControl.getPermissionCodes).not.toHaveBeenCalled()
  })
})
