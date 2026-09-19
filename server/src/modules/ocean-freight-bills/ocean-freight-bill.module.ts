import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { OceanFreightBillController } from './ocean-freight-bill.controller'
import { OceanFreightBillService } from './ocean-freight-bill.service'

@Module({ imports: [PrismaModule, AuthModule, MediaModule, NumberingModule], controllers: [OceanFreightBillController], providers: [OceanFreightBillService] })
export class OceanFreightBillModule {}
