import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class WecomUuidParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}

export class WecomUserIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string
}

export class WecomAppMemberParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string
}

export class WecomChannelDto {
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  defaultQuietHours!: Record<string, unknown> | null
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) updatedAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) updatedByName!: string | null
}

export class WecomChannelUpdateDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  @IsOptional()
  defaultQuietHours?: Record<string, unknown> | null
  @ApiProperty({ type: 'integer', minimum: 0 }) @IsInt() @Min(0) expectedVersion!: number
}

export class WecomAppDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() key!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) corpId!: string | null
  @ApiProperty({ type: 'integer', nullable: true }) agentId!: number | null
  @ApiProperty() isDefault!: boolean
  @ApiProperty() enabled!: boolean
  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'INVALID', 'DISABLED'] }) status!: string
  @ApiProperty() hasSecret!: boolean
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastCheckedAt!: string | null
  @ApiProperty({ type: 'string', nullable: true }) lastErrorCode!: string | null
  @ApiProperty({ type: 'string', nullable: true }) lastErrorMessage!: string | null
  @ApiProperty({ type: 'integer' }) eventCount!: number
  @ApiProperty({ type: 'integer' }) memberCount!: number
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string
}

export class WecomAppCreateDto {
  @ApiProperty({ maxLength: 32 }) @IsString() @Matches(/^[a-z][a-z0-9_-]{0,31}$/u) key!: string
  @ApiProperty({ maxLength: 32 }) @IsString() @Matches(/\S/u) @MaxLength(32) name!: string
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/\S/u) @MaxLength(64) corpId!: string
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  agentId!: number
  @ApiProperty({ maxLength: 512 }) @IsString() @Matches(/\S/u) @MaxLength(512) secret!: string
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDefault?: boolean
}

export class WecomAppUpdateDto {
  @ApiPropertyOptional({ maxLength: 32 }) @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(32) name?: string
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(64) corpId?: string
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 2_147_483_647 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  agentId?: number
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean
  @ApiProperty({ type: 'integer', minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class WecomAppSecretUpdateDto {
  @ApiProperty({ maxLength: 512 }) @IsString() @Matches(/\S/u) @MaxLength(512) secret!: string
}

export class WecomAppTestResultDto {
  @ApiProperty() ok!: boolean
  @ApiProperty() status!: string
  @ApiProperty({ type: 'string', nullable: true }) message!: string | null
}

export class WecomEventRoutesDto {
  @ApiProperty({ format: 'uuid' }) appId!: string
  @ApiProperty({ type: [String] }) eventTypes!: string[]
}

export class WecomEventRoutesUpdateDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsString({ each: true }) eventTypes!: string[]
}

export class WecomBindingDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiProperty() userName!: string
  @ApiProperty() username!: string
  @ApiProperty() wecomUserId!: string
  @ApiProperty({ type: 'string', nullable: true }) displayName!: string | null
  @ApiProperty({ enum: ['ACTIVE', 'INVALID', 'DISABLED'] }) status!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) verifiedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastTestSentAt!: string | null
}

export class WecomBindingCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string
  @ApiProperty({ maxLength: 128 }) @IsString() @Matches(/\S/u) @MaxLength(128) wecomUserId!: string
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @MaxLength(128) displayName?: string
}

export class WecomBindingVerifyDto {
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) content?: string
}

export class WecomMembershipDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiProperty() userName!: string
  @ApiProperty() username!: string
  @ApiProperty({ enum: ['ACTIVE', 'INVALID', 'DISABLED'] }) status!: string
  @ApiProperty({ enum: ['MANUAL', 'AGENT_GET'] }) source!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) verifiedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastSyncedAt!: string | null
}

export class WecomMembershipCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string
}

export class WecomTargetDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() key!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) purpose!: string | null
  @ApiProperty() enabled!: boolean
  @ApiProperty() internalOnly!: boolean
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastTestedAt!: string | null
  @ApiProperty({ type: 'integer' }) version!: number
  @ApiProperty({ type: 'string', format: 'date-time' }) updatedAt!: string
}

export class WecomTargetCreateDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/u) key!: string
  @ApiProperty({ maxLength: 128 }) @IsString() @Matches(/\S/u) @MaxLength(128) name!: string
  @ApiPropertyOptional({ maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) purpose?: string
  @ApiProperty({ maxLength: 128 }) @IsString() @Matches(/\S/u) @MaxLength(128) webhookKey!: string
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean
}

export class WecomTargetUpdateDto {
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(128) name?: string
  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) purpose?: string | null
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() @Matches(/\S/u) @MaxLength(128) webhookKey?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
  @ApiProperty({ type: 'integer', minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class WecomTestResultDto {
  @ApiProperty() ok!: boolean
  @ApiProperty({ type: 'string', nullable: true }) message!: string | null
}

export const WECOM_APP_STATUSES = ['PENDING', 'ACTIVE', 'INVALID', 'DISABLED'] as const
export const WECOM_BINDING_STATUSES = ['ACTIVE', 'INVALID', 'DISABLED'] as const
export const WECOM_MEMBERSHIP_SOURCES = ['MANUAL', 'AGENT_GET'] as const
