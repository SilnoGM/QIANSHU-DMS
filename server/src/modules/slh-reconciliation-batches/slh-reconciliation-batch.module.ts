import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { SlhReconciliationBatchController } from './slh-reconciliation-batch.controller'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'

/** 对账功能整体处于冻结状态：当前只解冻「候选账单」读路径（新建入口的数据来源）。 */
@Module({
  imports: [PrismaModule],
  controllers: [SlhReconciliationBatchController],
  providers: [SlhReconciliationBatchQueryService],
})
export class SlhReconciliationBatchModule {}
