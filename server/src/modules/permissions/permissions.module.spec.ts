import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { PermissionsController } from './permissions.controller'
import { PermissionsModule } from './permissions.module'
import { PermissionsService } from './permissions.service'

describe('PermissionsModule metadata', () => {
  it('registers the read-only Permission directory', () => {
    expect(Reflect.getMetadata('imports', PermissionsModule)).toEqual([
      PrismaModule,
    ])
    expect(Reflect.getMetadata('controllers', PermissionsModule)).toEqual([
      PermissionsController,
    ])
    expect(Reflect.getMetadata('providers', PermissionsModule)).toEqual([
      PermissionsService,
    ])
  })
})
