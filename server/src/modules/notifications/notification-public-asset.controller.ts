import {
  Controller,
  Get,
  Param,
  Res,
  StreamableFile,
  applyDecorators,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { ApiException } from '../../infrastructure/http/api.exception'
import { Public } from '../auth/decorators/auth.decorators'
import { NotificationAssetUrlService } from './notification-asset-url.service'
import {
  NotificationContentMediaService,
  type NotificationContentMediaContent,
} from './notification-content-media.service'

interface ContentResponse {
  status(value: number): unknown
  setHeader(name: string, value: string): unknown
}

function deliver(result: NotificationContentMediaContent, response: ContentResponse) {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  return result.stream ? new StreamableFile(result.stream) : undefined
}

/**
 * 企业微信群机器人/应用消息抓取 NEWS 图片的公开入口。
 * 只接受服务端签发的短期 token；不接受任意资产 ID，也不提供目录或列表能力。
 */
@ApiTags('notifications')
@Controller('public/notification-assets')
export class NotificationPublicAssetController {
  constructor(
    private readonly assets: NotificationAssetUrlService,
    private readonly media: NotificationContentMediaService,
  ) {}

  @Get(':token')
  @Public()
  @applyDecorators(
    ApiApplicationContract({
      operationId: 'notifications_public_asset_get',
      session: 'none',
      privateNoStore: true,
      errors: [
        { status: 400, codes: ['VALIDATION_FAILED'] },
        { status: 404, codes: ['NOTIFICATION_PUBLIC_ASSET_NOT_FOUND'] },
        { status: 503, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
      ],
    }),
    ApiContractResponse({
      status: 200,
      content: Object.fromEntries(
        ['image/jpeg', 'image/png', 'image/webp'].map(mime => [
          mime,
          { schema: { type: 'string', format: 'binary' } },
        ]),
      ),
    }),
  )
  async get(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: ContentResponse,
  ) {
    const assetId = this.assets.verifyNewsImageToken(token)
    if (assetId === null) {
      throw new ApiException(404, 'NOTIFICATION_PUBLIC_ASSET_NOT_FOUND', '资源不存在或链接已过期')
    }
    try {
      return deliver(await this.media.content(assetId, undefined, 'GET'), response)
    }
    catch (error) {
      // 公开入口不区分「资产不存在」和「资产未绑定内容」，避免泄露媒体状态。
      if (error instanceof ApiException && error.getStatus() === 404) {
        throw new ApiException(404, 'NOTIFICATION_PUBLIC_ASSET_NOT_FOUND', '资源不存在或链接已过期')
      }
      throw error
    }
  }
}
