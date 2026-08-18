import {
  Body,
  Controller,
  Get,
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
import { FundConfigurationCommandService } from './application/fund-configuration-command.service'
import type { FundConfigurationCommandContext } from './application/fund-configuration.contract'
import { FundConfigurationQueryService } from './application/fund-configuration-query.service'
import {
  ChangeFundConfigurationStatusRequestDto,
  CreateFundBusinessSourceRequestDto,
  FundBusinessSourceDto,
  FundBusinessSourceIdParamDto,
  FundBusinessSourceListQueryDto,
  FundBusinessSourceMutationResultDto,
  FundBusinessSourcePageDto,
  UpdateFundBusinessSourceRequestDto,
} from './dto/fund-configuration.dto'
import {
  FUND_READ_FORBIDDEN,
  FUND_VALIDATION_ERRORS,
  FUND_WRITE_FORBIDDEN,
} from './fund-http-contract'
import { executeFundHttpOperation } from './fund-http-error.mapper'

const SOURCE_NOT_FOUND = {
  status: 404,
  codes: ['FUND_BUSINESS_SOURCE_NOT_FOUND'],
} as const
const SOURCE_OR_TYPE_NOT_FOUND = {
  status: 404,
  codes: ['FUND_BUSINESS_SOURCE_NOT_FOUND', 'FUND_POSTING_TYPE_NOT_FOUND'],
} as const
const SOURCE_STATE_CONFLICT = {
  status: 409,
  codes: ['FUND_CONFIG_STATE_CHANGED'],
} as const

@ApiTags('fund-business-sources')
@Controller('fund-business-sources')
export class FundBusinessSourcesController {
  constructor(
    private readonly configurations: FundConfigurationQueryService,
    private readonly commands: FundConfigurationCommandService,
  ) {}

  @Get()
  @RequirePermissions('fund-business-sources:manage')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundBusinessSourcePageDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_business_sources_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  list(
    @Query() dto: FundBusinessSourceListQueryDto,
  ): Promise<FundBusinessSourcePageDto> {
    return executeFundHttpOperation(() => (
      this.configurations.listBusinessSources({ ...dto })
    ))
  }

  @Post()
  @RequirePermissions('fund-business-sources:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: FundBusinessSourceDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_business_sources_create',
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
      { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
      {
        status: 409,
        codes: ['FUND_BUSINESS_SOURCE_CODE_ALREADY_EXISTS'],
      },
      FUND_VALIDATION_ERRORS,
    ],
  })
  create(
    @Body() dto: CreateFundBusinessSourceRequestDto,
    @Req() request: object,
  ): Promise<FundBusinessSourceDto> {
    return executeFundHttpOperation(() => this.commands.createBusinessSource(
      this.commandContext(request),
      { ...dto, allowedPostingTypeIds: [...dto.allowedPostingTypeIds] },
    ))
  }

  @Patch(':businessSourceId')
  @RequirePermissions('fund-business-sources:manage')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundBusinessSourceMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_business_sources_update',
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
      SOURCE_OR_TYPE_NOT_FOUND,
      SOURCE_STATE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  update(
    @Param() params: FundBusinessSourceIdParamDto,
    @Body() dto: UpdateFundBusinessSourceRequestDto,
    @Req() request: object,
  ): Promise<FundBusinessSourceMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.updateBusinessSource(
      this.commandContext(request),
      {
        businessSourceId: params.businessSourceId,
        ...dto,
        allowedPostingTypeIds: [...dto.allowedPostingTypeIds],
      },
    ))
  }

  @Post(':businessSourceId/enable')
  @RequirePermissions('fund-business-sources:manage')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundBusinessSourceMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_business_sources_enable',
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
      SOURCE_NOT_FOUND,
      SOURCE_STATE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  enable(
    @Param() params: FundBusinessSourceIdParamDto,
    @Body() dto: ChangeFundConfigurationStatusRequestDto,
    @Req() request: object,
  ): Promise<FundBusinessSourceMutationResultDto> {
    return this.setEnabled(params.businessSourceId, true, dto, request)
  }

  @Post(':businessSourceId/disable')
  @RequirePermissions('fund-business-sources:manage')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundBusinessSourceMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_business_sources_disable',
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
      SOURCE_NOT_FOUND,
      SOURCE_STATE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  disable(
    @Param() params: FundBusinessSourceIdParamDto,
    @Body() dto: ChangeFundConfigurationStatusRequestDto,
    @Req() request: object,
  ): Promise<FundBusinessSourceMutationResultDto> {
    return this.setEnabled(params.businessSourceId, false, dto, request)
  }

  private setEnabled(
    businessSourceId: string,
    enabled: boolean,
    dto: ChangeFundConfigurationStatusRequestDto,
    request: object,
  ): Promise<FundBusinessSourceMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.setBusinessSourceEnabled(
      this.commandContext(request),
      { businessSourceId, enabled, expectedVersion: dto.expectedVersion },
    ))
  }

  private commandContext(request: object): FundConfigurationCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
