import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { ProfileController } from './profile.controller'
import { ProfileModule } from './profile.module'
import { UserProfileService } from './user-profile.service'

describe('ProfileModule metadata', () => {
  it('registers the HTTP controller and exports the reusable transaction service', () => {
    expect(Reflect.getMetadata('imports', ProfileModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', ProfileModule)).toEqual([
      ProfileController,
    ])
    expect(Reflect.getMetadata('providers', ProfileModule)).toEqual([
      UserProfileService,
    ])
    expect(Reflect.getMetadata('exports', ProfileModule)).toEqual([
      UserProfileService,
    ])
  })

  it('is registered in the single live HTTP module list', () => {
    expect(HTTP_MODULES).toContain(ProfileModule)
  })
})
