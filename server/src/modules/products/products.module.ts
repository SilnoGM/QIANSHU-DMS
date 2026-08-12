import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { ProductQueryService } from './product-query.service'
import { ProductsController } from './products.controller'

/** 产品首期只注册查询 Service；不存在 Command provider 或写 Controller。 */
@Module({
  imports: [PrismaModule, DictionaryModule],
  controllers: [ProductsController],
  providers: [ProductQueryService],
})
export class ProductsModule {}
