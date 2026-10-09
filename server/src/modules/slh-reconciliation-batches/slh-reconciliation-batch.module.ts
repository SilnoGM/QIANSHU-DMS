import { Module } from '@nestjs/common'
import { SlhReconciliationBatchController } from './slh-reconciliation-batch.controller'

/** 对账功能已整体冻结：控制器只保留接口定义、权限与契约声明，不再注册任何服务实现。 */
@Module({
  controllers: [SlhReconciliationBatchController],
})
export class SlhReconciliationBatchModule {}
