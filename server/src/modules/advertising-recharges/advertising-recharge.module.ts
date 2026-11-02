import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { AdvertisingRechargeController } from './advertising-recharge.controller'
import { AdvertisingRechargeDocumentService } from './advertising-recharge-document.service'
import { AdvertisingRechargeQueryService } from './advertising-recharge-query.service'
import { AdvertisingRechargeService } from './advertising-recharge.service'

/**
 * 广告账户充值申请：运营提交，财务付款并上传付款截图。
 *
 * 依赖编号（申请单号）、媒体（收款二维码与付款截图）与资金（ADVERTISING_FEE 受控来源）
 * 三个领域；分摊人固定为申请人，客户端不能指定 userId、金额拆分或资金规则。
 */
@Module({
  imports: [PrismaModule, AuthModule, MediaModule, NumberingModule, FundAccountsModule],
  controllers: [AdvertisingRechargeController],
  providers: [
    AdvertisingRechargeService,
    AdvertisingRechargeQueryService,
    AdvertisingRechargeDocumentService,
  ],
})
export class AdvertisingRechargeModule {}
