import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'

export class ContainerSwapContextQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  leftShipmentId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  rightShipmentId!: string
}

export class ContainerSwapLineInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  loadingItemId!: string

  @ApiProperty({ minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 31,
    description: '由采运人员逐行手工填写的代收金额；null 表示无代收。不随对方货件自动复制。',
  })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 31)
  codAmountTwd?: string | null
}

export class ContainerSwapRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  leftShipmentId!: string

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  rightShipmentId!: string

  @ApiProperty({ type: [ContainerSwapLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContainerSwapLineInputDto)
  leftLines!: ContainerSwapLineInputDto[]

  @ApiProperty({ type: [ContainerSwapLineInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContainerSwapLineInputDto)
  rightLines!: ContainerSwapLineInputDto[]

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  note?: string | null
}

export class ContainerSwapItemDto {
  @ApiProperty({ enum: ['CATALOG', 'CUSTOM'] })
  lineType!: 'CATALOG' | 'CUSTOM'

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  productId!: string | null

  @ApiProperty()
  productName!: string

  @ApiProperty()
  quantity!: number
}

export class ContainerSwapLineDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ format: 'uuid' })
  containerBatchId!: string

  @ApiProperty()
  lineNumber!: number

  @ApiProperty()
  version!: number

  @ApiProperty()
  goodsName!: string

  @ApiProperty({ type: String, nullable: true })
  oceanShippingMarkText!: string | null

  @ApiProperty({ type: String, nullable: true })
  recipientName!: string | null

  @ApiProperty({ type: String, nullable: true })
  recipientPhone!: string | null

  @ApiProperty({ type: String, nullable: true })
  recipientAddress!: string | null

  @ApiProperty({ type: String, nullable: true })
  codAmountTwd!: string | null

  @ApiProperty({ type: String, nullable: true })
  remark!: string | null

  @ApiProperty({ type: String, nullable: true, description: '按对方货件合并/复制后的收件人；null 表示无值。' })
  afterRecipientName!: string | null

  @ApiProperty({ type: String, nullable: true })
  afterRecipientPhone!: string | null

  @ApiProperty({ type: String, nullable: true })
  afterRecipientAddress!: string | null

  @ApiProperty({ type: String, nullable: true })
  afterRemark!: string | null
}

export class ContainerSwapShipmentDto {
  @ApiProperty({ format: 'uuid' })
  id!: string

  @ApiProperty({ type: String, nullable: true })
  shipmentNo!: string | null

  @ApiProperty({ type: String, nullable: true })
  shippingMark!: string | null

  @ApiProperty({ format: 'uuid' })
  purchaseOrderId!: string

  @ApiProperty()
  purchaseOrderNo!: string

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  salesOrderId!: string | null

  @ApiProperty({ type: String, nullable: true })
  salesOrderNo!: string | null

  @ApiProperty({ type: String, nullable: true })
  customerName!: string | null

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  containerBatchId!: string | null

  @ApiProperty({ type: String, nullable: true })
  containerBatchNo!: string | null

  @ApiProperty({ type: String, nullable: true })
  containerBatchName!: string | null

  @ApiProperty({ type: [ContainerSwapItemDto] })
  items!: ContainerSwapItemDto[]

  @ApiProperty({ type: [ContainerSwapLineDto] })
  containerLoadingItems!: ContainerSwapLineDto[]
}

export class ContainerSwapErrorDto {
  @ApiProperty()
  code!: string

  @ApiProperty()
  message!: string
}

export class ContainerSwapContextDto {
  @ApiProperty({ type: ContainerSwapShipmentDto })
  left!: ContainerSwapShipmentDto

  @ApiProperty({ type: ContainerSwapShipmentDto })
  right!: ContainerSwapShipmentDto

  @ApiProperty({ type: [ContainerSwapErrorDto] })
  errors!: ContainerSwapErrorDto[]

  @ApiProperty()
  canSwap!: boolean
}

export class ContainerSwapResultDto {
  @ApiProperty({ format: 'uuid' })
  leftShipmentId!: string

  @ApiProperty({ format: 'uuid' })
  rightShipmentId!: string

  @ApiProperty()
  changedLineCount!: number

  @ApiProperty()
  replayed!: boolean
}
