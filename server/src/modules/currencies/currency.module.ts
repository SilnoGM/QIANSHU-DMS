import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyCatalogController } from './currency-catalog.controller'
import { CurrencyCommandService } from './currency-command.service'
import { CurrencyQueryService } from './currency-query.service'
import { CurrenciesController } from './currencies.controller'

/** 货币模块共享数据库和认证设施，由 Catalog 与管理 Controller 分别声明准入。 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CurrencyCatalogController, CurrenciesController],
  providers: [CurrencyQueryService, CurrencyCommandService],
})
export class CurrencyModule {}
