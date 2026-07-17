import { Reflector } from '@nestjs/core'

import {
  ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
  OPTIONAL_SESSION_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  AllowPasswordChangeRequired,
  OptionalSession,
  Public,
  RequirePermissions,
} from './auth.decorators'

class DecoratorFixture {
  @Public()
  publicRoute(): void {}

  @OptionalSession()
  optionalSessionRoute(): void {}

  @AllowPasswordChangeRequired()
  passwordChangeAllowedRoute(): void {}

  @RequirePermissions('users:read', 'users:update')
  permissionRoute(): void {}
}

describe('auth decorators', () => {
  const reflector = new Reflector()

  it('marks an explicitly public route', () => {
    expect(
      reflector.get(PUBLIC_ROUTE_METADATA, DecoratorFixture.prototype.publicRoute),
    ).toBe(true)
  })

  it('marks a route whose Session is optional', () => {
    expect(
      reflector.get(
        OPTIONAL_SESSION_METADATA,
        DecoratorFixture.prototype.optionalSessionRoute,
      ),
    ).toBe(true)
  })

  it('marks the narrow allowlist for a forced-password-change Session', () => {
    expect(
      reflector.get(
        ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
        DecoratorFixture.prototype.passwordChangeAllowedRoute,
      ),
    ).toBe(true)
  })

  it('stores all declared permissions as an immutable snapshot', () => {
    const requiredPermissions = reflector.get<readonly string[]>(
      REQUIRED_PERMISSIONS_METADATA,
      DecoratorFixture.prototype.permissionRoute,
    )

    expect(requiredPermissions).toEqual(['users:read', 'users:update'])
    expect(Object.isFrozen(requiredPermissions)).toBe(true)
  })
})
