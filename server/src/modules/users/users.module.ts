import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

/** 用户管理复用 AuthModule 中唯一的 Argon2 队列、密码策略和 Audit provider。 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
