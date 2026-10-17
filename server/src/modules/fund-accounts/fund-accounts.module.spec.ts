import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingModule } from '../numbering/numbering.module'
import { FundAccountCommandService } from './application/fund-account-command.service'
import { FundAccountQueryService } from './application/fund-account-query.service'
import { FundConfigurationCommandService } from './application/fund-configuration-command.service'
import { FundConfigurationQueryService } from './application/fund-configuration-query.service'
import { FundPostingBatchNumberBackfillService } from './application/fund-posting-batch-number-backfill.service'
import { FundPostingService } from './application/fund-posting.contract'
import { FundPostingApplicationService } from './application/fund-posting.service'
import { FundTransactionQueryService } from './application/fund-transaction-query.service'
import { FundAccountsController } from './fund-accounts.controller'
import { FundAccountsModule } from './fund-accounts.module'
import { FundBusinessSourcesController } from './fund-business-sources.controller'
import { FundPostingTypesController } from './fund-posting-types.controller'
import { FundTransactionsController } from './fund-transactions.controller'

describe('FundAccountsModule metadata', () => {
  it('keeps administration private and exports only the internal posting port', () => {
    expect(Reflect.getMetadata('imports', FundAccountsModule)).toEqual([
      PrismaModule,
      AuthModule,
      NumberingModule,
    ])
    expect(Reflect.getMetadata('controllers', FundAccountsModule)).toEqual([
      FundAccountsController,
      FundTransactionsController,
      FundPostingTypesController,
      FundBusinessSourcesController,
    ])
    expect(Reflect.getMetadata('providers', FundAccountsModule)).toEqual([
      FundAccountQueryService,
      FundAccountCommandService,
      FundConfigurationQueryService,
      FundConfigurationCommandService,
      FundTransactionQueryService,
      FundPostingApplicationService,
      FundPostingBatchNumberBackfillService,
      {
        provide: FundPostingService,
        useExisting: FundPostingApplicationService,
      },
    ])
    expect(Reflect.getMetadata('exports', FundAccountsModule)).toEqual([
      FundPostingService,
    ])
  })

  it('is registered in the shared live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(FundAccountsModule)
  })
})
