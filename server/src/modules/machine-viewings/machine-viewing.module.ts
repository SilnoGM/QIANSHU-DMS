import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingModule } from '../numbering/numbering.module'
import { MachineViewingController } from './machine-viewing.controller'
import { MachineViewingQueryService } from './machine-viewing-query.service'
import { MachineViewingService } from './machine-viewing.service'

@Module({
  imports: [PrismaModule, AuthModule, NumberingModule],
  controllers: [MachineViewingController],
  providers: [MachineViewingService, MachineViewingQueryService],
})
export class MachineViewingModule {}
