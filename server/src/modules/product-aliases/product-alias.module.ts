import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { ProductAliasController } from './product-alias.controller'
import { ProductAliasService } from './product-alias.service'

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProductAliasController],
  providers: [ProductAliasService],
  exports: [ProductAliasService],
})
export class ProductAliasesModule {}
