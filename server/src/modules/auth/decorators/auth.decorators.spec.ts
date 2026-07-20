import { Reflector } from '@nestjs/core'

import {
  ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
  OPTIONAL_SESSION_METADATA,
  PUBLIC_ROUTE_METADATA,
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
  AllowPasswordChangeRequired,
  OptionalSession,
  Public,
  RequireAuthenticatedSession,
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

  @RequireAuthenticatedSession()
  authenticatedSessionRoute(): void {}
}

@RequireAuthenticatedSession()
class AuthenticatedSessionControllerFixture {}

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

  it('marks a method that requires a normal authenticated Session without business permissions', () => {
    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        DecoratorFixture.prototype.authenticatedSessionRoute,
      ),
    ).toBe(true)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        DecoratorFixture.prototype.authenticatedSessionRoute,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        PUBLIC_ROUTE_METADATA,
        DecoratorFixture.prototype.authenticatedSessionRoute,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        OPTIONAL_SESSION_METADATA,
        DecoratorFixture.prototype.authenticatedSessionRoute,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        ALLOW_PASSWORD_CHANGE_REQUIRED_METADATA,
        DecoratorFixture.prototype.authenticatedSessionRoute,
      ),
    ).toBeUndefined()
  })

  it('supports the authenticated Session declaration at Controller class scope', () => {
    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        AuthenticatedSessionControllerFixture,
      ),
    ).toBe(true)
  })
})
