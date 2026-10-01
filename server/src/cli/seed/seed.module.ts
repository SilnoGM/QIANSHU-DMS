import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import appConfig from '../../config/app.config'
import authConfig from '../../config/auth.config'
import { validateEnvironment } from '../../config/env.validation'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../../modules/audit/audit.service'
import { CurrencyCommandService } from '../../modules/currencies/currency-command.service'
import { DictionaryCommandService } from '../../modules/dictionaries/dictionary-command.service'
import { DictionaryLookupService } from '../../modules/dictionaries/dictionary-lookup.service'
import { ExchangeRateCommandService } from '../../modules/exchange-rates/exchange-rate-command.service'
import { FundConfigurationCommandService } from '../../modules/fund-accounts/application/fund-configuration-command.service'
import { NumberingCommandService } from '../../modules/numbering/numbering-command.service'
import { NumberingQueryService } from '../../modules/numbering/numbering-query.service'
import { PurchaseShippingMarksService } from '../../modules/purchase-shipping-marks/purchase-shipping-marks.service'
import { RolesService } from '../../modules/roles/roles.service'
import { SeedService } from './seed.service'

const seedServiceDefinition = {
  provide: SeedService,
  inject: [
    PrismaService,
    RolesService,
    DictionaryCommandService,
    CurrencyCommandService,
    ExchangeRateCommandService,
    NumberingCommandService,
    PurchaseShippingMarksService,
    FundConfigurationCommandService,
  ],
  useFactory: (
    prisma: PrismaService,
    roles: RolesService,
    dictionaries: DictionaryCommandService,
    currencies: CurrencyCommandService,
    exchangeRates: ExchangeRateCommandService,
    numbering: NumberingCommandService,
    shippingMarks: PurchaseShippingMarksService,
    fundConfiguration: FundConfigurationCommandService,
  ): SeedService => new SeedService({
    prisma,
    roles,
    dictionaries,
    currencies,
    exchangeRates,
    numbering,
    shippingMarks,
    fundConfiguration,
  }),
}

/**
 * CLI 使用独立 application context：复用完整环境校验与 Prisma 生命周期，但不加载
 * HTTP controller/guard。管理命令服务按各领域模块相同的依赖重新声明，保持领域模块
 * "命令服务不对外导出"的既有边界，不引入第二条 HTTP 管理入口。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig, authConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
  ],
  providers: [
    AuditService,
    DictionaryLookupService,
    NumberingQueryService,
    RolesService,
    DictionaryCommandService,
    CurrencyCommandService,
    ExchangeRateCommandService,
    NumberingCommandService,
    PurchaseShippingMarksService,
    FundConfigurationCommandService,
    seedServiceDefinition,
  ],
})
export class SeedModule {}
