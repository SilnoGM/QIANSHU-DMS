import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingModule } from '../numbering/numbering.module'
import { SlhReconciliationBatchController } from './slh-reconciliation-batch.controller'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'
import { SlhReconciliationBatchService } from './slh-reconciliation-batch.service'

/**
 * 对账批次模块。当前解冻的路径：候选账单（选账单的数据来源）、创建批次头与完成批次；
 * 批次列表、详情读取与匹配预览仍是空壳。
 * 读写都复用 `slh-bills:reconcile`，不新增权限码。
 */
@Module({
  imports: [PrismaModule, AuthModule, NumberingModule],
  controllers: [SlhReconciliationBatchController],
  providers: [SlhReconciliationBatchService, SlhReconciliationBatchQueryService],
})
export class SlhReconciliationBatchModule {}
