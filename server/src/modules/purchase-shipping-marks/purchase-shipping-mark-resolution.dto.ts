import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, Validate, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator'

import { isNormalizableDictionaryItemValue } from '../dictionaries/dictionary.normalizer'
import { NumberingRuleConfigResponseDto } from '../numbering/dto/numbering-response.dto'
import { SHIPPING_MARK_AVAILABILITIES, type ShippingMarkAvailability } from './shipping-mark-binding.dto'

@ValidatorConstraint({ name: 'shippingMarkSupplierForProductMode', async: false })
class ShippingMarkSupplierForProductMode implements ValidatorConstraintInterface {
  validate(value: unknown, arguments_: ValidationArguments): boolean {
    const { productMode } = arguments_.object as { productMode?: unknown }
    return productMode === 'CUSTOM'
      ? value === undefined
      : productMode === 'CATALOG' && isNormalizableDictionaryItemValue(value)
  }

  defaultMessage(): string {
    return 'supplierValue must be a stable dictionary value for CATALOG and absent for CUSTOM'
  }
}

export class PurchaseOrderShippingMarkResolutionQueryDto {
  @ApiProperty({ type: 'string', enum: ['CATALOG', 'CUSTOM'] })
  @IsIn(['CATALOG', 'CUSTOM'])
  productMode!: 'CATALOG' | 'CUSTOM'

  @ApiPropertyOptional({ type: 'string', minLength: 1, maxLength: 64, description: 'CATALOG 必填供应商稳定 value；CUSTOM 禁止传入。' })
  @Validate(ShippingMarkSupplierForProductMode)
  supplierValue?: string
}

export class PurchaseOrderShippingMarkResolutionDto {
  @ApiProperty({ type: 'string', enum: ['CATALOG', 'CUSTOM'] })
  productMode!: 'CATALOG' | 'CUSTOM'

  @ApiProperty({ type: 'string', enum: ['SUPPLIER_BINDING', 'CUSTOM_RULE'] })
  matchSource!: 'SUPPLIER_BINDING' | 'CUSTOM_RULE'

  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  ruleId!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  ruleCode!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  name!: string | null

  @ApiProperty({ type: 'integer', minimum: 1, nullable: true })
  activeRevision!: number | null

  @ApiProperty({ type: NumberingRuleConfigResponseDto, nullable: true, description: '唛头规则当前生效配置；停用时仍可核对，不回退草稿。缺少生效版本或用途不符时为 null。' })
  activeConfig!: NumberingRuleConfigResponseDto | null

  @ApiProperty({ type: 'string', enum: SHIPPING_MARK_AVAILABILITIES })
  availability!: ShippingMarkAvailability

  @ApiProperty({ type: 'string', description: '安全状态提示；AVAILABLE 不代表已预留容量或派发编号。' })
  message!: string

  @ApiProperty({ type: 'string', nullable: true, pattern: '^[0-9a-f]{64}$', minLength: 64, maxLength: 64, description: 'AVAILABLE 时返回场景摘要，其他状态为 null；不作为客户端指定规则的凭据。' })
  resolutionToken!: string | null
}
