import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ContainerBatchController } from './container-batch.controller'
import { ContainerBatchService } from './container-batch.service'

@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule, MediaModule, NumberingModule],
  controllers: [ContainerBatchController],
  providers: [ContainerBatchService],
  exports: [ContainerBatchService],
})
export class ContainerBatchModule {}
