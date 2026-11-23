import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { EmptyRequestDto } from '../auth/dto/empty-request.dto'
import {
  AdAccountAssignmentResultDto,
  AdAccountBalanceAlertSummaryDto,
  AdAccountReleaseResultDto,
  AdAccountAssigneeDto,
  AdAccountListDto,
  AssignableUsersQueryDto,
  AssignAdAccountRequestDto,
  SyncAdAccountsResultDto,
} from './ad-account.dto'
import { AdAccountCommandService } from './ad-account-command.service'
import { AdAccountQueryService } from './ad-account-query.service'
import { AdAccountSyncService } from './ad-account-sync.service'
import {
  adAccountSyncInProgress,
  adAccountVendorDisabled,
} from './ad-account.errors'

const AD_ACCOUNT_ID_PIPE = new ParseUUIDPipe()

function contract(
  operationId: string,
  mutation = false,
  errors: ApiContractErrorOptions[] = [],
) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
          ...(mutation ? ['CSRF_REJECTED'] : []),
        ],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

@ApiTags('ad-accounts')
@Controller('ad-accounts')
export class AdAccountController {
  constructor(
    private readonly queries: AdAccountQueryService,
    private readonly commands: AdAccountCommandService,
    private readonly sync: AdAccountSyncService,
  ) {}

  @Get('mine')
  @RequirePermissions('ad-accounts:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountListDto })
  @contract('ad_accounts_list_mine')
  mine(@Req() request: object): Promise<AdAccountListDto> {
    return this.queries.listMine(getRequestAuthContext(request).userId)
  }

  @Get('mine/alert-summary')
  @RequirePermissions('ad-accounts:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountBalanceAlertSummaryDto })
  @contract('ad_accounts_alert_summary_mine')
  mineAlertSummary(@Req() request: object): Promise<AdAccountBalanceAlertSummaryDto> {
    return this.queries.balanceAlertSummary(getRequestAuthContext(request).userId)
  }

  @Get('alert-summary')
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountBalanceAlertSummaryDto })
  @contract('ad_accounts_alert_summary')
  alertSummary(@Req() request: object): Promise<AdAccountBalanceAlertSummaryDto> {
    return this.queries.balanceAlertSummary(getRequestAuthContext(request).userId)
  }

  @Get('assignable-users')
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: [AdAccountAssigneeDto] })
  @contract('ad_accounts_list_assignable_users')
  assignableUsers(@Query() query: AssignableUsersQueryDto): Promise<AdAccountAssigneeDto[]> {
    return this.queries.assignableUsers(query.keyword)
  }

  @Get()
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountListDto })
  @contract('ad_accounts_list')
  list(): Promise<AdAccountListDto> {
    return this.queries.listAll()
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: SyncAdAccountsResultDto })
  @contract('ad_accounts_sync', true, [
    { status: 409, codes: ['AD_ACCOUNT_SYNC_IN_PROGRESS', 'AD_ACCOUNT_VENDOR_DISABLED'] },
  ])
  async runSync(): Promise<SyncAdAccountsResultDto> {
    const result = await this.sync.sync()

    if (result.status === 'skipped') {
      if (result.reason === 'disabled') {
        adAccountVendorDisabled()
      }

      adAccountSyncInProgress()
    }

    return result
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountAssignmentResultDto })
  @contract('ad_accounts_assign', true, [
    { status: 404, codes: ['AD_ACCOUNT_NOT_FOUND'] },
    { status: 409, codes: ['AD_ACCOUNT_ALREADY_ASSIGNED', 'AD_ACCOUNT_STATE_CHANGED'] },
    { status: 422, codes: ['AD_ACCOUNT_ASSIGNEE_INVALID'] },
  ])
  assign(
    @Param('id', AD_ACCOUNT_ID_PIPE) id: string,
    @Body() input: AssignAdAccountRequestDto,
    @Req() request: object,
  ): Promise<AdAccountAssignmentResultDto> {
    return this.commands.assign(id, input, {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    })
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('ad-accounts:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: AdAccountReleaseResultDto })
  @contract('ad_accounts_release', true, [
    { status: 404, codes: ['AD_ACCOUNT_NOT_FOUND'] },
    { status: 409, codes: ['AD_ACCOUNT_NOT_ASSIGNED', 'AD_ACCOUNT_STATE_CHANGED'] },
  ])
  release(
    @Param('id', AD_ACCOUNT_ID_PIPE) id: string,
    @Body() _input: EmptyRequestDto,
    @Req() request: object,
  ): Promise<AdAccountReleaseResultDto> {
    return this.commands.release(id, {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    })
  }
}
