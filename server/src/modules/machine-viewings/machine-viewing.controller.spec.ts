import { HttpStatus } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'

import { getRequestId, requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { MachineViewingController } from './machine-viewing.controller'
import type { CreateMachineViewingDto, MachineViewingDto } from './machine-viewing.dto'
import type { MachineViewingQueryService } from './machine-viewing-query.service'
import type { MachineViewingService } from './machine-viewing.service'

const ACTOR = 'c1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'
const SESSION_ID = 'd1a2b3c4-d5e6-47f8-9a0b-c1d2e3f4a5b6'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR,
    username: 'viewing_operator',
    displayName: '测试运营',
    mustChangePassword: false,
    createdAt: new Date('2026-11-05T00:00:00.000Z'),
    lastActivityAt: new Date('2026-11-05T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-11-06T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-12-05T00:00:00.000Z'),
  })
  return request
}

const RESULT: MachineViewingDto = {
  id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
  appointmentNo: 'MV/20261105-0001',
  site: 'TAICHUNG_LONGJING',
  machineType: 'SHREDDER',
  appointmentDate: '2026-11-20',
  period: 'AM',
  hour: null,
  customerName: '陈先生',
  customerPhone: null,
  contactPerson: '李华',
  createdBy: { id: ACTOR, name: '测试运营', avatarUrl: null },
  createdAt: '2026-11-05T02:00:00.000Z',
}

function permissionsOf(method: keyof MachineViewingController): unknown {
  return new Reflector().get(REQUIRED_PERMISSIONS_METADATA, MachineViewingController.prototype[method])
}

describe('MachineViewingController', () => {
  it('lists through the actor-scoped query service under machine-viewings:read', async () => {
    const queries = {
      listForActor: jest.fn().mockResolvedValue({ items: [RESULT], page: 1, pageSize: 20, total: 1 }),
    }
    const service = { create: jest.fn() }
    const controller = new MachineViewingController(
      queries as unknown as MachineViewingQueryService,
      service as unknown as MachineViewingService,
    )

    await expect(controller.list({ page: 1, pageSize: 20 }, ACTOR)).resolves.toEqual({
      items: [RESULT],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(queries.listForActor).toHaveBeenCalledWith(ACTOR, { page: 1, pageSize: 20 })
    expect(permissionsOf('list')).toEqual(['machine-viewings:read'])
  })

  it('creates under machine-viewings:create only', async () => {
    const input: CreateMachineViewingDto = {
      site: 'TAICHUNG_LONGJING',
      machineType: 'SHREDDER',
      appointmentMonth: 11,
      appointmentDay: 20,
      period: 'AM',
      customerName: '陈先生',
      contactPerson: '李华',
    }
    const request = createRequest()
    const queries = { listForActor: jest.fn() }
    const service = { create: jest.fn().mockResolvedValue(RESULT) }
    const controller = new MachineViewingController(
      queries as unknown as MachineViewingQueryService,
      service as unknown as MachineViewingService,
    )

    await expect(controller.create(input, '3f2504e0-4f89-41d3-9a0c-0305e82c3301', request))
      .resolves.toEqual(RESULT)
    expect(service.create).toHaveBeenCalledWith(
      { actorUserId: ACTOR, requestId: getRequestId(request) },
      input,
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    )
    expect(permissionsOf('create')).toEqual(['machine-viewings:create'])
    expect(new Reflector().get(HTTP_CODE_METADATA, MachineViewingController.prototype.create))
      .toBe(HttpStatus.CREATED)
  })
})
