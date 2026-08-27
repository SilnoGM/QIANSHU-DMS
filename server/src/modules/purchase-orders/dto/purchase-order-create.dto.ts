import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator'

import {
  PurchaseOrderLineType,
  PurchaseOrderType,
} from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const PURCHASE_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const PURCHASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export class PurchaseOrderLineInputDto {
  @ApiProperty({ enum: PurchaseOrderLineType })
  @IsEnum(PurchaseOrderLineType)
  lineType!: PurchaseOrderLineType

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @ValidateIf((line: PurchaseOrderLineInputDto) => line.lineType === 'CATALOG')
  @IsUUID('4')
  productId?: string

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @IsOptional()
  @IsUUID('4')
  sourceSalesOrderLineId?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128, required: false })
  @ValidateIf((line: PurchaseOrderLineInputDto) => line.lineType === 'CUSTOM')
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  name?: string

  @ApiProperty({ type: 'string', maxLength: 1000, nullable: true, required: false })
  @ValidateIf((line: PurchaseOrderLineInputDto) => line.lineType === 'CUSTOM')
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  description?: string | null

  @ApiProperty({
    type: 'string',
    pattern: PURCHASE_AMOUNT_PATTERN.source,
    required: false,
    description: '仅 CUSTOM 行提交，必须由用户填写并与本单采购价相等',
  })
  @ValidateIf((line: PurchaseOrderLineInputDto) => line.lineType === 'CUSTOM')
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  referencePurchaseUnitPriceAmount?: string

  @ApiProperty({
    type: 'string',
    pattern: PURCHASE_AMOUNT_PATTERN.source,
    description: '本单采购价，非负且最多两位小数',
  })
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  actualPurchaseUnitPriceAmount!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number
}

export class CreatePurchaseOrderRequestDto {
  @ApiProperty({ enum: PurchaseOrderType })
  @IsEnum(PurchaseOrderType)
  purchaseType!: PurchaseOrderType

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @ValidateIf((order: CreatePurchaseOrderRequestDto) => (
    order.purchaseType === 'SALES_LINKED'
  ))
  @IsUUID('4')
  salesOrderId?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue!: string

  @ApiProperty({ type: 'string', format: 'date' })
  @IsString()
  @Matches(PURCHASE_DATE_PATTERN)
  orderDate!: string

  @ApiProperty({ type: 'string', maxLength: 2000, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 2000)
  shippingMarkText?: string | null

  @ApiProperty({ type: () => [PurchaseOrderLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  lines!: PurchaseOrderLineInputDto[]

  @ApiProperty({ type: 'string', pattern: PURCHASE_AMOUNT_PATTERN.source })
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  purchaseTotalAmount!: string

  @ApiProperty({ type: 'string', pattern: PURCHASE_AMOUNT_PATTERN.source })
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  depositDueAmount!: string

  @ApiProperty({ type: 'string', pattern: PURCHASE_AMOUNT_PATTERN.source })
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  balanceDueAmount!: string

  @ApiProperty({ type: 'string', maxLength: 1000, nullable: true, required: false })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  remark?: string | null
}
