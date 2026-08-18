import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
  CreateFundPostingTypeRequestDto,
  FundPostingTypeDto,
  FundPostingTypeIdParamDto,
  FundPostingTypeListQueryDto,
  FundPostingTypeMutationResultDto,
  FundPostingTypePageDto,
  PublishFundPostingRuleRequestDto,
  ReplaceFundDraftRuleRequestDto,
  UpdateFundPostingTypeRequestDto,
} from './dto/fund-configuration.dto'
import {
  FUND_READ_FORBIDDEN,
  FUND_VALIDATION_ERRORS,
  FUND_WRITE_FORBIDDEN,
} from './fund-http-contract'
import { executeFundHttpOperation } from './fund-http-error.mapper'

const TYPE_NOT_FOUND = {
  status: 404,
  codes: ['FUND_POSTING_TYPE_NOT_FOUND'],
} as const
const TYPE_STATE_CONFLICT = {
  status: 409,
  codes: ['FUND_CONFIG_STATE_CHANGED'],
} as const
const TYPE_RULE_CONFLICT = {
  status: 409,
  codes: ['FUND_CONFIG_STATE_CHANGED', 'FUND_POSTING_RULE_UNAVAILABLE'],
} as const
const TYPE_RULE_VALIDATION = {
  status: 422,
  codes: [
    'FUND_POSTING_RULE_INVALID',
    'FUND_VALIDATION_FAILED',
    'VALIDATION_FAILED',
  ],
} as const

@ApiTags('fund-posting-types')
@Controller('fund-posting-types')
export class FundPostingTypesController {
  constructor(
    private readonly configurations: FundConfigurationQueryService,
    private readonly commands: FundConfigurationCommandService,
  ) {}

  @Get()
  @RequirePermissions('fund-posting-types:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: FundPostingTypePageDto })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [FUND_READ_FORBIDDEN, FUND_VALIDATION_ERRORS],
  })
  list(
    @Query() dto: FundPostingTypeListQueryDto,
  ): Promise<FundPostingTypePageDto> {
    return executeFundHttpOperation(() => (
      this.configurations.listPostingTypes({ ...dto })
    ))
  }

  @Post()
  @RequirePermissions('fund-posting-types:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: FundPostingTypeDto })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_create',
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
      {
        status: 409,
        codes: ['FUND_POSTING_TYPE_CODE_ALREADY_EXISTS'],
      },
      TYPE_RULE_VALIDATION,
    ],
  })
  create(
    @Body() dto: CreateFundPostingTypeRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeDto> {
    return executeFundHttpOperation(() => this.commands.createPostingType(
      this.commandContext(request),
      {
        ...dto,
        legs: dto.legs.map(leg => ({ ...leg })),
      },
    ))
  }

  @Patch(':postingTypeId')
  @RequirePermissions('fund-posting-types:manage')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingTypeMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_update',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  update(
    @Param() params: FundPostingTypeIdParamDto,
    @Body() dto: UpdateFundPostingTypeRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.updatePostingType(
      this.commandContext(request),
      { postingTypeId: params.postingTypeId, ...dto },
    ))
  }

  @Put(':postingTypeId/draft-rule')
  @RequirePermissions('fund-posting-types:manage')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingTypeMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_replace_draft_rule',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CONFLICT,
      TYPE_RULE_VALIDATION,
    ],
  })
  replaceDraftRule(
    @Param() params: FundPostingTypeIdParamDto,
    @Body() dto: ReplaceFundDraftRuleRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.replaceDraftRule(
      this.commandContext(request),
      {
        postingTypeId: params.postingTypeId,
        expectedVersion: dto.expectedVersion,
        legs: dto.legs.map(leg => ({ ...leg })),
      },
    ))
  }

  @Post(':postingTypeId/publish')
  @RequirePermissions('fund-posting-types:manage')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingTypeMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_publish',
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
      TYPE_NOT_FOUND,
      TYPE_RULE_CONFLICT,
      TYPE_RULE_VALIDATION,
    ],
  })
  publish(
    @Param() params: FundPostingTypeIdParamDto,
    @Body() dto: PublishFundPostingRuleRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.publishDraftRule(
      this.commandContext(request),
      { postingTypeId: params.postingTypeId, ...dto },
    ))
  }

  @Post(':postingTypeId/enable')
  @RequirePermissions('fund-posting-types:manage')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingTypeMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_enable',
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
      TYPE_NOT_FOUND,
      TYPE_RULE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  enable(
    @Param() params: FundPostingTypeIdParamDto,
    @Body() dto: ChangeFundConfigurationStatusRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return this.setEnabled(params.postingTypeId, true, dto, request)
  }

  @Post(':postingTypeId/disable')
  @RequirePermissions('fund-posting-types:manage')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: FundPostingTypeMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'fund_posting_types_disable',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CONFLICT,
      FUND_VALIDATION_ERRORS,
    ],
  })
  disable(
    @Param() params: FundPostingTypeIdParamDto,
    @Body() dto: ChangeFundConfigurationStatusRequestDto,
    @Req() request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return this.setEnabled(params.postingTypeId, false, dto, request)
  }

  private setEnabled(
    postingTypeId: string,
    enabled: boolean,
    dto: ChangeFundConfigurationStatusRequestDto,
    request: object,
  ): Promise<FundPostingTypeMutationResultDto> {
    return executeFundHttpOperation(() => this.commands.setPostingTypeEnabled(
      this.commandContext(request),
      { postingTypeId, enabled, expectedVersion: dto.expectedVersion },
    ))
  }

  private commandContext(request: object): FundConfigurationCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
