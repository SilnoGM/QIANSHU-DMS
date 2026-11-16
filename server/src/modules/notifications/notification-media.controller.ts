import { Controller, Get, Head, Param, Req, Res, StreamableFile } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { Public } from '../auth/decorators/auth.decorators'
import {
  AssistantMediaDeliveryService,
  type NotificationMediaContent,
} from './assistant-media-delivery.service'

interface ContentResponse {
  status(value: number): unknown
  setHeader(name: string, value: string): unknown
}

const IMAGE_CONTENT = {
  'image/jpeg': { schema: { type: 'string', format: 'binary' } },
  'image/png': { schema: { type: 'string', format: 'binary' } },
  'image/webp': { schema: { type: 'string', format: 'binary' } },
} as const

const MEDIA_ERRORS = [
  { status: 404 as const, codes: ['NOTIFICATION_MEDIA_NOT_FOUND'] },
  { status: 429 as const, codes: ['RATE_LIMITED'] },
  { status: 503 as const, codes: ['MEDIA_STORAGE_UNAVAILABLE'] },
]

function clientKey(request: unknown): string {
  if (typeof request === 'object' && request !== null) {
    const ip = (request as { ip?: unknown }).ip
    if (typeof ip === 'string' && ip.length > 0) {
      return ip.slice(0, 64)
    }
  }
  return 'unknown'
}

function deliver(result: NotificationMediaContent, response: ContentResponse) {
  response.status(result.status)
  for (const [name, value] of Object.entries(result.headers)) {
    response.setHeader(name, value)
  }
  return result.stream ? new StreamableFile(result.stream) : undefined
}

/**
 * 千树小助理图片的公开取流入口。
 *
 * GeWe 由上游服务器按 URL 拉取图片，无法携带 Session Cookie，因此这条路由
 * 只靠短时效 HMAC token 鉴权；它不属于任何业务资源接口，也不暴露给浏览器 SDK
 * 以外的调用方。响应继续使用全局的 `private, no-store`，不允许被中间缓存留存。
 */
@ApiTags('public-media')
@Controller('public/notification-media')
export class NotificationMediaController {
  constructor(private readonly media: AssistantMediaDeliveryService) {}

  @Get(':token')
  @Public()
  @ApiApplicationContract({
    operationId: 'notification_media_public_get',
    authentication: false,
    authorization: false,
    resourceLocator: true,
    validation: false,
    session: 'none',
    privateNoStore: true,
    retry: true,
    // 路径参数存在时必须声明 400 契约；实际校验失败也会走统一 ApiError 形状。
    badRequest: true,
    errors: MEDIA_ERRORS,
  })
  @ApiContractResponse({ status: 200, description: 'Notification attachment image bytes.', content: IMAGE_CONTENT })
  @ApiContractResponse({ status: 404, description: 'Token invalid, expired or attachment unavailable.' })
  @ApiContractResponse({ status: 429, description: 'Too many requests from this address.' })
  @ApiContractResponse({ status: 503, description: 'Media storage is temporarily unavailable.' })
  async get(
    @Param('token') token: string,
    @Req() request: unknown,
    @Res({ passthrough: true }) response: ContentResponse,
  ) {
    return deliver(await this.media.resolve(token, 'GET', clientKey(request)), response)
  }

  @Head(':token')
  @Public()
  @ApiApplicationContract({
    operationId: 'notification_media_public_head',
    authentication: false,
    authorization: false,
    resourceLocator: true,
    validation: false,
    session: 'none',
    privateNoStore: true,
    retry: true,
    badRequest: true,
    errors: MEDIA_ERRORS,
  })
  @ApiContractResponse({ status: 200, description: 'Notification attachment image headers.' })
  @ApiContractResponse({ status: 404, description: 'Token invalid, expired or attachment unavailable.' })
  @ApiContractResponse({ status: 429, description: 'Too many requests from this address.' })
  @ApiContractResponse({ status: 503, description: 'Media storage is temporarily unavailable.' })
  async head(
    @Param('token') token: string,
    @Req() request: unknown,
    @Res({ passthrough: true }) response: ContentResponse,
  ) {
    return deliver(await this.media.resolve(token, 'HEAD', clientKey(request)), response)
  }
}
