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
import {
  ChangeNumberingRuleStatusRequestDto,
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  PreviewNumberingRuleRequestDto,
  PublishNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from './dto/numbering-command.dto'
import {
  NumberingIssuanceListQueryDto,
  NumberingRuleIdParamDto,
  NumberingRuleListQueryDto,
  NumberingRuleVersionListQueryDto,
} from './dto/numbering-management.dto'
import {
  NumberingIssuancePageDto,
  NumberingRuleDetailDto,
  NumberingRulePageDto,
  NumberingRuleVersionPageDto,
  PreviewNumberingRuleResponseDto,
} from './dto/numbering-response.dto'
import {
  NumberingCommandService,
  type NumberingCommandContext,
} from './numbering-command.service'
import { NumberingQueryService } from './numbering-query.service'

const READ_FORBIDDEN = {
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const WRITE_FORBIDDEN = {
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const RULE_NOT_FOUND = {
  status: 404,
  codes: ['NUMBERING_RULE_NOT_FOUND'],
} as const
const VALIDATION_FAILED = {
  status: 422,
  codes: ['VALIDATION_FAILED'],
} as const
const CONFIG_OR_VALIDATION_FAILED = {
  status: 422,
  codes: ['NUMBERING_RULE_CONFIG_INVALID', 'VALIDATION_FAILED'],
} as const
const RULE_STATE_CHANGED = {
  status: 409,
  codes: ['NUMBERING_RULE_STATE_CHANGED'],
} as const
const RULE_STATE_OR_UNAVAILABLE = {
  status: 409,
  codes: ['NUMBERING_RULE_STATE_CHANGED', 'NUMBERING_RULE_UNAVAILABLE'],
} as const
const RULE_CODE_OR_STATE_CONFLICT = {
  status: 409,
  codes: [
    'NUMBERING_RULE_CODE_ALREADY_EXISTS',
    'NUMBERING_RULE_STATE_CHANGED',
  ],
} as const
const RULE_CODE_STATE_OR_UNAVAILABLE = {
  status: 409,
  codes: [
    'NUMBERING_RULE_CODE_ALREADY_EXISTS',
    'NUMBERING_RULE_STATE_CHANGED',
    'NUMBERING_RULE_UNAVAILABLE',
  ],
} as const

/**
 * 编号管理 HTTP 边界只做 DTO、权限和可信请求上下文编排。正式发号服务不注入
 * Controller，因此不存在可被外部调用的 generate 路由。
 */
@ApiTags('numbering-rules')
@Controller('numbering-rules')
export class NumberingController {
  constructor(
    private readonly query: NumberingQueryService,
    private readonly command: NumberingCommandService,
  ) {}

  @Get()
  @RequirePermissions('numbering-rules:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRulePageDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, VALIDATION_FAILED],
  })
  list(@Query() dto: NumberingRuleListQueryDto): Promise<NumberingRulePageDto> {
    return this.query.list(dto)
  }

  @Post('preview')
  @RequirePermissions('numbering-rules:read')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: PreviewNumberingRuleResponseDto,
  })
  @ApiApplicationContract({
    operationId: 'numbering_rules_preview',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      CONFIG_OR_VALIDATION_FAILED,
    ],
  })
  preview(
    @Body() dto: PreviewNumberingRuleRequestDto,
  ): Promise<PreviewNumberingRuleResponseDto> {
    return this.query.preview(dto)
  }

  @Post()
  @RequirePermissions('numbering-rules:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: NumberingRuleDetailDto,
  })
  @ApiApplicationContract({
    operationId: 'numbering_rules_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_CODE_OR_STATE_CONFLICT,
      CONFIG_OR_VALIDATION_FAILED,
    ],
  })
  create(
    @Body() dto: CreateNumberingRuleRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.create(this.commandContext(request), dto)
  }

  @Get(':ruleId')
  @RequirePermissions('numbering-rules:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRuleDetailDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_get',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, RULE_NOT_FOUND, VALIDATION_FAILED],
  })
  getDetail(
    @Param() params: NumberingRuleIdParamDto,
  ): Promise<NumberingRuleDetailDto> {
    return this.query.getDetail(params.ruleId)
  }

  @Patch(':ruleId')
  @RequirePermissions('numbering-rules:update')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRuleDetailDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      RULE_STATE_CHANGED,
      CONFIG_OR_VALIDATION_FAILED,
    ],
  })
  update(
    @Param() params: NumberingRuleIdParamDto,
    @Body() dto: UpdateNumberingRuleRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.update(
      this.commandContext(request),
      params.ruleId,
      dto,
    )
  }

  @Get(':ruleId/versions')
  @RequirePermissions('numbering-rules:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: NumberingRuleVersionPageDto,
  })
  @ApiApplicationContract({
    operationId: 'numbering_rule_versions_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, RULE_NOT_FOUND, VALIDATION_FAILED],
  })
  listVersions(
    @Param() params: NumberingRuleIdParamDto,
    @Query() dto: NumberingRuleVersionListQueryDto,
  ): Promise<NumberingRuleVersionPageDto> {
    return this.query.listVersions(params.ruleId, dto)
  }

  @Post(':ruleId/publish')
  @RequirePermissions('numbering-rules:publish')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRuleDetailDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_publish',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      RULE_STATE_OR_UNAVAILABLE,
      CONFIG_OR_VALIDATION_FAILED,
    ],
  })
  publish(
    @Param() params: NumberingRuleIdParamDto,
    @Body() dto: PublishNumberingRuleRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.publish(
      this.commandContext(request),
      params.ruleId,
      dto,
    )
  }

  @Post(':ruleId/enable')
  @RequirePermissions('numbering-rules:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRuleDetailDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_enable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      RULE_STATE_OR_UNAVAILABLE,
      VALIDATION_FAILED,
    ],
  })
  enable(
    @Param() params: NumberingRuleIdParamDto,
    @Body() dto: ChangeNumberingRuleStatusRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.enable(
      this.commandContext(request),
      params.ruleId,
      dto,
    )
  }

  @Post(':ruleId/disable')
  @RequirePermissions('numbering-rules:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: NumberingRuleDetailDto })
  @ApiApplicationContract({
    operationId: 'numbering_rules_disable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      RULE_STATE_OR_UNAVAILABLE,
      VALIDATION_FAILED,
    ],
  })
  disable(
    @Param() params: NumberingRuleIdParamDto,
    @Body() dto: ChangeNumberingRuleStatusRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.disable(
      this.commandContext(request),
      params.ruleId,
      dto,
    )
  }

  @Post(':ruleId/clone')
  @RequirePermissions('numbering-rules:read', 'numbering-rules:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: NumberingRuleDetailDto,
  })
  @ApiApplicationContract({
    operationId: 'numbering_rules_clone',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      RULE_NOT_FOUND,
      RULE_CODE_STATE_OR_UNAVAILABLE,
      VALIDATION_FAILED,
    ],
  })
  clone(
    @Param() params: NumberingRuleIdParamDto,
    @Body() dto: CloneNumberingRuleRequestDto,
    @Req() request: object,
  ): Promise<NumberingRuleDetailDto> {
    return this.command.clone(
      this.commandContext(request),
      params.ruleId,
      dto,
    )
  }

  @Get(':ruleId/issuances')
  @RequirePermissions(
    'numbering-rules:read',
    'numbering-rules:read-issuances',
  )
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: NumberingIssuancePageDto,
  })
  @ApiApplicationContract({
    operationId: 'numbering_rule_issuances_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, RULE_NOT_FOUND, VALIDATION_FAILED],
  })
  listIssuances(
    @Param() params: NumberingRuleIdParamDto,
    @Query() dto: NumberingIssuanceListQueryDto,
  ): Promise<NumberingIssuancePageDto> {
    return this.query.listIssuances(params.ruleId, dto)
  }

  private commandContext(request: object): NumberingCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
