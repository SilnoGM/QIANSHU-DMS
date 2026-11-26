import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'

export type ApiFieldErrors = Record<string, string[]>

/**
 * 业务校验的结构化定位信息，供客户端精确跳转到出错项。
 * 通用字段保持可选，避免把某个业务域的模型耦合进公共错误契约。
 */
export class ApiErrorIssue {
  @ApiProperty()
  code!: string

  @ApiProperty()
  message!: string

  @ApiPropertyOptional({ description: '出错字段路径，例如 content 或 cover.mediaAssetId' })
  field?: string

  @ApiPropertyOptional({ description: '出错项在所属集合中的 0-based 序号' })
  itemIndex?: number

  @ApiPropertyOptional({ description: '业务渠道标识，例如 IN_APP 或 WECOM' })
  channel?: string
}

export class ApiError {
  @ApiProperty()
  code!: string

  @ApiProperty()
  message!: string

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'string' },
    },
  })
  fieldErrors?: ApiFieldErrors

  @ApiPropertyOptional({
    type: () => [ApiErrorIssue],
    description: '结构化业务校验问题；客户端可据此定位渠道、消息项与字段',
  })
  issues?: ApiErrorIssue[]

  @ApiProperty()
  requestId!: string
}
