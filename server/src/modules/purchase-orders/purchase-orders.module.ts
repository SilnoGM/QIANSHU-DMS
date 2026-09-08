import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ProductsModule } from '../products/products.module'
import { PurchaseShippingMarksModule } from '../purchase-shipping-marks/purchase-shipping-marks.module'
import { PurchaseOrderDocumentMultipartParser } from './documents/purchase-order-document-multipart.parser'
import { PurchaseOrderDocumentService } from './documents/purchase-order-document.service'
import {
  PurchaseOrderFactoryShipmentController,
  SalesOrderFactoryShipmentController,
} from './factory-shipments/purchase-order-factory-shipment.controller'
import { PurchaseOrderFactoryShipmentQueryService } from './factory-shipments/purchase-order-factory-shipment-query.service'
import { PurchaseOrderFactoryShipmentService } from './factory-shipments/purchase-order-factory-shipment.service'
import { PurchaseOrderCommandService } from './purchase-order-command.service'
import { PurchaseOrderCreateDependencyService } from './purchase-order-create-dependency.service'
import { PurchaseOrderMutationService } from './purchase-order-mutation.service'
import { PurchaseOrderProductImageService } from './products/purchase-order-product-image.service'
import { PurchaseOrderQueryService } from './purchase-order-query.service'
import { PurchaseOrderSourceQueryService } from './purchase-order-source-query.service'
import { PurchaseOrdersController } from './purchase-orders.controller'
import { SalesOrderPurchaseCoverageService } from './sales-order-purchase-coverage.service'

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    DictionaryModule,
    MediaModule,
    NumberingModule,
    ProductsModule,
    PurchaseShippingMarksModule,
  ],
  controllers: [
    PurchaseOrdersController,
    PurchaseOrderFactoryShipmentController,
    SalesOrderFactoryShipmentController,
  ],
  providers: [
    PurchaseOrderQueryService,
    PurchaseOrderSourceQueryService,
    PurchaseOrderCreateDependencyService,
    SalesOrderPurchaseCoverageService,
    PurchaseOrderFactoryShipmentQueryService,
    PurchaseOrderFactoryShipmentService,
    PurchaseOrderCommandService,
    PurchaseOrderMutationService,
    PurchaseOrderDocumentService,
    PurchaseOrderProductImageService,
    {
      provide: PurchaseOrderDocumentMultipartParser,
      useFactory: (): PurchaseOrderDocumentMultipartParser =>
        new PurchaseOrderDocumentMultipartParser(),
    },
  ],
})
export class PurchaseOrdersModule {}
