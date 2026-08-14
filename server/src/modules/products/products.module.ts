import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyModule } from '../currencies/currency.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { NumberingModule } from '../numbering/numbering.module'
import { MediaModule } from '../media/media.module'
import { ProductMediaHttpService } from './media/product-media-http.service'
import { ProductMediaMultipartParser } from './media/product-media-multipart.parser'
import { ProductMediaPersistence } from './media/product-media.persistence'
import { ProductMediaService } from './media/product-media.service'
import { ProductCommandService } from './product-command.service'
import { ProductQueryService } from './product-query.service'
import { ProductUpdateService } from './product-update.service'
import { ProductsController } from './products.controller'

/** Product 只开放已确认的列表、创建、详情、更新与媒体维护边界。 */
@Module({
  imports: [
    PrismaModule,
    DictionaryModule,
    AuthModule,
    CurrencyModule,
    NumberingModule,
    MediaModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductQueryService,
    ProductCommandService,
    ProductUpdateService,
    ProductMediaPersistence,
    ProductMediaService,
    ProductMediaHttpService,
    {
      provide: ProductMediaMultipartParser,
      useFactory: (): ProductMediaMultipartParser =>
        new ProductMediaMultipartParser(),
    },
  ],
})
export class ProductsModule {}
