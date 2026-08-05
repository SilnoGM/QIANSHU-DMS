import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RegionCommandService } from './region-command.service'
import { RegionLookupService } from './region-lookup.service'
import { RegionQueryService } from './region-query.service'
import { RegionSelectionController } from './region-selection.controller'
import { RegionsController } from './regions.controller'

/** 地区模块共享数据库与认证基础设施；权限边界由两个 Controller 分别声明。 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RegionSelectionController, RegionsController],
  providers: [RegionQueryService, RegionCommandService, RegionLookupService],
  exports: [RegionLookupService],
})
export class RegionsModule {}
