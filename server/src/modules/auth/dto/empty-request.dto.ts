import { ApiHideProperty } from '@nestjs/swagger'
import { Allow } from 'class-validator'

/**
 * logout 类命令要求客户端显式发送空 JSON object。
 *
 * 隐藏标记只用于让 class-validator 建立白名单元数据：空对象可通过，而任意实际
 * 请求字段都会被全局 `forbidNonWhitelisted` 拒绝；该标记不会进入 OpenAPI。
 */
export class EmptyRequestDto {
  @ApiHideProperty()
  @Allow()
  private readonly __emptyRequestMarker?: never
}
