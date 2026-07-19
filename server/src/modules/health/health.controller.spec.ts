import { Reflector } from '@nestjs/core'

import { PUBLIC_ROUTE_METADATA } from '../auth/decorators/auth.decorators'
import { HealthController } from './health.controller'

describe('HealthController authentication metadata', () => {
  it('keeps the infrastructure health probe explicitly public', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        PUBLIC_ROUTE_METADATA,
        HealthController.prototype.check,
      ),
    ).toBe(true)
  })
})
