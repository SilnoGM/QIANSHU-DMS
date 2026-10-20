import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CurrentUserId, resolveDataScopeActor } from '../auth/decorators/current-user-id.decorator'
import type { FundAccountCommandContext } from './application/fund-account.contract'
import { FundPostingApplicationService } from './application/fund-posting.service'
import { FundTransactionQueryService } from './application/fund-transaction-query.service'
import {
  CreateFundReversalRequestDto,
  FundPostingBatchDetailDto,
  FundPostingBatchIdParamDto,
  FundPostingResultDto,
  FundSelfPostingTypeOptionListDto,
  FundSelfTransactionListQueryDto,
  FundSelfTransactionPageDto,
  FundTransactionListQueryDto,
  FundTransactionPageDto,
} from './dto/fund-transaction.dto'
import {
  ApiFundIdempotencyKey,
  FUND_IDEMPOTENCY_HEADER_NAME,
  FUND_READ_FORBIDDEN,
  FUND_VALIDATION_ERRORS,
  FUND_WRITE_FORBIDDEN,
} from './fund-http-contract'
import { executeFundHttpOperation } from './fund-http-error.mapper'

@ApiTags('fund-transactions', 'fund-posting-batches')
@Controller()
export class FundTransactionsController {
  constructor(
    private readonly transactions: FundTransactionQueryService,
    private readonly postings: FundPostingApplicationService,
  ) {}

  @Get('fund-transactions')
  @RequirePermissions('fund-accounts:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: FundTransactionPageDto })
  @ApiApplicationContract({
    operationId: 'fund_transactions_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  list(
    @Query() dto: FundTransactionListQueryDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<FundTransactionPageDto> {
    return executeFundHttpOperation(() => (
      this.transactions.listTransactions({ ...dto }, actorUserId)
    ))
  }

  /*
   * 运营本人流水：服务端按会话解析本人账户并强制 account_id 过滤，
   * 客户端不传也不可覆盖 userId/accountId；来源说明随行返回。
   */
  @Get('fund-transactions/me')
  @RequirePermissions('fund-accounts:read-self')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundSelfTransactionPageDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_transactions_list_self',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  listSelf(
    @Query() dto: FundSelfTransactionListQueryDto,
    @Req() request: object,
  ): Promise<FundSelfTransactionPageDto> {
    return executeFundHttpOperation(() => (
      this.transactions.listOwnTransactions(
        getRequestAuthContext(request).userId,
        { ...dto },
      )
    ))
  }

  /* 本人流水中实际出现过的业务类型，供运营端筛选下拉使用。 */
  @Get('fund-transactions/me/posting-types')
  @RequirePermissions('fund-accounts:read-self')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundSelfPostingTypeOptionListDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_transactions_self_posting_types',
    session: 'required',
    authorization: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN],
  })
  selfPostingTypes(
    @Req() request: object,
  ): Promise<FundSelfPostingTypeOptionListDto> {
    return executeFundHttpOperation(() => (
      this.transactions.listOwnPostingTypes(
        getRequestAuthContext(request).userId,
      )
    ))
  }

  @Get('fund-posting-batches/:batchId')
  @RequirePermissions('fund-accounts:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingBatchDetailDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_batches_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      FUND_READ_FORBIDDEN,
      { status: 404, codes: ['FUND_POSTING_BATCH_NOT_FOUND'] },
      FUND_VALIDATION_ERRORS,
    ],
  })
  getBatch(
    @Param() params: FundPostingBatchIdParamDto,
    @CurrentUserId() actorUserId: string = resolveDataScopeActor(),
  ): Promise<FundPostingBatchDetailDto> {
    return executeFundHttpOperation(() => (
      this.transactions.getBatchDetail(params.batchId, actorUserId)
    ))
  }

  @Post('fund-posting-batches/:batchId/reversals')
  @RequirePermissions('fund-transactions:reverse')
  @HttpCode(HttpStatus.OK)
  @ApiFundIdempotencyKey()
  @ApiContractResponse({ status: HttpStatus.OK, type: FundPostingResultDto })
  @ApiApplicationContract({
    operationId: 'fund_posting_batches_reverse',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    retry: false,
    errors: [
      FUND_WRITE_FORBIDDEN,
      { status: 404, codes: ['FUND_POSTING_BATCH_NOT_FOUND'] },
      {
        status: 409,
        codes: [
          'FUND_ACCOUNT_UNAVAILABLE',
          'FUND_CONCURRENT_STATE_CHANGED',
          'FUND_IDEMPOTENCY_CONFLICT',
          'FUND_POSTING_NUMBERING_UNAVAILABLE',
          'FUND_REVERSAL_REQUIRES_RECEIPT_VOID',
          'FUND_REVERSAL_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: [
          'FUND_POSTING_AMOUNT_INVALID',
          'FUND_REVERSAL_EXCEEDS_REMAINING',
          'FUND_REVERSAL_TARGET_INVALID',
          'FUND_VALIDATION_FAILED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  reverse(
    @Param() params: FundPostingBatchIdParamDto,
    @Body() dto: CreateFundReversalRequestDto,
    @Headers(FUND_IDEMPOTENCY_HEADER_NAME) idempotencyKey: string | undefined,
    @Req() request: object,
  ): Promise<FundPostingResultDto> {
    return executeFundHttpOperation(() => this.postings.reversePostingBatch(
      this.commandContext(request),
      {
        originalBatchId: params.batchId,
        ...dto,
        idempotencyKey: idempotencyKey as string,
      },
    ))
  }

  private commandContext(request: object): FundAccountCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
