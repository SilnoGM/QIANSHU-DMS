import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { HttpStatus } from '@nestjs/common'

import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { AdAccountController } from './ad-account.controller'

function requiredPermissions(method: keyof AdAccountController): string[] {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_METADATA,
    AdAccountController.prototype[method],
  ) as string[]
}

describe('AdAccountController contract', () => {
  it('guards every route with the ad account permission codes', () => {
    expect(requiredPermissions('mine')).toEqual(['ad-accounts:read'])
    expect(requiredPermissions('mineAlertSummary')).toEqual(['ad-accounts:read'])
    expect(requiredPermissions('alertSummary')).toEqual(['ad-accounts:manage'])
    expect(requiredPermissions('assignableUsers')).toEqual(['ad-accounts:manage'])
    expect(requiredPermissions('list')).toEqual(['ad-accounts:manage'])
    expect(requiredPermissions('runSync')).toEqual(['ad-accounts:manage'])
    expect(requiredPermissions('assign')).toEqual(['ad-accounts:manage'])
    expect(requiredPermissions('release')).toEqual(['ad-accounts:manage'])
  })

  it('returns 200 for mutations instead of the default 201', () => {
    for (const method of ['runSync', 'assign', 'release'] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        AdAccountController.prototype[method],
      )).toBe(HttpStatus.OK)
    }
  })
})
