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
import { PurchaseOrderReviewContextService } from './purchase-order-review-context.service'
import { PurchaseOrderReviewContextController } from './purchase-order-review-context.controller'
import { PurchaseOrdersController } from './purchase-orders.controller'
import { SalesOrderPurchaseCoverageService } from './sales-order-purchase-coverage.service'
import { PurchaseShipmentController } from './shipments/purchase-shipment.controller'
import { PurchaseShipmentQueryService } from './shipments/purchase-shipment-query.service'

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
    PurchaseOrderReviewContextController,
    PurchaseOrderFactoryShipmentController,
    SalesOrderFactoryShipmentController,
    PurchaseShipmentController,
  ],
  providers: [
    PurchaseOrderQueryService,
    PurchaseOrderReviewContextService,
    PurchaseOrderSourceQueryService,
    PurchaseOrderCreateDependencyService,
    SalesOrderPurchaseCoverageService,
    PurchaseOrderFactoryShipmentQueryService,
    PurchaseOrderFactoryShipmentService,
    PurchaseOrderCommandService,
    PurchaseOrderMutationService,
    PurchaseOrderDocumentService,
    PurchaseOrderProductImageService,
    PurchaseShipmentQueryService,
    {
      provide: PurchaseOrderDocumentMultipartParser,
      useFactory: (): PurchaseOrderDocumentMultipartParser =>
        new PurchaseOrderDocumentMultipartParser(),
    },
  ],
})
export class PurchaseOrdersModule {}
