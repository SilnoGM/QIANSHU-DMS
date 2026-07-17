import { Reflector } from '@nestjs/core'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

const ACTOR_USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const SESSION_ID = 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1'
const TARGET_USER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'

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
  const user = {
    id: TARGET_USER_ID,
    username: 'operator',
    displayName: '操作员',
    status: 'ACTIVE' as const,
    mustChangePassword: false,
    roleIds: [],
    lastLoginAt: null,
    createdAt: '2026-07-17T08:00:00.000Z',
    updatedAt: '2026-07-17T08:00:00.000Z',
  }
  const service = {
    list: jest.fn().mockResolvedValue({ items: [user], page: 1, pageSize: 20, total: 1 }),
    create: jest.fn().mockResolvedValue(user),
    getById: jest.fn().mockResolvedValue(user),
    updateDisplayName: jest.fn().mockResolvedValue(user),
    enable: jest.fn().mockResolvedValue(user),
    disable: jest.fn().mockResolvedValue(user),
    replaceRoles: jest.fn().mockResolvedValue(user),
    resetPassword: jest.fn().mockResolvedValue(user),
  }

  return {
    controller: new UsersController(service as unknown as UsersService),
    service,
    user,
  }
}

describe('UsersController', () => {
  it('forwards list and detail queries without inventing filters', async () => {
    const fixture = createFixture()
    const query = { page: 2, pageSize: 50, username: ' operator ' }

    await expect(fixture.controller.list(query)).resolves.toMatchObject({
      page: 1,
      total: 1,
    })
    await expect(fixture.controller.getById(TARGET_USER_ID)).resolves.toEqual(
      fixture.user,
    )
    expect(fixture.service.list).toHaveBeenCalledWith(query)
    expect(fixture.service.getById).toHaveBeenCalledWith(TARGET_USER_ID)
  })

  it('builds a trusted command context for create and password reset', async () => {
    const fixture = createFixture()
    const request = createRequest()
    const createDto = {
      username: 'operator',
      displayName: '操作员',
      password: 'safe password input',
      mustChangePassword: true,
    }
    const resetDto = {
      newPassword: 'another password input',
      mustChangePassword: false,
    }

    await fixture.controller.create(createDto, request)
    await fixture.controller.resetPassword(TARGET_USER_ID, resetDto, request)

    expect(fixture.service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_USER_ID,
        actorSessionId: SESSION_ID,
      }),
      createDto,
    )
    expect(fixture.service.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_USER_ID,
        actorSessionId: SESSION_ID,
      }),
      TARGET_USER_ID,
      resetDto,
    )
  })

  it('declares the exact permission required by every operation', () => {
    const reflector = new Reflector()
    const permissions = Object.fromEntries(
      [
        'list',
        'create',
        'getById',
        'update',
        'enable',
        'disable',
        'replaceRoles',
        'resetPassword',
      ].map(method => [
        method,
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          UsersController.prototype[
            method as keyof UsersController
          ],
        ),
      ]),
    )

    expect(permissions).toEqual({
      list: ['users:read'],
      create: ['users:create'],
      getById: ['users:read'],
      update: ['users:update'],
      enable: ['users:enable'],
      disable: ['users:disable'],
      replaceRoles: ['users:assign-roles'],
      resetPassword: ['users:reset-password'],
    })
  })

  it('returns 200 for POST actions that update an existing user', () => {
    const statusCodes = Object.fromEntries(
      ['enable', 'disable', 'resetPassword'].map(method => [
        method,
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          UsersController.prototype[method as keyof UsersController],
        ),
      ]),
    )

    expect(statusCodes).toEqual({
      enable: 200,
      disable: 200,
      resetPassword: 200,
    })
  })
})
