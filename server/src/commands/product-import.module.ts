import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import appConfig from '../config/app.config'
import authConfig from '../config/auth.config'
import { validateEnvironment } from '../config/env.validation'
import { PrismaModule } from '../infrastructure/database/prisma.module'
import { AuditService } from '../modules/audit/audit.service'
import { CurrencyLookupService } from '../modules/currencies/currency-lookup.service'
import { DictionaryCommandService } from '../modules/dictionaries/dictionary-command.service'
import { DictionaryLookupService } from '../modules/dictionaries/dictionary-lookup.service'
import { NumberingGeneratorService } from '../modules/numbering/numbering-generator.service'
import { ProductCommandService } from '../modules/products/product-command.service'
import { ProductTaxonomyService } from '../modules/products/product-taxonomy.service'
import { ProductImportService } from './product-import.service'

/**
 * 一次性导入命令的独立 application context：复用产品写入、发号、字典与审计
 * 服务，但不加载 HTTP controller/guard，也不把命令入口暴露成第二条公共 API。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      load: [appConfig, authConfig],
      validate: validateEnvironment,
    }),
    PrismaModule,
  ],
  providers: [
    AuditService,
    CurrencyLookupService,
    DictionaryCommandService,
    DictionaryLookupService,
    NumberingGeneratorService,
    ProductTaxonomyService,
    ProductCommandService,
    ProductImportService,
  ],
})
export class ProductImportModule {}
