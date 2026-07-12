import {
  ApiProperty,
  type ApiPropertyOptions,
} from '@nestjs/swagger'

export type HealthIndicatorMap = Record<
  string,
  { status: string; [key: string]: unknown }
>

const HEALTH_INDICATOR_MAP_PROPERTY = {
  type: 'object',
  additionalProperties: {
    type: 'object',
    properties: {
      status: { type: 'string' },
    },
    required: ['status'],
    additionalProperties: true,
  },
} satisfies ApiPropertyOptions

export class HealthSuccessResponseDto {
  @ApiProperty({ type: 'string', enum: ['ok'] })
  status!: 'ok'

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  info!: HealthIndicatorMap

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  error!: HealthIndicatorMap

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  details!: HealthIndicatorMap
}

export class HealthFailureResponseDto {
  @ApiProperty({ type: 'string', enum: ['error'] })
  status!: 'error'

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  info!: HealthIndicatorMap

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  error!: HealthIndicatorMap

  @ApiProperty(HEALTH_INDICATOR_MAP_PROPERTY)
  details!: HealthIndicatorMap
}
