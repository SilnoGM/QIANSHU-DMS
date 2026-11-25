import {
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  applyDecorators,
} from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  NotificationContentMediaParamDto,
  NotificationContentMediaUploadDto,
} from './notification-content-media.dto'
import type { NotificationContentMediaMultipartRequest } from './notification-content-media-multipart.parser'
import {
  NotificationContentMediaService,
  type NotificationContentMediaContent,
} from './notification-content-media.service'
import type { NotificationEventConfigContext } from './notification-event-config.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): NotificationEventConfigContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

interface ContentResponse {
  status(value: number): unknown
  setHeader(name: string, value: string): unknown
}

function deliver(result: NotificationContentMediaContent, response: ContentResponse) {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

function contentContract(operationId: string, head = false) {
  return applyDecorators(
    contract(operationId, false, [
      { status: 404, codes: ['NOTIFICATION_CONTENT_MEDIA_NOT_FOUND'] },
      { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
    ]),
    ApiContractResponse({
      status: 200,
      ...(head
        ? { description: 'Private notification content image headers.' }
        : {
            content: Object.fromEntries(
              ['image/jpeg', 'image/png', 'image/webp'].map(mime => [
                mime,
                { schema: { type: 'string', format: 'binary' } },
              ]),
            ),
          }),
    }),
    ApiContractResponse({ status: 304, description: 'Image ETag matched.' }),
  )
}

/**
 * 事件渠道内容的图片上传与私有读取。
 * 图片只服务于 mpnews 固定封面与正文插图，不进入通用媒体库。
 */
@ApiTags('notifications')
@Controller('notifications/content-media')
export class NotificationContentMediaController {
  constructor(private readonly media: NotificationContentMediaService) {}

  @Post()
  @HttpCode(201)
  @RequirePermissions('notification-policy:update')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiContractResponse({ status: 201, type: NotificationContentMediaUploadDto })
  @contract('notifications_content_media_upload', true, [
    {
      status: 422,
      codes: [
        'NOTIFICATION_CONTENT_MEDIA_INVALID',
        'NOTIFICATION_CONTENT_MEDIA_MULTIPART_INVALID',
        'NOTIFICATION_CONTENT_MEDIA_TOO_LARGE',
      ],
    },
    { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
  ])
  upload(@Req() request: NotificationContentMediaMultipartRequest) {
    return this.media.upload(context(request), request)
  }

  @Get(':assetId/content')
  @RequirePermissions('notification-policy:read')
  @contentContract('notifications_content_media_get')
  async content(
    @Param() params: NotificationContentMediaParamDto,
    @Headers('if-none-match') tag: unknown,
    @Res({ passthrough: true }) response: ContentResponse,
  ) {
    return deliver(await this.media.content(params.assetId, tag, 'GET'), response)
  }

  @Head(':assetId/content')
  @RequirePermissions('notification-policy:read')
  @contentContract('notifications_content_media_head', true)
  async headContent(
    @Param() params: NotificationContentMediaParamDto,
    @Headers('if-none-match') tag: unknown,
    @Res({ passthrough: true }) response: ContentResponse,
  ) {
    deliver(await this.media.content(params.assetId, tag, 'HEAD'), response)
  }
}
