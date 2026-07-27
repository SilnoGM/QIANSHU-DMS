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
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import {
  RegionCityIdParamDto,
  RegionOptionDto,
  RegionOptionsQueryDto,
  RegionPathDto,
  RegionSearchQueryDto,
  RegionSearchResponseDto,
} from './dto/region-selection.dto'
import { RegionQueryService } from './region-query.service'

/**
 * 业务地区选择只要求正常登录 Session；地区管理权限始终留在 `/regions` 边界。
 */
@ApiTags('region-selection')
@Controller('region-selection')
@RequireAuthenticatedSession()
export class RegionSelectionController {
  constructor(private readonly regions: RegionQueryService) {}

  @Get('options')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: [RegionOptionDto],
  })
  @ApiApplicationContract({
    operationId: 'region_selection_options_list',
    session: 'required',
    authorization: false,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
      {
        status: 422,
        codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  })
  options(
    @Query() query: RegionOptionsQueryDto,
  ): Promise<RegionOptionDto[]> {
    return this.regions.options(query)
  }

  @Get('search')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionSearchResponseDto,
  })
  @ApiApplicationContract({
    operationId: 'region_selection_search',
    session: 'required',
    authorization: false,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  search(
    @Query() query: RegionSearchQueryDto,
  ): Promise<RegionSearchResponseDto> {
    return this.regions.search(query)
  }

  @Get('paths/:cityId')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: RegionPathDto,
  })
  @ApiApplicationContract({
    operationId: 'region_selection_path_get',
    session: 'required',
    authorization: false,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['REGION_NOT_FOUND'] },
      {
        status: 422,
        codes: ['REGION_VALUE_NOT_CITY', 'VALIDATION_FAILED'],
      },
    ],
  })
  path(
    @Param() params: RegionCityIdParamDto,
  ): Promise<RegionPathDto> {
    return this.regions.path(params.cityId)
  }
}
