import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  RegionIdParamDto,
  RegionListQueryDto,
  RegionNavigationNodeDto,
} from './dto/region-management.dto'
import { RegionDto, RegionPageDto } from './dto/region.dto'
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
  constructor(private readonly regions: RegionQueryService) {}

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
}
