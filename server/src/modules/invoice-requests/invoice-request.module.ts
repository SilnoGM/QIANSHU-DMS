import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { FundAccountsModule } from '../fund-accounts/fund-accounts.module'
import { MediaModule } from '../media/media.module'
import { NumberingModule } from '../numbering/numbering.module'
import { InvoiceRequestController } from './invoice-request.controller'
import { InvoiceRequestDocumentService } from './invoice-request-document.service'
import { InvoiceRequestQueryService } from './invoice-request-query.service'
import { InvoiceRequestService } from './invoice-request.service'

/**
 * 开票申请与审批模块。
 *
 * 依赖都来自既有域：编号（申请单号）、媒体（发票照片的暂存、激活与读取）、
 * 资金（结算入账的受控来源 INVOICE_REQUEST → 既有 INVOICE_FEE 类型）。
 * 权限判定分两层：路由用 `@RequirePermissions` 收敛动作，行级归属（运营仅本人、
 * 财务可跨提交人）由服务层按 `invoice-requests:read-all` 解析，见 invoice-request-access.ts。
 */
@Module({
  imports: [PrismaModule, AuthModule, MediaModule, NumberingModule, FundAccountsModule],
  controllers: [InvoiceRequestController],
  providers: [InvoiceRequestService, InvoiceRequestQueryService, InvoiceRequestDocumentService],
})
export class InvoiceRequestModule {}
