import { SalesOrderPendingPurchaseController } from './sales-order-pending-purchase.controller'
import { SalesOrderPendingPurchaseQueryService } from './sales-order-pending-purchase-query.service'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { SalesReceiptController, SalesReceiptOrderController } from './receipts/sales-receipt.controller'
import { SalesReceiptService } from './receipts/sales-receipt.service'
import { SalesReceiptQueryService } from './receipts/sales-receipt-query.service'
import { SalesReceiptVoucherService } from './receipts/sales-receipt-voucher.service'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ProductsModule } from '../products/products.module'
import { SalesOrderCommandService } from './sales-order-command.service'
import { SalesOrderAutomaticStateService } from './sales-order-automatic-state.service'
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
    FundAccountsModule,
    AuthModule,
    DictionaryModule,
    MediaModule,
    NumberingModule,
    ProductsModule,
  ],
  controllers: [SalesOrderPendingPurchaseController, SalesOrdersController, SalesReceiptController, SalesReceiptOrderController],
  // 自动进待对账服务由顺联航对账域的完成批次复用（代收回填后推进订单）。
  exports: [SalesOrderAutomaticStateService],
  providers: [
    SalesReceiptService, SalesReceiptQueryService, SalesReceiptVoucherService,
    SalesOrderQueryService,
    SalesOrderPendingPurchaseQueryService,
    SalesOrderProductEditQueryService,
    SalesOrderProductEditService,
    SalesOrderCommandService,
    SalesOrderAutomaticStateService,
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
