import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RegionQueryService } from './region-query.service'
import { RegionSelectionController } from './region-selection.controller'

/** 地区模块共享数据库与认证基础设施，但选择接口不依赖地区管理权限。 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RegionSelectionController],
  providers: [RegionQueryService],
})
export class RegionsModule {}
