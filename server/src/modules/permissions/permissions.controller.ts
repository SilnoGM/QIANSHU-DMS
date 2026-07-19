import { Controller, Get, HttpStatus } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { PermissionDto } from './dto/permission.dto'
import { PermissionsService } from './permissions.service'

@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: [PermissionDto] })
  @ApiApplicationContract({
    operationId: 'permissions_list',
    session: 'required',
    authorization: true,
    privateNoStore: true,
  })
  list(): Promise<PermissionDto[]> {
    return this.permissions.list()
  }
}
