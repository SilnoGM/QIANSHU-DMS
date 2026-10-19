import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import appConfig from '../config/app.config'
import authConfig from '../config/auth.config'
import { validateEnvironment } from '../config/env.validation'
import { PrismaModule } from '../infrastructure/database/prisma.module'
import { ProductExportService } from './product-export.service'

/** 只读导出命令的独立上下文：不加载 HTTP controller/guard。 */
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
  providers: [ProductExportService],
})
export class ProductExportModule {}
