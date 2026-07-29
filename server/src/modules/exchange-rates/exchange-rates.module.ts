import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { ExchangeRateCommandService } from './exchange-rate-command.service'
import { ExchangeRateQueryService } from './exchange-rate-query.service'
import { ExchangeRatesController } from './exchange-rates.controller'

/** 汇率管理模块共享数据库与认证基础设施，具体权限由 Controller handler 声明。 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ExchangeRatesController],
  providers: [ExchangeRateQueryService, ExchangeRateCommandService],
})
export class ExchangeRatesModule {}
