import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'

import { ShipmentLoadGroupStatus } from '../../../generated/prisma/enums'
import { IsUnicodeCodePointLength } from '../../auth/dto/unicode-code-point-length.validator'
import { MAX_LOAD_GROUP_MEMBERS, MIN_LOAD_GROUP_MEMBERS } from './shipment-load-group.logic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class CreateShipmentLoadGroupDto {
  @ApiProperty({ type: [String], format: 'uuid', minItems: MIN_LOAD_GROUP_MEMBERS, maxItems: MAX_LOAD_GROUP_MEMBERS })
  @IsArray()
  @ArrayMinSize(MIN_LOAD_GROUP_MEMBERS)
  @ArrayMaxSize(MAX_LOAD_GROUP_MEMBERS)
  @IsUUID('4', { each: true })
  shipmentIds!: string[]

  @ApiProperty({ type: 'string', format: 'uuid', description: '组主货件；装柜行只关联该货件' })
  @Matches(UUID_PATTERN)
  primaryShipmentId!: string

  @ApiProperty({ type: 'string', format: 'uuid', description: '唯一请求标识；重试必须复用相同载荷' })
  @IsUUID('4')
  requestKey!: string
}

export class ReleaseShipmentLoadGroupDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expectedVersion!: number

  @ApiPropertyOptional({ type: 'string', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @IsUnicodeCodePointLength(0, 500)
  reason?: string | null
}

export class ShipmentLoadGroupIdParamDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @Matches(UUID_PATTERN)
  groupId!: string
}

export class ShipmentLoadGroupMemberDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly shipmentId!: string
  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 }) readonly shipmentNo!: string | null
  @ApiProperty({ type: 'string', nullable: true }) readonly shippingMarkText!: string | null
  @ApiProperty({ type: 'boolean' }) readonly isPrimary!: boolean
}

export class ShipmentLoadGroupDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly purchaseOrderId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly ownerSalesOrderId!: string
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly primaryShipmentId!: string
  @ApiProperty({ enum: ShipmentLoadGroupStatus }) readonly status!: ShipmentLoadGroupStatus
  @ApiProperty({ minimum: 1 }) readonly version!: number
  @ApiProperty({ type: () => [ShipmentLoadGroupMemberDto] }) readonly members!: readonly ShipmentLoadGroupMemberDto[]
}
