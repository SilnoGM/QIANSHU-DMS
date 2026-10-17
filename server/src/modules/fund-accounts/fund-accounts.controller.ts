import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { FundAccountCommandService } from './application/fund-account-command.service'
import type { FundAccountCommandContext } from './application/fund-account.contract'
import { FundAccountQueryService } from './application/fund-account-query.service'
import { FundPostingApplicationService } from './application/fund-posting.service'
import {
  CreateFundAccountRequestDto,
  CreateFundManualAdjustmentRequestDto,
  FundAccountDto,
  FundAccountIdParamDto,
  FundAccountListQueryDto,
  FundAccountMutationResultDto,
  FundAccountOwnerCandidateListDto,
  FundAccountPageDto,
  FundSelfAccountResponseDto,
  UpdateFundShareRateRequestDto,
} from './dto/fund-account.dto'
import { FundPostingResultDto } from './dto/fund-transaction.dto'
import {
  ApiFundIdempotencyKey,
  FUND_IDEMPOTENCY_HEADER_NAME,
  FUND_READ_FORBIDDEN,
  FUND_VALIDATION_ERRORS,
  FUND_WRITE_FORBIDDEN,
} from './fund-http-contract'
import { executeFundHttpOperation } from './fund-http-error.mapper'

@ApiTags('fund-accounts')
@Controller('fund-accounts')
export class FundAccountsController {
  constructor(
    private readonly accounts: FundAccountQueryService,
    private readonly commands: FundAccountCommandService,
    private readonly postings: FundPostingApplicationService,
  ) {}

  @Get()
  @RequirePermissions('fund-accounts:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: FundAccountPageDto })
  @ApiApplicationContract({
    operationId: 'fund_accounts_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  list(@Query() dto: FundAccountListQueryDto): Promise<FundAccountPageDto> {
    return executeFundHttpOperation(() => this.accounts.listAccounts({ ...dto }))
  }

  /*
   * 运营本人账户：身份只来自会话，不接受客户端传 userId/accountId。
   * 未开户返回 200 + account: null，由前端按空态处理。
   */
  @Get('me')
  @RequirePermissions('fund-accounts:read-self')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundSelfAccountResponseDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_accounts_get_self',
    session: 'required',
    authorization: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN],
  })
  getSelf(@Req() request: object): Promise<FundSelfAccountResponseDto> {
    return executeFundHttpOperation(() => (
      this.accounts.getOwnAccount(getRequestAuthContext(request).userId)
    ))
  }

  /*
   * 静态路由必须排在参数路由之前；本控制器当前只有精确路径，这里保持最近的顺序。
   * 该端点让财务角色在不持有 users:read 的前提下取得新建账户的候选归属人。
   */
  @Get('owner-candidates')
  @RequirePermissions('fund-accounts:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: FundAccountOwnerCandidateListDto })
  @ApiApplicationContract({
    operationId: 'fund_accounts_owner_candidates',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  ownerCandidates(): Promise<FundAccountOwnerCandidateListDto> {
    return executeFundHttpOperation(() => this.accounts.listOwnerCandidates())
  }

  @Post()
  @RequirePermissions('fund-accounts:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: FundAccountDto })
  @ApiApplicationContract({
    operationId: 'fund_accounts_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    retry: false,
    errors: [
      FUND_WRITE_FORBIDDEN,
      { status: 404, codes: ['FUND_USER_NOT_FOUND'] },
      { status: 409, codes: ['FUND_ACCOUNT_ALREADY_EXISTS'] },
      {
        status: 422,
        codes: [
          'FUND_SHARE_RATE_INVALID',
          'FUND_VALIDATION_FAILED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  create(
    @Body() dto: CreateFundAccountRequestDto,
    @Req() request: object,
  ): Promise<FundAccountDto> {
    return executeFundHttpOperation(() => this.commands.createUserAccount(
      this.commandContext(request),
      { ...dto },
    ))
  }

  @Patch(':accountId/share-rate')
  @RequirePermissions('fund-accounts:update-share-rate')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundAccountMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_accounts_update_share_rate',
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
      { status: 404, codes: ['FUND_ACCOUNT_NOT_FOUND'] },
      {
        status: 409,
        codes: ['FUND_ACCOUNT_STATE_CHANGED', 'FUND_ACCOUNT_UNAVAILABLE'],
      },
      {
        status: 422,
        codes: [
          'FUND_SHARE_RATE_INVALID',
          'FUND_VALIDATION_FAILED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  updateShareRate(
    @Param() params: FundAccountIdParamDto,
    @Body() dto: UpdateFundShareRateRequestDto,
    @Req() request: object,
  ): Promise<FundAccountMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.updateUserShareRate(
      this.commandContext(request),
      { accountId: params.accountId, ...dto },
    ))
  }

  @Post(':accountId/manual-adjustments')
  @RequirePermissions('fund-accounts:manual-adjust')
  @HttpCode(HttpStatus.OK)
  @ApiFundIdempotencyKey()
  @ApiContractResponse({ status: HttpStatus.OK, type: FundPostingResultDto })
  @ApiApplicationContract({
    operationId: 'fund_accounts_manual_adjust',
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
      {
        status: 404,
        codes: [
          'FUND_ACCOUNT_NOT_FOUND',
          'FUND_BUSINESS_SOURCE_NOT_FOUND',
          'FUND_POSTING_TYPE_NOT_FOUND',
        ],
      },
      {
        status: 409,
        codes: [
          'FUND_ACCOUNT_UNAVAILABLE',
          'FUND_BUSINESS_SOURCE_DISABLED',
          'FUND_COMPANY_ACCOUNT_UNAVAILABLE',
          'FUND_CONCURRENT_STATE_CHANGED',
          'FUND_IDEMPOTENCY_CONFLICT',
          'FUND_POSTING_RULE_UNAVAILABLE',
          'FUND_POSTING_TYPE_DISABLED',
          'FUND_POSTING_TYPE_NOT_ALLOWED',
        ],
      },
      {
        status: 422,
        codes: [
          'FUND_ADJUSTMENT_MODE_INVALID',
          'FUND_METADATA_INVALID',
          'FUND_POSTING_AMOUNT_INVALID',
          'FUND_POSTING_RULE_INVALID',
          'FUND_VALIDATION_FAILED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  manualAdjust(
    @Param() params: FundAccountIdParamDto,
    @Body() dto: CreateFundManualAdjustmentRequestDto,
    @Headers(FUND_IDEMPOTENCY_HEADER_NAME) idempotencyKey: string | undefined,
    @Req() request: object,
  ): Promise<FundPostingResultDto> {
    return executeFundHttpOperation(() => this.postings.postManualAdjustment(
      this.commandContext(request),
      {
        userAccountId: params.accountId,
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
