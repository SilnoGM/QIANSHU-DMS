import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingModule } from '../numbering/numbering.module'
import { RegionsModule } from '../regions/regions.module'
import { SupplierCommandService } from './supplier-command.service'
import { SupplierLifecycleService } from './supplier-lifecycle.service'
import { SupplierQueryService } from './supplier-query.service'
import { SuppliersController } from './suppliers.controller'
import { SuppliersModule } from './suppliers.module'

describe('SuppliersModule metadata', () => {
  it('uses the exact approved infrastructure, boundary and provider set', () => {
    expect(Reflect.getMetadata('imports', SuppliersModule)).toEqual([
      PrismaModule,
      AuthModule,
      NumberingModule,
      RegionsModule,
    ])
    expect(Reflect.getMetadata('controllers', SuppliersModule)).toEqual([
      SuppliersController,
    ])
    expect(Reflect.getMetadata('providers', SuppliersModule)).toEqual([
      SupplierQueryService,
      SupplierCommandService,
      SupplierLifecycleService,
    ])
    expect(Reflect.getMetadata('exports', SuppliersModule)).toBeUndefined()
  })

  it('is registered exactly once in the live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES.filter(module => module === SuppliersModule))
      .toHaveLength(1)
  })
})
