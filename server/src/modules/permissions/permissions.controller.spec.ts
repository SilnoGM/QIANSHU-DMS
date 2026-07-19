import { Reflector } from '@nestjs/core'

import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { PermissionsController } from './permissions.controller'
import { PermissionsService } from './permissions.service'

describe('PermissionsController', () => {
  it('returns the service directory and requires roles:read', async () => {
    const permissions = [{
      id: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      code: 'users:read',
      name: '查询用户',
      description: null,
      systemOnly: true,
    }]
    const service = { list: jest.fn().mockResolvedValue(permissions) }
    const controller = new PermissionsController(
      service as unknown as PermissionsService,
    )

    await expect(controller.list()).resolves.toEqual(permissions)
    expect(
      new Reflector().get(
        REQUIRED_PERMISSIONS_METADATA,
        PermissionsController.prototype.list,
      ),
    ).toEqual(['roles:read'])
  })
})
