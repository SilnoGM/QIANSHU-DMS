import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { FundAccountCommandService } from './application/fund-account-command.service'
import { FundAccountQueryService } from './application/fund-account-query.service'
import { FundConfigurationCommandService } from './application/fund-configuration-command.service'
import { FundConfigurationQueryService } from './application/fund-configuration-query.service'
import { FundPostingService } from './application/fund-posting.contract'
import { FundPostingApplicationService } from './application/fund-posting.service'
import { FundTransactionQueryService } from './application/fund-transaction-query.service'
import { FundAccountsController } from './fund-accounts.controller'
import { FundBusinessSourcesController } from './fund-business-sources.controller'
import { FundPostingTypesController } from './fund-posting-types.controller'
import { FundTransactionsController } from './fund-transactions.controller'

/**
 * HTTP 管理能力留在模块内部；其他 Server 业务域只能注入抽象 FundPostingService，
 * 不会获得人工调账、冲账、配置命令或 Prisma persistence。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    FundAccountsController,
    FundTransactionsController,
    FundPostingTypesController,
    FundBusinessSourcesController,
  ],
  providers: [
    FundAccountQueryService,
    FundAccountCommandService,
    FundConfigurationQueryService,
    FundConfigurationCommandService,
    FundTransactionQueryService,
    FundPostingApplicationService,
    {
      provide: FundPostingService,
      useExisting: FundPostingApplicationService,
    },
  ],
  exports: [FundPostingService],
})
export class FundAccountsModule {}
