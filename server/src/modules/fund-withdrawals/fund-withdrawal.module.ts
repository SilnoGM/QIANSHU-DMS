import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { FundWithdrawalController } from './fund-withdrawal.controller'
import { FundWithdrawalDocumentService } from './fund-withdrawal-document.service'
import { FundWithdrawalQueryService } from './fund-withdrawal-query.service'
import { FundWithdrawalService } from './fund-withdrawal.service'

/**
 * 用户提款申请与财务审批。
 *
 * 依赖既有编号（申请单号）、媒体（付款截图暂存/激活/读取）和资金（USER_WITHDRAWAL
 * 受控来源）三个领域；申请人归属由服务端 session 与查询条件固定，客户端不传 userId。
 */
@Module({
  imports: [PrismaModule, AuthModule, MediaModule, NumberingModule, FundAccountsModule],
  controllers: [FundWithdrawalController],
  providers: [
    FundWithdrawalService,
    FundWithdrawalQueryService,
    FundWithdrawalDocumentService,
  ],
})
export class FundWithdrawalModule {}
