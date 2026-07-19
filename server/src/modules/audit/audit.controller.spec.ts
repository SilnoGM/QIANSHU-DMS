import { Reflector } from '@nestjs/core'

import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { AuditQueryService } from './audit-query.service'
import { AuditController } from './audit.controller'

describe('AuditController', () => {
  it('forwards only pagination and requires audit:read', async () => {
    const page = { items: [], page: 2, pageSize: 50, total: 0 }
    const service = { list: jest.fn().mockResolvedValue(page) }
    const controller = new AuditController(
      service as unknown as AuditQueryService,
    )
    const query = { page: 2, pageSize: 50 }

    await expect(controller.list(query)).resolves.toEqual(page)
    expect(service.list).toHaveBeenCalledWith(query)
    expect(
      new Reflector().get(
        REQUIRED_PERMISSIONS_METADATA,
        AuditController.prototype.list,
      ),
    ).toEqual(['audit:read'])
  })
})
