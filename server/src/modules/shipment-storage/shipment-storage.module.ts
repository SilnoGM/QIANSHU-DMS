import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuditService } from '../audit/audit.service'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { ShipmentOwnershipModule } from '../shipment-ownership/shipment-ownership.module'
import { ShipmentStorageController } from './shipment-storage.controller'
import { ShipmentStorageService } from './shipment-storage.service'

@Module({
  imports: [PrismaModule, DictionaryModule, ShipmentOwnershipModule],
  controllers: [ShipmentStorageController],
  providers: [ShipmentStorageService, AuditService],
  exports: [ShipmentStorageService],
})
export class ShipmentStorageModule {}
