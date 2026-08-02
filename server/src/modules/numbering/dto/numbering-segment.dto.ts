import {
  ApiExtraModels,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  Matches,
  Max,
  Min,
  type ValidationArguments,
  ValidateBy,
  ValidateNested,
} from 'class-validator'

import {
  NUMBERING_DATE_FORMATS,
  NUMBERING_RANDOM_MODES,
  NUMBERING_RESET_POLICIES,
  type NumberingDateFormat,
  type NumberingRandomMode,
  type NumberingResetPolicy,
} from '../rule-engine'
import {
  IsCanonicalNonNegativeDecimalString,
  IsCanonicalPositiveDecimalString,
} from '../numbering-decimal'

const NUMBERING_SEGMENT_TYPES = [
  'FIXED',
  'DATE',
  'SEPARATOR',
  'SEQUENCE',
  'RANDOM',
] as const

const NUMBERING_SEPARATORS = ['-', '_', '.', '/'] as const

function HasValidRandomLengthTotal(): PropertyDecorator {
  return ValidateBy({
    name: 'hasValidRandomLengthTotal',
    validator: {
      validate(_value: unknown, arguments_: ValidationArguments): boolean {
        const segment = arguments_.object as NumberingRandomSegmentInputDto
        if (
          !Number.isInteger(segment.letterLength)
          || !Number.isInteger(segment.digitLength)
        ) {
          return true
        }

        const total = segment.letterLength + segment.digitLength
        return total >= 1 && total <= 32
      },
      defaultMessage(): string {
        return '字母和数字总长度必须为 1 到 32'
      },
    },
  })
}

export class NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: NUMBERING_SEGMENT_TYPES })
  @IsIn(NUMBERING_SEGMENT_TYPES, { message: '片段类型不在白名单内' })
  type!: (typeof NUMBERING_SEGMENT_TYPES)[number]
}

export class NumberingFixedSegmentInputDto
  extends NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: ['FIXED'] })
  @Equals('FIXED', { message: '片段类型必须为 FIXED' })
  type = 'FIXED' as const

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 64 })
  @Matches(/^[A-Z0-9]{1,64}$/u, {
    message: '固定字符必须是 1 到 64 位大写英文字母或数字',
  })
  value!: string
}

export class NumberingDateSegmentInputDto
  extends NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: ['DATE'] })
  @Equals('DATE', { message: '片段类型必须为 DATE' })
  type = 'DATE' as const

  @ApiProperty({ type: 'string', enum: NUMBERING_DATE_FORMATS })
  @IsIn(NUMBERING_DATE_FORMATS, { message: '日期格式不在白名单内' })
  format!: NumberingDateFormat
}

export class NumberingSeparatorSegmentInputDto
  extends NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: ['SEPARATOR'] })
  @Equals('SEPARATOR', { message: '片段类型必须为 SEPARATOR' })
  type = 'SEPARATOR' as const

  @ApiProperty({ type: 'string', enum: NUMBERING_SEPARATORS })
  @IsIn(NUMBERING_SEPARATORS, { message: '分隔符只允许 -、_、. 或 /' })
  value!: (typeof NUMBERING_SEPARATORS)[number]
}

export class NumberingSequenceSegmentInputDto
  extends NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: ['SEQUENCE'] })
  @Equals('SEQUENCE', { message: '片段类型必须为 SEQUENCE' })
  type = 'SEQUENCE' as const

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 18 })
  @IsInt({ message: '位数必须是整数' })
  @Min(1, { message: '位数不能小于 1' })
  @Max(18, { message: '位数不能超过 18' })
  width!: number

  @ApiProperty({
    type: 'string',
    pattern: '^(?:0|[1-9]\\d*)$',
  })
  @IsCanonicalNonNegativeDecimalString()
  startValue!: string

  @ApiProperty({ type: 'string', pattern: '^[1-9]\\d*$' })
  @IsCanonicalPositiveDecimalString()
  step!: string
}

