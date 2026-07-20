import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { ProfileController } from './profile.controller'
import { UserProfileService } from './user-profile.service'

const USER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const SESSION_ID = '52ad40d4-7fa5-46fb-81e4-1986bcebf8f2'

const PROFILE = {
  userId: USER_ID,
  email: null,
  mobileE164: null,
  avatarUrl: null,
  createdAt: '2026-07-20T01:00:00.000Z',
  updatedAt: '2026-07-20T01:00:00.000Z',
}

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: USER_ID,
    username: 'ordinary_operator',
    displayName: '普通操作员',
    mustChangePassword: false,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    lastActivityAt: new Date('2026-07-20T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-07-22T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-19T00:00:00.000Z'),
  })
  return request
}

function createFixture() {
  const service = {
    getCurrent: jest
      .fn<Promise<typeof PROFILE>, [string]>()
      .mockResolvedValue(PROFILE),
    updateCurrent: jest
      .fn<
        Promise<typeof PROFILE>,
        [{ actorUserId: string; requestId: string }, unknown]
      >()
      .mockResolvedValue(PROFILE),
  }

  return {
    controller: new ProfileController(
      service as unknown as UserProfileService,
    ),
    service,
  }
}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

function requireOperation(
  document: OpenAPIObject,
  method: 'get' | 'patch',
): ContractOperation {
  const operation = document.paths['/api/profile']?.[method]
  if (!operation) {
    throw new Error(`Missing ${method.toUpperCase()} /api/profile`)
  }

  return operation
}

@Module({
  controllers: [ProfileController],
  providers: [
    {
      provide: UserProfileService,
      useValue: { getCurrent: jest.fn(), updateCurrent: jest.fn() },
    },
  ],
})
class ProfileControllerContractModule {}

describe('ProfileController', () => {
  it('uses RequestAuthContext as the only target identity for GET and PATCH', async () => {
    const { controller, service } = createFixture()
    const request = createRequest()
    const dto = {
      email: 'user@example.com',
      // 即使绕过 ValidationPipe 构造恶意对象，目标身份仍只来自可信请求上下文。
      userId: '62ad40d4-7fa5-46fb-81e4-1986bcebf8f3',
    } as never

    await expect(controller.get(request)).resolves.toEqual(PROFILE)
    await expect(controller.update(dto, request)).resolves.toEqual(PROFILE)

    expect(service.getCurrent).toHaveBeenCalledWith(USER_ID)
    expect(service.updateCurrent).toHaveBeenCalledTimes(1)
    const updateCall = service.updateCurrent.mock.calls[0]
    expect(updateCall?.[0].actorUserId).toBe(USER_ID)
    expect(updateCall?.[0].requestId).toMatch(/^req_/u)
    expect(updateCall?.[1]).toBe(dto)
  })

  it('declares authenticated-only access without any users business permission', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(REQUIRE_AUTHENTICATED_SESSION_METADATA, ProfileController),
    ).toBe(true)
    expect(
      reflector.get(REQUIRED_PERMISSIONS_METADATA, ProfileController),
    ).toBeUndefined()
    for (const method of ['get', 'update'] as const) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          ProfileController.prototype[method],
        ),
      ).toBeUndefined()
    }
  })
})

describe('ProfileController API contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ProfileControllerContractModule)
  })

  it('publishes the authenticated no-authorization GET contract', () => {
    const operation = requireOperation(document, 'get')

    expect(operation.operationId).toBe('profile_get')
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
      session: 'required',
      privateNoStore: true,
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      ],
    })
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '401',
      '403',
      '500',
    ])
  })

  it('publishes CSRF, validation and stable conflict codes for PATCH', () => {
    const operation = requireOperation(document, 'patch')

    expect(operation.operationId).toBe('profile_update')
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: false,
      resourceLocator: false,
      conflict: true,
      validation: true,
      session: 'required',
      csrf: true,
      privateNoStore: true,
      errors: [
        {
          status: 403,
          codes: ['CSRF_REJECTED', 'PASSWORD_CHANGE_REQUIRED'],
        },
        {
          status: 409,
          codes: ['EMAIL_ALREADY_EXISTS', 'MOBILE_ALREADY_EXISTS'],
        },
      ],
    })
    expect(operation.parameters).toContainEqual({
      name: 'X-Qianshu-CSRF',
      in: 'header',
      required: true,
      schema: { type: 'string', enum: ['1'] },
    })
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '409',
      '422',
      '500',
    ])
  })
})
