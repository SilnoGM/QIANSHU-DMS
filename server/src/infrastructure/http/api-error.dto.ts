import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger'

export type ApiFieldErrors = Record<string, string[]>

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

  @ApiProperty()
  requestId!: string
}
