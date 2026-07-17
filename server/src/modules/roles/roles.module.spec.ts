import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RolesController } from './roles.controller'
import { RolesModule } from './roles.module'
import { RolesService } from './roles.service'

describe('RolesModule metadata', () => {
  it('registers Role HTTP and transactional dependencies', () => {
    expect(Reflect.getMetadata('imports', RolesModule)).toEqual(
      expect.arrayContaining([PrismaModule, AuthModule]),
    )
    expect(Reflect.getMetadata('controllers', RolesModule)).toEqual([
      RolesController,
    ])
    expect(Reflect.getMetadata('providers', RolesModule)).toEqual([
      RolesService,
    ])
  })
})
