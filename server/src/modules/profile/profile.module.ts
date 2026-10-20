import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { ProfileAvatarService } from './profile-avatar.service'
import { ProfileController } from './profile.controller'
import { UserProfileService } from './user-profile.service'

/** 本人资料复用 AuthModule 中唯一的 Audit provider，并导出事务内更新能力。 */
@Module({
  imports: [PrismaModule, AuthModule, MediaModule],
  controllers: [ProfileController],
  providers: [ProfileAvatarService, UserProfileService],
  exports: [UserProfileService],
})
export class ProfileModule {}
