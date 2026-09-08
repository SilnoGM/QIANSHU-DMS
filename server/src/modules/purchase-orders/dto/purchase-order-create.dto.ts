import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
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
  type PurchaseOrderProductMode,
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

export class PurchaseOrderPartItemInputDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, description: '本次最终采购明细的 1 起始行号' })
  @IsInt()
  @Min(1)
  @Max(100)
  lineNumber!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number
}

export class PurchaseOrderPartInputDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: '全单唯一且重试时保持不变的 UUID v4 货件标识' })
  @IsUUID('4')
  key!: string

  @ApiProperty({ type: () => [PurchaseOrderPartItemInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderPartItemInputDto)
  items!: PurchaseOrderPartItemInputDto[]
}

export class CreatePurchaseOrderRequestDto {
  @ApiProperty({ enum: PurchaseOrderType })
  @IsEnum(PurchaseOrderType)
  purchaseType!: PurchaseOrderType

  @ApiProperty({ enum: ['CATALOG', 'CUSTOM'] })
  @IsIn(['CATALOG', 'CUSTOM'])
  productMode!: Exclude<PurchaseOrderProductMode, 'MIXED'>

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @ValidateIf((order: CreatePurchaseOrderRequestDto) => (
    order.purchaseType === 'SALES_LINKED'
  ))
  @IsUUID('4')
  salesOrderId?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64, required: false })
  @ValidateIf((order: CreatePurchaseOrderRequestDto) => (
    order.productMode === 'CATALOG'
  ))
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128, required: false })
  @ValidateIf((order: CreatePurchaseOrderRequestDto) => (
    order.productMode === 'CUSTOM'
  ))
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  customSupplierName?: string

  @ApiProperty({ type: 'string', format: 'date' })
  @IsString()
  @Matches(PURCHASE_DATE_PATTERN)
  orderDate!: string

  @ApiProperty({
    type: 'string', pattern: '^[0-9a-f]{64}$',
    description: '采购唛头规则解析返回的匹配摘要，创建时重新预检但不派号；审核使用当时有效规则',
  })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/u)
  expectedShippingMarkResolution!: string

  @ApiProperty({ type: () => [PurchaseOrderLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineInputDto)
  lines!: PurchaseOrderLineInputDto[]

  @ApiProperty({ type: () => [PurchaseOrderPartInputDto], minItems: 1, maxItems: 1000,
    description: '必填货件配置；完整且仅一次覆盖各采购行数量；全单最多 10000 个分配项，创建 JSON 最大 1 MiB。历史 v3 已提交请求仅允许原幂等键恢复。' })
  // DTO 只给历史同键恢复保留缺字段入口；service 在查明已提交 v3 身份后才允许缺失。
  @ValidateIf((_order: CreatePurchaseOrderRequestDto, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderPartInputDto)
  parts!: PurchaseOrderPartInputDto[]

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
