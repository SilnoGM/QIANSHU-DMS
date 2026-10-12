import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { NumberingModule } from '../numbering/numbering.module'
import { SlhReconciliationBatchController } from './slh-reconciliation-batch.controller'
import { SlhReconciliationBatchQueryService } from './slh-reconciliation-batch-query.service'
import { SlhReconciliationBatchService } from './slh-reconciliation-batch.service'

/**
 * 对账批次模块。当前解冻的路径：候选账单（选账单的数据来源）、创建批次头与完成批次；
 * 批次列表、详情读取与匹配预览仍是空壳。
 * 读写都复用 `slh-bills:reconcile`，不新增权限码；详情里的采购/销售来源摘要经确认后
 * 同样只受这一个权限码门控（见 DTO 注释），供应商标签复用字典模块的只读解析。
 * 完成批次要逐行入账，因此按其他业务域的口径注入资金模块的抽象动账端口。
 */
@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule, NumberingModule, FundAccountsModule],
  controllers: [SlhReconciliationBatchController],
  providers: [SlhReconciliationBatchService, SlhReconciliationBatchQueryService],
})
export class SlhReconciliationBatchModule {}
