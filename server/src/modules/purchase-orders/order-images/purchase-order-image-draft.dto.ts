import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator'

import { PurchaseOrderIdParamDto } from '../dto/purchase-order-query.dto'

export class PurchaseOrderGenerateImageDraftRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number

  @ApiProperty({ type: 'boolean', required: false, default: false, description: '主动重新生成；默认复用同一订单版本的有效图片。' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  regenerate?: boolean
}

export class PurchaseOrderImageDraftIdParamDto extends PurchaseOrderIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  draftId!: string
}

export class PurchaseOrderImageGeneratedByDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly displayName!: string
}

export class PurchaseOrderImageDraftDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly purchaseOrderId!: string
  @ApiProperty({ type: 'integer', minimum: 1 }) readonly orderVersion!: number
  @ApiProperty({ type: 'string' }) readonly templateVersion!: string
  @ApiProperty({ type: 'string', format: 'date-time' }) readonly generatedAt!: string
  @ApiProperty({ type: PurchaseOrderImageGeneratedByDto }) readonly generatedBy!: PurchaseOrderImageGeneratedByDto
  @ApiProperty({ type: 'string', description: '仅当前登录会话可读取的采购单图片内容地址。' }) readonly contentUrl!: string
  @ApiProperty({ type: 'boolean', description: '图片与当前订单版本及内容一致，可以用于审核。' }) readonly isCurrent!: boolean
}

export class PurchaseOrderImageDraftResponseDto {
  @ApiProperty({ type: PurchaseOrderImageDraftDto, nullable: true }) readonly draft!: PurchaseOrderImageDraftDto | null
}
