import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { PackagingCostController } from './packaging-cost.controller'
import { PackagingCostService } from './packaging-cost.service'
import { PackagingCostQueryService } from './packaging-cost-query.service'
import { PackagingCostImageService } from './packaging-cost-image.service'

@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule, MediaModule, FundAccountsModule],
  controllers: [PackagingCostController],
  providers: [PackagingCostService, PackagingCostQueryService, PackagingCostImageService],
})
export class PackagingCostModule {}