export class NumberingRandomSegmentInputDto
  extends NumberingRuleSegmentInputDto {
  @ApiProperty({ type: 'string', enum: ['RANDOM'] })
  @Equals('RANDOM', { message: '片段类型必须为 RANDOM' })
  type = 'RANDOM' as const

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 32 })
  @IsInt({ message: '大写英文字母长度必须是整数' })
  @Min(0, { message: '大写英文字母长度不能小于 0' })
  @Max(32, { message: '大写英文字母长度不能超过 32' })
  letterLength!: number

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 32 })
  @IsInt({ message: '数字长度必须是整数' })
  @Min(0, { message: '数字长度不能小于 0' })
  @Max(32, { message: '数字长度不能超过 32' })
  digitLength!: number

  @ApiProperty({ type: 'string', enum: NUMBERING_RANDOM_MODES })
  @IsIn(NUMBERING_RANDOM_MODES, { message: '随机模式不在白名单内' })
  @HasValidRandomLengthTotal()
  mode!: NumberingRandomMode
}

/**
 * 编号片段的公开判别联合。属性仍由五个具体 DTO 承载，既让 TypeScript
 * 调用方能够按 `type` 安全收窄，也不改变运行时转换与 OpenAPI discriminator。
 */
export type NumberingRuleSegmentInput =
  | NumberingFixedSegmentInputDto
  | NumberingDateSegmentInputDto
  | NumberingSeparatorSegmentInputDto
  | NumberingSequenceSegmentInputDto
  | NumberingRandomSegmentInputDto

const SEGMENT_DISCRIMINATOR_MAPPING = {
  FIXED: getSchemaPath(NumberingFixedSegmentInputDto),
  DATE: getSchemaPath(NumberingDateSegmentInputDto),
  SEPARATOR: getSchemaPath(NumberingSeparatorSegmentInputDto),
  SEQUENCE: getSchemaPath(NumberingSequenceSegmentInputDto),
  RANDOM: getSchemaPath(NumberingRandomSegmentInputDto),
}

export function ApiNumberingRuleSegments(): PropertyDecorator {
  return ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: {
      oneOf: Object.values(SEGMENT_DISCRIMINATOR_MAPPING).map($ref => ({
        $ref,
      })),
      discriminator: {
        propertyName: 'type',
        mapping: SEGMENT_DISCRIMINATOR_MAPPING,
      },
    },
  })
}

@ApiExtraModels(
  NumberingFixedSegmentInputDto,
  NumberingDateSegmentInputDto,
  NumberingSeparatorSegmentInputDto,
  NumberingSequenceSegmentInputDto,
  NumberingRandomSegmentInputDto,
)
export class NumberingRuleConfigInputDto {
  @ApiProperty({ type: 'string', enum: NUMBERING_RESET_POLICIES })
  @IsIn(NUMBERING_RESET_POLICIES, { message: '重置策略不在白名单内' })
  resetPolicy!: NumberingResetPolicy

  @ApiNumberingRuleSegments()
  @IsArray({ message: '片段必须是数组' })
  @ArrayMinSize(1, { message: '至少需要一个片段' })
  @ArrayMaxSize(32, { message: '片段数量不能超过 32' })
  @ValidateNested({ each: true })
  @Type(() => NumberingRuleSegmentInputDto, {
    discriminator: {
      property: 'type',
      subTypes: [
        { name: 'FIXED', value: NumberingFixedSegmentInputDto },
        { name: 'DATE', value: NumberingDateSegmentInputDto },
        { name: 'SEPARATOR', value: NumberingSeparatorSegmentInputDto },
        { name: 'SEQUENCE', value: NumberingSequenceSegmentInputDto },
        { name: 'RANDOM', value: NumberingRandomSegmentInputDto },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  segments!: NumberingRuleSegmentInput[]
}
