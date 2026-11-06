import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { MachineViewingController } from './machine-viewing.controller'
import { MachineViewingQueryService } from './machine-viewing-query.service'
import { MachineViewingService } from './machine-viewing.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MachineViewingController],
  providers: [MachineViewingService, MachineViewingQueryService],
})
export class MachineViewingModule {}
