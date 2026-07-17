import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuditQueryService } from './audit-query.service'
import { AuditController } from './audit.controller'

@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditModule {}
