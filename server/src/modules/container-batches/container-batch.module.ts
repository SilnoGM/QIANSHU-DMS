import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ContainerBatchController } from './container-batch.controller'
import { ContainerBatchService } from './container-batch.service'
import { ContainerSourceFileController } from './container-source-file.controller'
import { ContainerSourceFileService } from './container-source-file.service'
import { ContainerImportController } from './container-import.controller'
import { ContainerImportService } from './container-import.service'
import { OperationsOceanContainerController } from './operations-ocean-container.controller'
import { OperationsOceanContainerService } from './operations-ocean-container.service'
import { OperationsOceanChangeController } from './operations-ocean-change.controller'
import { OperationsOceanChangeService } from './operations-ocean-change.service'

@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule, MediaModule, NumberingModule],
  controllers: [ContainerBatchController, ContainerSourceFileController, ContainerImportController, OperationsOceanContainerController, OperationsOceanChangeController],
  providers: [ContainerBatchService, ContainerSourceFileService, ContainerImportService, OperationsOceanContainerService, OperationsOceanChangeService],
  exports: [ContainerBatchService],
})
export class ContainerBatchModule {}
