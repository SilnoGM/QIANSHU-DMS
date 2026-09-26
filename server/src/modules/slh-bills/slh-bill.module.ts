import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { SlhBillController } from './slh-bill.controller'
import { SlhBillService } from './slh-bill.service'
import { SlhBillQueryService } from './slh-bill-query.service'
import { SlhBillSourceFileService } from './slh-bill-source-file.service'

@Module({
  imports: [PrismaModule, AuthModule, MediaModule, NumberingModule],
  controllers: [SlhBillController],
  providers: [SlhBillService, SlhBillQueryService, SlhBillSourceFileService],
})
export class SlhBillModule {}
