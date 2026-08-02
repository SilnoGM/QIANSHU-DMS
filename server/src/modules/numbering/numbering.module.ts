import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingCommandService } from './numbering-command.service'
import { NumberingController } from './numbering.controller'
import { NumberingGeneratorService } from './numbering-generator.service'
import { NumberingQueryService } from './numbering-query.service'

/**
 * 管理 HTTP 与内部发号共用同一领域模块。只有 Generator 对业务域导出，query、
 * command 与 Controller 均保持模块私有，避免出现第二套管理调用边界。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NumberingController],
  providers: [
    NumberingQueryService,
    NumberingCommandService,
    NumberingGeneratorService,
  ],
  exports: [NumberingGeneratorService],
})
export class NumberingModule {}
