import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { PurchaseShippingMarksController } from './purchase-shipping-marks.controller'
import { PurchaseShippingMarksService } from './purchase-shipping-marks.service'

// 本轮只注册配置管理；不依赖 NumberingGeneratorService，也不导出给采购创建流程。
@Module({
  imports: [PrismaModule, AuthModule, DictionaryModule],
  controllers: [PurchaseShippingMarksController],
  providers: [PurchaseShippingMarksService],
})
export class PurchaseShippingMarksModule {}
