import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RegionCommandService } from './region-command.service'
import { RegionQueryService } from './region-query.service'
import { RegionSelectionController } from './region-selection.controller'
import { RegionsController } from './regions.controller'
import { RegionsModule } from './regions.module'

describe('RegionsModule metadata', () => {
  it('composes the shared database/auth providers and both HTTP boundaries', () => {
    expect(Reflect.getMetadata('imports', RegionsModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', RegionsModule)).toEqual([
      RegionSelectionController,
      RegionsController,
    ])
    expect(Reflect.getMetadata('providers', RegionsModule)).toEqual([
      RegionQueryService,
      RegionCommandService,
    ])
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(RegionsModule)
  })
})
