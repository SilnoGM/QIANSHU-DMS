import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyModule } from '../currencies/currency.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ProductCommandService } from './product-command.service'
import { ProductQueryService } from './product-query.service'
import { ProductUpdateService } from './product-update.service'
import { ProductsController } from './products.controller'

/** Product 只开放已确认的列表、创建、详情与更新边界；其余 operation 不存在。 */
@Module({
  imports: [
    PrismaModule,
    DictionaryModule,
    AuthModule,
    CurrencyModule,
    NumberingModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductQueryService,
    ProductCommandService,
    ProductUpdateService,
  ],
})
export class ProductsModule {}
