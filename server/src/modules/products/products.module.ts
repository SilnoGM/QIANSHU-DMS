import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyModule } from '../currencies/currency.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { NumberingModule } from '../numbering/numbering.module'
import { ProductCommandService } from './product-command.service'
import { ProductQueryService } from './product-query.service'
import { ProductsController } from './products.controller'

/** Product 只开放已确认的列表与创建边界；其余写 operation 仍不存在。 */
@Module({
  imports: [
    PrismaModule,
    DictionaryModule,
    AuthModule,
    CurrencyModule,
    NumberingModule,
  ],
  controllers: [ProductsController],
  providers: [ProductQueryService, ProductCommandService],
})
export class ProductsModule {}
