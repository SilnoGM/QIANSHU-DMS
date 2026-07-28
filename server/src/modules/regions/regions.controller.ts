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
import { EmptyRequestDto } from '../auth/dto/empty-request.dto'
import {
  CreateRegionRequestDto,
  UpdateRegionRequestDto,
} from './dto/region-command.dto'
import {
  RegionIdParamDto,
  RegionListQueryDto,
  RegionNavigationNodeDto,
} from './dto/region-management.dto'
import {
  RegionDto,
  RegionMutationResultDto,
  RegionPageDto,
} from './dto/region.dto'
import {
  RegionCommandService,
  type RegionsCommandContext,
} from './region-command.service'
import { RegionQueryService } from './region-query.service'

/**
 * 地区管理读取边界。
 *
 * 每个 handler 独立声明 `regions:read`，避免后续写接口错误继承 class-level
 * Session 或读取权限；静态 `navigation` 必须位于动态 `:regionId` 之前。
 */
@ApiTags('regions')
@Controller('regions')
export class RegionsController {
  constructor(
    private readonly regions: RegionQueryService,
    private readonly commands: RegionCommandService,
  ) {}

  @Get('navigation')
  @RequirePermissions('regions:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: [RegionNavigationNodeDto],
  })
  @ApiApplicationContract({
    operationId: 'regions_navigation_list',
    session: 'required',
    authorization: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
    ],
  })
  navigation(): Promise<RegionNavigationNodeDto[]> {
    return this.regions.navigation()
  }

  @Get()
  @RequirePermissions('regions:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionPageDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
      {
        status: 422,
        codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  })
  list(@Query() query: RegionListQueryDto): Promise<RegionPageDto> {
    return this.regions.list(query)
  }

  @Post()
  @RequirePermissions('regions:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: RegionDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
      {
        status: 409,
        codes: [
          'REGION_CODE_ALREADY_EXISTS',
          'REGION_NAME_ALREADY_EXISTS',
          'REGION_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  })
  create(
    @Body() dto: CreateRegionRequestDto,
    @Req() request: object,
  ): Promise<RegionDto> {
    return this.commands.create(this.commandContext(request), dto)
  }

  @Post(':regionId/enable')
  @RequirePermissions('regions:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_enable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      { status: 404, codes: ['REGION_NOT_FOUND'] },
      { status: 409, codes: ['REGION_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  enable(
    @Param() params: RegionIdParamDto,
    @Body() _dto: EmptyRequestDto,
    @Req() request: object,
  ): Promise<RegionMutationResultDto> {
    return this.commands.enable(
      this.commandContext(request),
      params.regionId,
    )
  }

  @Post(':regionId/disable')
  @RequirePermissions('regions:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionMutationResultDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_disable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      { status: 404, codes: ['REGION_NOT_FOUND'] },
      { status: 409, codes: ['REGION_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  disable(
    @Param() params: RegionIdParamDto,
    @Body() _dto: EmptyRequestDto,
    @Req() request: object,
  ): Promise<RegionMutationResultDto> {
    return this.commands.disable(
      this.commandContext(request),
      params.regionId,
    )
  }

  @Get(':regionId')
  @RequirePermissions('regions:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
      },
      { status: 404, codes: ['REGION_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getById(@Param() params: RegionIdParamDto): Promise<RegionDto> {
    return this.regions.getById(params.regionId)
  }

  @Patch(':regionId')
  @RequirePermissions('regions:update')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionDto,
  })
  @ApiApplicationContract({
    operationId: 'regions_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: [
          'CSRF_REJECTED',
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
        ],
      },
      { status: 404, codes: ['REGION_NOT_FOUND'] },
      {
        status: 409,
        codes: ['REGION_NAME_ALREADY_EXISTS', 'REGION_STATE_CHANGED'],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  update(
    @Param() params: RegionIdParamDto,
    @Body() dto: UpdateRegionRequestDto,
    @Req() request: object,
  ): Promise<RegionDto> {
    return this.commands.update(
      this.commandContext(request),
      params.regionId,
      dto,
    )
  }

  private commandContext(request: object): RegionsCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
