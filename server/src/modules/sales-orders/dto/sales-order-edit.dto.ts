import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { SalesOrderCustomerInputDto } from './sales-order-create.dto'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/**
 * 客户信息与出单信息共用一次原子保存：两段都可全状态修改，因此不按状态拆分请求，
 * 也不允许只提交其中一段。服务端按字段实际变化决定写哪些列、历史与审计。
 */
export class SalesOrderInfoUpdateRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiProperty({ type: 'string', minLength: 1, maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: () => SalesOrderCustomerInputDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SalesOrderCustomerInputDto)
  customer!: SalesOrderCustomerInputDto

  @ApiProperty({ type: 'string', format: 'date' })
  @IsString()
  @Matches(DATE_PATTERN)
  orderDate!: string

  @ApiPropertyOptional({
    type: 'string',
    maxLength: 1000,
    nullable: true,
    description: '订单备注；显式传 null 表示清空',
  })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(1, 1000)
  remark?: string | null
}
