import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'
import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { ContainerLoadingItemIdDto } from './container-batch.dto'
import type { OceanChangeKind } from './operations-ocean-change.normalizer'
import { OperationsOceanContainerLineDto } from './operations-ocean-container.dto'

export class OperationsOceanContainerChangeIdDto extends ContainerLoadingItemIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') changeId!: string
}
export class OperationsOceanContainerChangeResultDto {
  @ApiProperty({ type: OperationsOceanContainerLineDto }) line!: OperationsOceanContainerLineDto
  @ApiProperty({ format: 'uuid', description: 'Immutable audit record ID for this change or reversal.' }) changeId!: string
}
export class OperationsOceanContainerUndoChangeDto {
  @ApiProperty({ format: 'uuid', description: 'Unique undo intent; reuse only for identical retries.' }) @IsUUID('4') requestKey!: string
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
}
export class OperationsOceanContainerChangeDto {
  @ApiProperty({ format: 'uuid', description: 'Unique immutable change intent; reuse only for identical retries.' }) @IsUUID('4') requestKey!: string
  @ApiProperty({ enum: ['RECIPIENT', 'COD'] }) @IsIn(['RECIPIENT', 'COD']) kind!: OceanChangeKind
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) @Max(2_147_483_647) expectedVersion!: number
  @ApiProperty({ type: Boolean, enum: [true], description: 'Must explicitly confirm that the copied modification was sent to the Shunlianhang group.' }) @IsBoolean() @Equals(true) notificationConfirmed!: boolean
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128, description: 'Required (nullable) for RECIPIENT; forbidden for COD.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) recipientName?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128, description: 'Required (nullable) for RECIPIENT; forbidden for COD.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 128) recipientPhone?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'Required (nullable) for RECIPIENT; forbidden for COD.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 2000) recipientAddress?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000, description: 'Required (nullable) for RECIPIENT; forbidden for COD.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(0, 2000) remark?: string | null
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 31, description: 'Required (nullable) for COD; nonnegative TWD decimal(30,2), null clears; forbidden for RECIPIENT.' }) @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 31) codAmountTwd?: string | null
}
