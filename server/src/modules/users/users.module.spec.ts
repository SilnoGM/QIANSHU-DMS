import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { ProfileModule } from '../profile/profile.module'
import { UsersController } from './users.controller'
import { UsersModule } from './users.module'
import { UsersService } from './users.service'

describe('UsersModule metadata', () => {
  it('registers the controller, service and required infrastructure modules', () => {
    expect(Reflect.getMetadata('imports', UsersModule)).toEqual(
      expect.arrayContaining([PrismaModule, AuthModule, ProfileModule]),
    )
    expect(Reflect.getMetadata('controllers', UsersModule)).toEqual([
      UsersController,
    ])
    expect(Reflect.getMetadata('providers', UsersModule)).toEqual([
      UsersService,
    ])
  })
})
