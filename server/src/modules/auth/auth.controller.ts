import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiException } from '../../infrastructure/http/api.exception'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import {
  getOptionalRequestAuthContext,
  getRequestAuthContext,
} from './auth-context'
import { AuthContextService } from './auth-context.service'
import { AuthService } from './auth.service'
import {
  AllowPasswordChangeRequired,
  OptionalSession,
  Public,
} from './decorators/auth.decorators'
import { AuthContextDto } from './dto/auth-context.dto'
import { ChangePasswordRequestDto } from './dto/change-password-request.dto'
import { EmptyRequestDto } from './dto/empty-request.dto'
import { LoginRequestDto } from './dto/login-request.dto'
import { LogoutService } from './logout.service'
import { PasswordChangeService } from './password-change.service'
import {
  SessionCookieProvider,
  type SessionCookie,
} from './providers/session-cookie.provider'

type AuthHttpRequest = object & {
  headers?: { cookie?: unknown }
  ip?: unknown
  socket?: { remoteAddress?: unknown }
}

type CookieResponse = {
  cookie(
    name: string,
    value: string,
    options: SessionCookie['options'],
  ): unknown
}

function readSourceIp(request: AuthHttpRequest): string {
  let requestIp: unknown
  let socketIp: unknown

  try {
    requestIp = request.ip
    socketIp = request.socket?.remoteAddress
  } catch {
    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      '服务器内部错误',
    )
  }

  if (typeof requestIp === 'string' && requestIp.length > 0) {
    return requestIp
  }
  if (typeof socketIp === 'string' && socketIp.length > 0) {
    return socketIp
  }

  throw new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

/** Auth HTTP 边界只负责可信请求上下文、Cookie 与 DTO；密码和事务逻辑留在 Service。 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordChange: PasswordChangeService,
    private readonly logoutService: LogoutService,
    private readonly authContext: AuthContextService,
    private readonly cookieProvider: SessionCookieProvider,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: AuthContextDto })
  @ApiApplicationContract({
    operationId: 'auth_login',
    session: 'none',
    csrf: true,
    privateNoStore: true,
    badRequest: true,
    validation: true,
    errors: [
      { status: 401, codes: ['INVALID_CREDENTIALS'] },
      {
        status: 409,
        codes: ['ALREADY_AUTHENTICATED', 'AUTH_STATE_CHANGED'],
      },
      { status: 429, codes: ['AUTH_RATE_LIMITED'] },
      {
        status: 503,
        codes: ['AUTH_CAPACITY_UNAVAILABLE', 'AUTH_SERVICE_UNAVAILABLE'],
      },
    ],
  })
  async login(
    @Body() dto: LoginRequestDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AuthContextDto> {
    const existingSessionToken = this.cookieProvider.readValue(
      request.headers?.cookie,
    )
    const result = await this.auth.login({
      username: dto.username,
      password: dto.password,
      sourceIp: readSourceIp(request),
      requestId: getRequestId(request),
      existingSessionToken: existingSessionToken ?? undefined,
    })

    this.setCookie(response, this.cookieProvider.create(
      result.issuedSession.tokenValue,
      result.issuedSession.session.absoluteExpiresAt,
    ))
    return this.authContext.fromMutationResult(result)
  }

  @Get('me')
  @AllowPasswordChangeRequired()
  @ApiContractResponse({ status: HttpStatus.OK, type: AuthContextDto })
  @ApiApplicationContract({
    operationId: 'auth_me',
    session: 'required',
    privateNoStore: true,
    errors: [
      { status: 503, codes: ['AUTH_SERVICE_UNAVAILABLE'] },
    ],
  })
  me(@Req() request: AuthHttpRequest): Promise<AuthContextDto> {
    return this.authContext.get(getRequestAuthContext(request))
  }

  @Post('password/change')
  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: AuthContextDto })
  @ApiApplicationContract({
    operationId: 'auth_password_change',
    session: 'required',
    csrf: true,
    privateNoStore: true,
    badRequest: true,
    validation: true,
    errors: [
      { status: 409, codes: ['AUTH_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'CURRENT_PASSWORD_INVALID',
          'PASSWORD_MUST_DIFFER',
          'PASSWORD_POLICY_VIOLATION',
        ],
      },
      { status: 429, codes: ['AUTH_RATE_LIMITED'] },
      {
        status: 503,
        codes: ['AUTH_CAPACITY_UNAVAILABLE', 'AUTH_SERVICE_UNAVAILABLE'],
      },
    ],
  })
  async changePassword(
    @Body() dto: ChangePasswordRequestDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<AuthContextDto> {
    const result = await this.passwordChange.change({
      auth: getRequestAuthContext(request),
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
      sourceIp: readSourceIp(request),
      requestId: getRequestId(request),
    })

    this.setCookie(response, this.cookieProvider.create(
      result.issuedSession.tokenValue,
      result.issuedSession.session.absoluteExpiresAt,
    ))
    return this.authContext.fromMutationResult(result)
  }

  @Post('logout')
  @OptionalSession()
  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiContractResponse({ status: HttpStatus.NO_CONTENT })
  @ApiApplicationContract({
    operationId: 'auth_logout',
    session: 'optional',
    csrf: true,
    privateNoStore: true,
    badRequest: true,
    errors: [
      { status: 503, codes: ['AUTH_SERVICE_UNAVAILABLE'] },
    ],
  })
  async logout(
    @Body() _dto: EmptyRequestDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.logoutService.logout({
      auth: getOptionalRequestAuthContext(request),
      sourceIp: readSourceIp(request),
      requestId: getRequestId(request),
    })
    this.setCookie(response, this.cookieProvider.clear())
  }

  @Post('logout-all')
  @AllowPasswordChangeRequired()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiContractResponse({ status: HttpStatus.NO_CONTENT })
  @ApiApplicationContract({
    operationId: 'auth_logout_all',
    session: 'required',
    csrf: true,
    privateNoStore: true,
    badRequest: true,
    errors: [
      { status: 409, codes: ['AUTH_STATE_CHANGED'] },
      { status: 503, codes: ['AUTH_SERVICE_UNAVAILABLE'] },
    ],
  })
  async logoutAll(
    @Body() _dto: EmptyRequestDto,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    await this.logoutService.logoutAll({
      auth: getRequestAuthContext(request),
      sourceIp: readSourceIp(request),
      requestId: getRequestId(request),
    })
    this.setCookie(response, this.cookieProvider.clear())
  }

  private setCookie(response: CookieResponse, cookie: SessionCookie): void {
    response.cookie(cookie.name, cookie.value, cookie.options)
  }
}
