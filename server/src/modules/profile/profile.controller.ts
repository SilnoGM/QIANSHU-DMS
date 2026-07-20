import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Patch,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import { CurrentUserProfileDto } from './dto/current-user-profile.dto'
import { UpdateCurrentUserProfileRequestDto } from './dto/update-current-user-profile-request.dto'
import { UserProfileService } from './user-profile.service'

/**
 * 本人资料 HTTP 边界不接受任何用户标识；GET 与 PATCH 的唯一目标都来自
 * AuthenticationGuard 已绑定的 RequestAuthContext。
 */
@ApiTags('profile')
@Controller('profile')
@RequireAuthenticatedSession()
export class ProfileController {
  constructor(private readonly profile: UserProfileService) {}

  @Get()
  @ApiContractResponse({ status: HttpStatus.OK, type: CurrentUserProfileDto })
  @ApiApplicationContract({
    operationId: 'profile_get',
    session: 'required',
    authorization: false,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
    ],
  })
  get(@Req() request: object): Promise<CurrentUserProfileDto> {
    return this.profile.getCurrent(getRequestAuthContext(request).userId)
  }

  @Patch()
  @ApiContractResponse({ status: HttpStatus.OK, type: CurrentUserProfileDto })
  @ApiApplicationContract({
    operationId: 'profile_update',
    session: 'required',
    authorization: false,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['CSRF_REJECTED', 'PASSWORD_CHANGE_REQUIRED'],
      },
      {
        status: 409,
        codes: ['EMAIL_ALREADY_EXISTS', 'MOBILE_ALREADY_EXISTS'],
      },
    ],
  })
  update(
    @Body() dto: UpdateCurrentUserProfileRequestDto,
    @Req() request: object,
  ): Promise<CurrentUserProfileDto> {
    const auth = getRequestAuthContext(request)
    return this.profile.updateCurrent(
      { actorUserId: auth.userId, requestId: getRequestId(request) },
      dto,
    )
  }
}
