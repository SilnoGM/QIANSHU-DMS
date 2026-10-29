import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { ShipmentOwnershipModule } from '../shipment-ownership/shipment-ownership.module'
import { ShipmentStorageCostService } from './shipment-storage-cost.service'
import { ShipmentStorageController } from './shipment-storage.controller'
import { ShipmentStorageService } from './shipment-storage.service'

/**
 * 审计服务从 AuthModule 复用唯一实例；本模块单独 provide 会产生第二个
 * AuditService，导致测试与审计注入指向错误实例。
 */
@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule, FundAccountsModule, ShipmentOwnershipModule],
  controllers: [ShipmentStorageController],
  providers: [ShipmentStorageService, ShipmentStorageCostService],
  exports: [ShipmentStorageService],
})
export class ShipmentStorageModule {}
