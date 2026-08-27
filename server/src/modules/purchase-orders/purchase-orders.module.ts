import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { PurchaseOrderDocumentMultipartParser } from './documents/purchase-order-document-multipart.parser'
import { PurchaseOrderDocumentService } from './documents/purchase-order-document.service'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import { PurchaseOrderCreateDependencyService } from './purchase-order-create-dependency.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import { PurchaseOrderQueryService } from './purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'
import { PurchaseOrdersController } from './purchase-orders.controller'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DictionaryModule,
    MediaModule,
    NumberingModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrderQueryService,
    PurchaseOrderSourceQueryService,
    PurchaseOrderCreateDependencyService,
    PurchaseOrderCommandService,
    PurchaseOrderMutationService,
    PurchaseOrderDocumentService,
    {
      provide: PurchaseOrderDocumentMultipartParser,
      useFactory: (): PurchaseOrderDocumentMultipartParser =>
        new PurchaseOrderDocumentMultipartParser(),
    },
  ],
})
export class PurchaseOrdersModule {}
