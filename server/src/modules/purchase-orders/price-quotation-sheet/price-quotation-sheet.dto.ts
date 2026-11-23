import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
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

import { PurchaseOrderLineType } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const PURCHASE_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,25})(?:\.\d{1,2})?$/u
const PURCHASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
// 默认 JSON 解析上限是 100 KiB；80 字备注保证 100 行 CUSTOM 的最坏请求体仍能通过。
export const PRICE_QUOTATION_SHEET_DESCRIPTION_MAX_LENGTH = 80

export class PriceQuotationSheetLineInputDto {
  @ApiProperty({ enum: PurchaseOrderLineType })
  @IsEnum(PurchaseOrderLineType)
  lineType!: PurchaseOrderLineType

  @ApiProperty({ type: 'string', format: 'uuid', required: false })
  @ValidateIf((line: PriceQuotationSheetLineInputDto) => line.lineType === 'CATALOG')
  @IsUUID('4')
  productId?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128, required: false })
  @ValidateIf((line: PriceQuotationSheetLineInputDto) => line.lineType === 'CUSTOM')
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  name?: string

  @ApiProperty({
    type: 'string',
    pattern: PURCHASE_AMOUNT_PATTERN.source,
    required: false,
    description: 'CATALOG 行必填：前端当前展示的采购定价，用于检测产品档案改价',
  })
  @ValidateIf((line: PriceQuotationSheetLineInputDto) => line.lineType === 'CATALOG')
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  expectedReferencePurchaseUnitPriceAmount?: string

  @ApiProperty({
    type: 'string',
    pattern: PURCHASE_AMOUNT_PATTERN.source,
    required: false,
    description: 'CUSTOM 行必填：采购定价，必须与本单采购价相等',
  })
  @ValidateIf((line: PriceQuotationSheetLineInputDto) => line.lineType === 'CUSTOM')
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  referencePurchaseUnitPriceAmount?: string

  @ApiProperty({ type: 'string', pattern: PURCHASE_AMOUNT_PATTERN.source, description: '本单采购价，非负且最多两位小数' })
  @IsString()
  @Matches(PURCHASE_AMOUNT_PATTERN)
  actualPurchaseUnitPriceAmount!: string

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  quantity!: number

  @ApiProperty({
    type: 'string',
    maxLength: PRICE_QUOTATION_SHEET_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    required: false,
    description: '行备注，仅用于核价单展示；超长备注由前端截断后提交',
  })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, PRICE_QUOTATION_SHEET_DESCRIPTION_MAX_LENGTH)
  description?: string | null
}

export class PriceQuotationSheetRequestDto {
  @ApiProperty({ enum: ['CATALOG', 'CUSTOM'] })
  @IsIn(['CATALOG', 'CUSTOM'])
  productMode!: 'CATALOG' | 'CUSTOM'

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64, required: false })
  @ValidateIf((order: PriceQuotationSheetRequestDto) => order.productMode === 'CATALOG')
  @IsString()
  @IsUnicodeCodePointLength(1, 64)
  supplierValue?: string

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 128, required: false })
  @ValidateIf((order: PriceQuotationSheetRequestDto) => order.productMode === 'CUSTOM')
  @IsString()
  @IsUnicodeCodePointLength(1, 128)
  customSupplierName?: string

  @ApiProperty({ type: 'string', format: 'date' })
  @IsString()
  @Matches(PURCHASE_DATE_PATTERN)
  orderDate!: string

  @ApiProperty({ type: () => [PriceQuotationSheetLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PriceQuotationSheetLineInputDto)
  lines!: PriceQuotationSheetLineInputDto[]
}
