import { ApiProperty } from '@nestjs/swagger'

import { SalesOrderLineType } from '../../../generated/prisma/client'
import { SalesOrderListImageDto } from './sales-order-response.dto'

export class SalesOrderPendingPurchaseProductDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: '销售订单明细 ID' })
  readonly id!: string

  @ApiProperty({ type: 'string' })
  readonly productName!: string

  @ApiProperty({ enum: SalesOrderLineType })
  readonly lineType!: SalesOrderLineType

  @ApiProperty({ type: 'integer', minimum: 1 })
  readonly remainingQuantity!: number

  @ApiProperty({ type: () => SalesOrderListImageDto, nullable: true })
  readonly mainImage!: SalesOrderListImageDto | null
}

export class SalesOrderPendingPurchaseProductsDto {
  @ApiProperty({ type: () => SalesOrderPendingPurchaseProductDto, isArray: true })
  readonly items!: SalesOrderPendingPurchaseProductDto[]
}
