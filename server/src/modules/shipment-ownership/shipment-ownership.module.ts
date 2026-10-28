import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { ShipmentOwnershipBackfillService } from './shipment-ownership-backfill.service'
import { ShipmentOwnershipParityService } from './shipment-ownership-parity.service'
import { ShipmentOwnershipService } from './shipment-ownership.service'

@Module({
  imports: [PrismaModule],
  providers: [
    ShipmentOwnershipService,
    ShipmentOwnershipBackfillService,
    ShipmentOwnershipParityService,
  ],
  exports: [
    ShipmentOwnershipService,
    ShipmentOwnershipBackfillService,
    ShipmentOwnershipParityService,
  ],
})
export class ShipmentOwnershipModule {}
