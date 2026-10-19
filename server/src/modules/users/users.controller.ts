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
  Query,
  Req,
} from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { EmptyRequestDto } from '../auth/dto/empty-request.dto'
import { CreateUserRequestDto } from './dto/create-user-request.dto'
import { PasswordResetRequestDto } from './dto/password-reset-request.dto'
import { ReplaceUserRolesRequestDto } from './dto/replace-user-roles-request.dto'
import { UpdateUserRequestDto } from './dto/update-user-request.dto'
import { UserListQueryDto } from './dto/user-list-query.dto'
import { UserDto, UserPageDto } from './dto/user-response.dto'
import { UsersService, type UsersCommandContext } from './users.service'

const USER_ID_PIPE = new ParseUUIDPipe()

/** User 管理 HTTP 边界只负责权限声明、DTO、路径标识和可信操作者上下文。 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: UserPageDto })
  @ApiApplicationContract({
    operationId: 'users_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
  })
  list(@Query() query: UserListQueryDto): Promise<UserPageDto> {
    return this.users.list(query)
  }

  @Post()
  @RequirePermissions('users:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({ status: HttpStatus.CREATED, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN'] },
      { status: 409, codes: ['USERNAME_ALREADY_EXISTS'] },
      {
        status: 422,
        codes: ['FUND_SHARE_RATE_INVALID', 'PASSWORD_POLICY_VIOLATION'],
      },
      { status: 503, codes: ['AUTH_CAPACITY_UNAVAILABLE'] },
    ],
  })
  create(
    @Body() dto: CreateUserRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.create(this.commandContext(request), dto)
  }

  @Get(':userId')
  @RequirePermissions('users:read')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    privateNoStore: true,
    errors: [{ status: 404, codes: ['USER_NOT_FOUND'] }],
  })
  getById(
    @Param('userId', USER_ID_PIPE) userId: string,
  ): Promise<UserDto> {
    return this.users.getById(userId)
  }

  @Patch(':userId')
  @RequirePermissions('users:update')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 404, codes: ['USER_NOT_FOUND'] },
      {
        status: 409,
        codes: ['EMAIL_ALREADY_EXISTS', 'MOBILE_ALREADY_EXISTS'],
      },
    ],
  })
  update(
    @Param('userId', USER_ID_PIPE) userId: string,
    @Body() dto: UpdateUserRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.update(
      this.commandContext(request),
      userId,
      dto,
    )
  }

  @Post(':userId/enable')
  @RequirePermissions('users:enable')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_enable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [{ status: 404, codes: ['USER_NOT_FOUND'] }],
  })
  enable(
    @Param('userId', USER_ID_PIPE) userId: string,
    @Body() _dto: EmptyRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.enable(this.commandContext(request), userId)
  }

  @Post(':userId/disable')
  @RequirePermissions('users:disable')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_disable',
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
      { status: 404, codes: ['USER_NOT_FOUND'] },
      { status: 409, codes: ['LAST_SYSTEM_ADMIN_REQUIRED'] },
    ],
  })
  disable(
    @Param('userId', USER_ID_PIPE) userId: string,
    @Body() _dto: EmptyRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.disable(this.commandContext(request), userId)
  }

  @Put(':userId/roles')
  @RequirePermissions('users:assign-roles')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_replace_roles',
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
      { status: 404, codes: ['ROLE_NOT_FOUND', 'USER_NOT_FOUND'] },
      {
        status: 409,
        codes: ['AUTH_STATE_CHANGED', 'LAST_SYSTEM_ADMIN_REQUIRED'],
      },
    ],
  })
  replaceRoles(
    @Param('userId', USER_ID_PIPE) userId: string,
    @Body() dto: ReplaceUserRolesRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.replaceRoles(this.commandContext(request), userId, dto)
  }

  @Post(':userId/password-reset')
  @RequirePermissions('users:reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiContractResponse({ status: HttpStatus.OK, type: UserDto })
  @ApiApplicationContract({
    operationId: 'users_reset_password',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 404, codes: ['USER_NOT_FOUND'] },
      {
        status: 409,
        codes: ['AUTH_STATE_CHANGED', 'SELF_PASSWORD_RESET_NOT_ALLOWED'],
      },
      { status: 422, codes: ['PASSWORD_POLICY_VIOLATION'] },
      { status: 503, codes: ['AUTH_CAPACITY_UNAVAILABLE'] },
    ],
  })
  resetPassword(
    @Param('userId', USER_ID_PIPE) userId: string,
    @Body() dto: PasswordResetRequestDto,
    @Req() request: object,
  ): Promise<UserDto> {
    return this.users.resetPassword(
      this.commandContext(request),
      userId,
      dto,
    )
  }

  private commandContext(request: object): UsersCommandContext {
    const auth = getRequestAuthContext(request)
    return {
      actorUserId: auth.userId,
      actorSessionId: auth.sessionId,
      requestId: getRequestId(request),
    }
  }
}
