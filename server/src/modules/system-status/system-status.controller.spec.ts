import { PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'

import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { SystemStatusController } from './system-status.controller'

describe('SystemStatusController metadata', () => {
  const reflector = new Reflector()

  it('is mounted at the admin system status path', () => {
    expect(
      reflector.get(PATH_METADATA, SystemStatusController),
    ).toBe('system/status')
  })

  it('requires the system-status read permission', () => {
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        SystemStatusController.prototype.get,
      ),
    ).toEqual(['system-status:read'])
  })
})
