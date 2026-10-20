import {
  Body,
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequireAuthenticatedSession } from '../auth/decorators/auth.decorators'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { CurrentUserProfileDto } from './dto/current-user-profile.dto'
import {
  ProfileAvatarParamDto,
  ProfileAvatarUploadDto,
} from './dto/profile-avatar.dto'
import { UpdateCurrentUserProfileRequestDto } from './dto/update-current-user-profile-request.dto'
import { ProfileAvatarService, type ProfileAvatarContent } from './profile-avatar.service'
import { UserProfileService } from './user-profile.service'

interface ContentResponse {
  setHeader(name: string, value: string): unknown
  status(value: number): unknown
}

function deliverAvatar(
  result: ProfileAvatarContent,
  response: ContentResponse,
): StreamableFile | undefined {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value)
  }
  return result.stream ? new StreamableFile(result.stream) : undefined
}

/**
 * 本人资料 HTTP 边界不接受任何用户标识；GET 与 PATCH 的唯一目标都来自
 * AuthenticationGuard 已绑定的 RequestAuthContext。
 */
@ApiTags('profile')
@Controller('profile')
@RequireAuthenticatedSession()
export class ProfileController {
  constructor(
    private readonly profile: UserProfileService,
    private readonly avatars: ProfileAvatarService,
  ) {}

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

  @Post('avatar-uploads')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['mediaType', 'file'],
      additionalProperties: false,
      properties: {
        mediaType: { type: 'string', enum: ['IMAGE'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: ProfileAvatarUploadDto })
  @ApiApplicationContract({
    operationId: 'profile_avatar_upload',
    session: 'required',
    authorization: false,
    csrf: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['CSRF_REJECTED', 'PASSWORD_CHANGE_REQUIRED'],
      },
      {
        status: 422,
        codes: [
          'PROFILE_AVATAR_INVALID',
          'PROFILE_AVATAR_TOO_LARGE',
          'PROFILE_AVATAR_UNAVAILABLE',
          'VALIDATION_FAILED',
        ],
      },
      {
        status: 503,
        codes: ['MEDIA_STORAGE_UNAVAILABLE'],
      },
    ],
  })
  uploadAvatar(
    @Req() request: SalesOrderDocumentMultipartRequest,
  ): Promise<ProfileAvatarUploadDto> {
    return this.avatars.upload(getRequestAuthContext(request).userId, request)
  }

  @Get('avatars/:id/content')
  @ApiContractResponse({
    status: HttpStatus.OK,
    content: Object.fromEntries(
      ['image/jpeg', 'image/png', 'image/webp'].map(mime => [
        mime,
        { schema: { type: 'string', format: 'binary' } },
      ]),
    ),
  })
  @ApiContractResponse({
    status: HttpStatus.NOT_MODIFIED,
    description: 'Avatar ETag matched.',
  })
  @ApiApplicationContract({
    operationId: 'profile_avatar_content',
    session: 'required',
    authorization: false,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PROFILE_AVATAR_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async avatar(
    @Param() params: ProfileAvatarParamDto,
    @Headers('if-none-match') tag: unknown,
    @Req() request: object,
    @Res({ passthrough: true }) response: ContentResponse,
  ): Promise<StreamableFile | undefined> {
    return deliverAvatar(
      await this.avatars.content(
        getRequestAuthContext(request).userId,
        params.id,
        tag,
        'GET',
      ),
      response,
    )
  }

  @Head('avatars/:id/content')
  @ApiApplicationContract({
    operationId: 'profile_avatar_head_content',
    session: 'required',
    authorization: false,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['PROFILE_AVATAR_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ],
  })
  async avatarHead(
    @Param() params: ProfileAvatarParamDto,
    @Headers('if-none-match') tag: unknown,
    @Req() request: object,
    @Res({ passthrough: true }) response: ContentResponse,
  ): Promise<void> {
    deliverAvatar(
      await this.avatars.content(
        getRequestAuthContext(request).userId,
        params.id,
        tag,
        'HEAD',
      ),
      response,
    )
  }
}
