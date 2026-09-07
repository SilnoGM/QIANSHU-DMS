import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { PurchaseShippingMarksController } from './purchase-shipping-marks.controller'
import { PurchaseShippingMarksService } from './purchase-shipping-marks.service'
import { PurchaseShippingMarkResolverService } from './purchase-shipping-mark-resolver.service'

// 配置与只读解析共用采购专属边界；实际派发由采购命令在自身事务中协调编号服务。
@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule],
  controllers: [PurchaseShippingMarksController],
  providers: [PurchaseShippingMarksService, PurchaseShippingMarkResolverService],
  exports: [PurchaseShippingMarkResolverService],
})
export class PurchaseShippingMarksModule {}
