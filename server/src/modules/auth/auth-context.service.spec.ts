import { HttpStatus } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { RequestAuthContext } from './auth-context'
import { AuthContextService } from './auth-context.service'
import type { LoginResult } from './auth.types'

const REQUEST_CONTEXT: RequestAuthContext = Object.freeze({
  sessionId: 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1',
  userId: '8ac94425-c78c-4b32-ae2d-e3ce808b0275',
  username: 'operator',
  displayName: '操作员',
  mustChangePassword: false,
  createdAt: '2026-07-17T08:00:00.000Z',
  lastActivityAt: '2026-07-17T08:55:00.000Z',
  idleExpiresAt: '2026-07-19T08:55:00.000Z',
  absoluteExpiresAt: '2026-08-16T08:00:00.000Z',
})

function createService(permissionCodes = ['users:read', 'audit:read']) {
  const accessControl = {
    getPermissionCodes: jest.fn().mockResolvedValue(permissionCodes),
  }
  return {
    accessControl,
    service: new AuthContextService(
      accessControl as unknown as AccessControlService,
    ),
  }
}

describe('AuthContextService', () => {
  it('loads real-time permissions for the authenticated request snapshot', async () => {
    const { accessControl, service } = createService()

    await expect(service.get(REQUEST_CONTEXT)).resolves.toEqual({
      user: {
        id: REQUEST_CONTEXT.userId,
        username: REQUEST_CONTEXT.username,
        displayName: REQUEST_CONTEXT.displayName,
        mustChangePassword: false,
      },
      permissions: ['audit:read', 'users:read'],
      session: {
        createdAt: REQUEST_CONTEXT.createdAt,
        lastActivityAt: REQUEST_CONTEXT.lastActivityAt,
        idleExpiresAt: REQUEST_CONTEXT.idleExpiresAt,
        absoluteExpiresAt: REQUEST_CONTEXT.absoluteExpiresAt,
      },
    })
    expect(accessControl.getPermissionCodes).toHaveBeenCalledWith(
      REQUEST_CONTEXT.userId,
    )
  })

  it('maps an issued Session without exposing its token or selector', () => {
    const { service } = createService()
    const result: LoginResult = {
      permissions: ['users:read', 'users:read', 'audit:read'],
      issuedSession: {
        tokenValue: 'must-not-be-exposed',
        session: {
          id: 'must-not-be-exposed',
          userId: REQUEST_CONTEXT.userId,
          username: REQUEST_CONTEXT.username,
          displayName: REQUEST_CONTEXT.displayName,
          mustChangePassword: true,
          createdAt: new Date(REQUEST_CONTEXT.createdAt),
          lastActivityAt: new Date(REQUEST_CONTEXT.lastActivityAt),
          idleExpiresAt: new Date(REQUEST_CONTEXT.idleExpiresAt),
          absoluteExpiresAt: new Date(REQUEST_CONTEXT.absoluteExpiresAt),
        },
      },
    }

    const dto = service.fromMutationResult(result)

    expect(dto.permissions).toEqual(['audit:read', 'users:read'])
    expect(JSON.stringify(dto)).not.toContain('must-not-be-exposed')
    expect(dto.user.mustChangePassword).toBe(true)
  })

  it('maps permission storage failures to a fixed unavailable contract', async () => {
    const { accessControl, service } = createService()
    accessControl.getPermissionCodes.mockRejectedValue(
      new Error('postgres://secret@example.invalid/private'),
    )

    const error = await service
      .get(REQUEST_CONTEXT)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiException)
    expect((error as ApiException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    )
    expect(error).toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' })
    expect((error as Error).message).not.toContain('postgres://')
  })
})
