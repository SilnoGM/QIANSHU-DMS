import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString, IsUUID, Matches } from 'class-validator'

import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'

const WAREHOUSE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

export class SalesOrderTerminationShipmentDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly shipmentNo!: string | null
  @ApiProperty({ type: 'integer' }) readonly partNumber!: number
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'string' }) readonly status!: string
  @ApiProperty({ type: 'string' }) readonly viewStatus!: string
  @ApiProperty({ type: 'boolean', description: '是否已装柜；已装柜货件释放时走海外仓' }) readonly loaded!: boolean
  @ApiProperty({ type: 'boolean', description: '是否仍归原销售单且未签收，需要释放' }) readonly pending!: boolean
  @ApiProperty({ type: 'boolean' }) readonly releasable!: boolean
  @ApiProperty({ type: 'string', nullable: true }) readonly blockedReason!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly storageStatus!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly ownerType!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) readonly deliveredAt!: string | null
}

export class SalesOrderTerminationContextDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly orderId!: string
  @ApiProperty({ type: 'string' }) readonly orderStatus!: string
  @ApiProperty({ type: 'string' }) readonly fulfillmentStatus!: string
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly pendingReceiptCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly pendingShipmentCount!: number
  @ApiProperty({ type: 'integer', minimum: 0 }) readonly processedShipmentCount!: number
  @ApiProperty({ type: 'boolean' }) readonly allShipmentsProcessed!: boolean
  @ApiProperty({ type: 'boolean' }) readonly canTerminate!: boolean
  @ApiProperty({ type: 'string', nullable: true }) readonly blockedReason!: string | null
  @ApiProperty({ type: () => [SalesOrderTerminationShipmentDto] }) readonly shipments!: readonly SalesOrderTerminationShipmentDto[]
}

export class SalesOrderTerminationRequestDto {
  @ApiProperty({ type: 'string', maxLength: 500 })
  @IsString()
  @IsUnicodeCodePointLength(1, 500)
  reason!: string

  @ApiProperty({ type: [String], format: 'uuid', required: false, description: '需要释放进寄仓的货件；为空表示全部货件已处理' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  shipmentIds?: string[]

  @ApiProperty({ type: 'string', maxLength: 64, required: false, description: '已装柜货件统一使用的海外仓；存在已装柜待释放货件时必填' })
  @IsOptional()
  @Matches(WAREHOUSE_VALUE_PATTERN)
  overseasWarehouseValue?: string
}
