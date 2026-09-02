import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ProductsModule } from '../products/products.module'
import { SalesOrderCommandService } from './sales-order-command.service'
import { SalesOrderProductEditQueryService } from './sales-order-product-edit-query.service'
import { SalesOrderProductEditService } from './sales-order-product-edit.service'
import { SalesOrderDocumentMultipartParser } from './documents/sales-order-document-multipart.parser'
import { SalesOrderDocumentService } from './documents/sales-order-document.service'
import { SalesOrderMutationService } from './sales-order-mutation.service'
import { SalesOrderProductImageService } from './products/sales-order-product-image.service'
import { SalesOrderQueryService } from './sales-order-query.service'
import { SalesOrdersController } from './sales-orders.controller'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DictionaryModule,
    MediaModule,
    NumberingModule,
    ProductsModule,
  ],
  controllers: [SalesOrdersController],
  providers: [
    SalesOrderQueryService,
    SalesOrderProductEditQueryService,
    SalesOrderProductEditService,
    SalesOrderCommandService,
    SalesOrderMutationService,
    SalesOrderDocumentService,
    SalesOrderProductImageService,
    {
      provide: SalesOrderDocumentMultipartParser,
      useFactory: (): SalesOrderDocumentMultipartParser =>
        new SalesOrderDocumentMultipartParser(),
    },
  ],
})
export class SalesOrdersModule {}
