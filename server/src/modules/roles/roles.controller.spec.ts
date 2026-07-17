import { Reflector } from '@nestjs/core'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { RolesController } from './roles.controller'
import { RolesService } from './roles.service'

const ACTOR_USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const SESSION_ID = 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1'
const ROLE_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_USER_ID,
    username: 'system_admin',
    displayName: '系统管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-07-17T08:00:00.000Z'),
    lastActivityAt: new Date('2026-07-17T08:00:00.000Z'),
    idleExpiresAt: new Date('2026-07-19T08:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-16T08:00:00.000Z'),
  })
  return request
}

function createFixture() {
  const role = {
    id: ROLE_ID,
    code: 'inventory_reader',
    name: '库存只读',
    description: null,
    isSystem: false,
    permissionIds: [],
  }
  const service = {
    list: jest.fn().mockResolvedValue([role]),
    create: jest.fn().mockResolvedValue(role),
    getById: jest.fn().mockResolvedValue(role),
    update: jest.fn().mockResolvedValue(role),
    replacePermissions: jest.fn().mockResolvedValue(role),
  }

  return {
    controller: new RolesController(service as unknown as RolesService),
    role,
    service,
  }
}

describe('RolesController', () => {
  it('forwards list and detail reads', async () => {
    const fixture = createFixture()

    await expect(fixture.controller.list()).resolves.toEqual([fixture.role])
    await expect(fixture.controller.getById(ROLE_ID)).resolves.toEqual(
      fixture.role,
    )
    expect(fixture.service.getById).toHaveBeenCalledWith(ROLE_ID)
  })

  it('binds the authenticated actor and request id to mutations', async () => {
    const fixture = createFixture()
    const request = createRequest()
    const createDto = {
      code: 'inventory_reader',
      name: '库存只读',
    }
    const permissionsDto = { permissionIds: [] }

    await fixture.controller.create(createDto, request)
    await fixture.controller.replacePermissions(
      ROLE_ID,
      permissionsDto,
      request,
    )

    expect(fixture.service.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_USER_ID }),
      createDto,
    )
    expect(fixture.service.replacePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_USER_ID }),
      ROLE_ID,
      permissionsDto,
    )
  })

  it('declares read, create, update and assignment permissions exactly', () => {
    const reflector = new Reflector()
    const read = ['roles:read']

    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RolesController.prototype.list,
      ),
    ).toEqual(read)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RolesController.prototype.getById,
      ),
    ).toEqual(read)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RolesController.prototype.create,
      ),
    ).toEqual(['roles:create'])
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RolesController.prototype.update,
      ),
    ).toEqual(['roles:update'])
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RolesController.prototype.replacePermissions,
      ),
    ).toEqual(['roles:assign-permissions'])
  })
})
