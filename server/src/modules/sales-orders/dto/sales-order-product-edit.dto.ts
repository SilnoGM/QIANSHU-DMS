import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { SalesOrderLineInputDto } from './sales-order-create.dto'

export class SalesOrderExistingLineTargetDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID('4')
  lineId!: string

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 2_147_483_647 })
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  desiredQuantity!: number
}

export class SalesOrderProductsUpdateRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  confirmDepositReduction!: boolean

  @ApiProperty({ type: () => [SalesOrderExistingLineTargetDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderExistingLineTargetDto)
  existingLines!: SalesOrderExistingLineTargetDto[]

  @ApiProperty({ type: () => [SalesOrderLineInputDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLineInputDto)
  newLines!: SalesOrderLineInputDto[]
}
