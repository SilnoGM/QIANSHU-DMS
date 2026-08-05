import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingModule } from '../numbering/numbering.module'
import { RegionsModule } from '../regions/regions.module'
import { SupplierCommandService } from './supplier-command.service'
import { SupplierLifecycleService } from './supplier-lifecycle.service'
import { SupplierQueryService } from './supplier-query.service'
import { SuppliersController } from './suppliers.controller'

/** Supplier 复用 Auth 的 Audit、Numbering Generator 和事务内 Region Lookup。 */
@Module({
  imports: [PrismaModule, AuthModule, NumberingModule, RegionsModule],
  controllers: [SuppliersController],
  providers: [
    SupplierQueryService,
    SupplierCommandService,
    SupplierLifecycleService,
  ],
})
export class SuppliersModule {}
