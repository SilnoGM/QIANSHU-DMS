import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { SlhBillAmountBackfillService } from './slh-bill-amount-backfill.service'
import { SlhBillController } from './slh-bill.controller'
import { SlhBillService } from './slh-bill.service'
import { SlhBillQueryService } from './slh-bill-query.service'
import { SlhBillRecipientBackfillService } from './slh-bill-recipient-backfill.service'
import { SlhBillSourceFileService } from './slh-bill-source-file.service'

@Module({
  imports: [PrismaModule, AuthModule, MediaModule, NumberingModule],
  controllers: [SlhBillController],
  providers: [SlhBillService, SlhBillQueryService, SlhBillSourceFileService, SlhBillRecipientBackfillService, SlhBillAmountBackfillService],
})
export class SlhBillModule {}
