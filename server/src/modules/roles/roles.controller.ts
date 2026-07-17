import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { CreateRoleRequestDto } from './dto/create-role-request.dto'
import { ReplaceRolePermissionsRequestDto } from './dto/replace-role-permissions-request.dto'
import { RoleDto } from './dto/role.dto'
import { UpdateRoleRequestDto } from './dto/update-role-request.dto'
import { RolesService, type RolesCommandContext } from './roles.service'

const ROLE_ID_PIPE = new ParseUUIDPipe()

/** Role HTTP 边界不判断角色字符串；所有准入都由 Permission Guard 与 Service 复查完成。 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: [RoleDto] })
  @ApiApplicationContract({
    operationId: 'roles_list',
    session: 'required',
    authorization: true,
    privateNoStore: true,
  })
  list(): Promise<RoleDto[]> {
    return this.roles.list()
  }

  @Post()
  @RequirePermissions('roles:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: RoleDto })
  @ApiApplicationContract({
    operationId: 'roles_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 409, codes: ['ROLE_CODE_ALREADY_EXISTS'] },
    ],
  })
  create(
    @Body() dto: CreateRoleRequestDto,
    @Req() request: object,
  ): Promise<RoleDto> {
    return this.roles.create(this.commandContext(request), dto)
  }

  @Get(':roleId')
  @RequirePermissions('roles:read')
  @ApiParam({ name: 'roleId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: RoleDto })
  @ApiApplicationContract({
    operationId: 'roles_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    privateNoStore: true,
    errors: [{ status: 404, codes: ['ROLE_NOT_FOUND'] }],
  })
  getById(
    @Param('roleId', ROLE_ID_PIPE) roleId: string,
  ): Promise<RoleDto> {
    return this.roles.getById(roleId)
  }

  @Patch(':roleId')
  @RequirePermissions('roles:update')
  @ApiParam({ name: 'roleId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: RoleDto })
  @ApiApplicationContract({
    operationId: 'roles_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN'] },
      { status: 404, codes: ['ROLE_NOT_FOUND'] },
      { status: 409, codes: ['AUTH_STATE_CHANGED'] },
    ],
  })
  update(
    @Param('roleId', ROLE_ID_PIPE) roleId: string,
    @Body() dto: UpdateRoleRequestDto,
    @Req() request: object,
  ): Promise<RoleDto> {
    return this.roles.update(this.commandContext(request), roleId, dto)
  }

  @Put(':roleId/permissions')
  @RequirePermissions('roles:assign-permissions')
  @ApiParam({ name: 'roleId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: RoleDto })
  @ApiApplicationContract({
    operationId: 'roles_replace_permissions',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN'] },
      { status: 404, codes: ['PERMISSION_NOT_FOUND', 'ROLE_NOT_FOUND'] },
      { status: 409, codes: ['AUTH_STATE_CHANGED'] },
    ],
  })
  replacePermissions(
    @Param('roleId', ROLE_ID_PIPE) roleId: string,
    @Body() dto: ReplaceRolePermissionsRequestDto,
    @Req() request: object,
  ): Promise<RoleDto> {
    return this.roles.replacePermissions(
      this.commandContext(request),
      roleId,
      dto,
    )
  }

  private commandContext(request: object): RolesCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
