import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator'

export class AssistantChannelDto {
  @ApiProperty() enabled!: boolean
  @ApiProperty() tokenConfigured!: boolean
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) defaultQuietHours!: Record<string, unknown> | null
  @ApiProperty({ type: 'integer' }) version!: number
}

export class AssistantChannelUpdateDto {
  @ApiProperty() @IsBoolean() enabled!: boolean
  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true })
  @IsOptional()
  defaultQuietHours?: Record<string, unknown> | null

  @ApiProperty({ type: 'integer', minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class AssistantAccountDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty() appId!: string
  @ApiProperty({ type: 'string', nullable: true }) wxidMasked!: string | null
  @ApiProperty({ type: 'string', nullable: true }) nickname!: string | null
  @ApiProperty({ type: 'string', nullable: true }) avatarUrl!: string | null
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE', 'REQUIRES_LOGIN', 'DISABLED'] }) status!: string
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastOnlineAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastLoginAt!: string | null
  @ApiProperty({ type: 'integer' }) version!: number
}

export class AssistantAccountCreateDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @Matches(/\S/u) name!: string
  @ApiProperty({ maxLength: 16 }) @IsString() regionId!: string
  @ApiPropertyOptional({ enum: ['ipad', 'mac'] }) @IsOptional() @IsIn(['ipad', 'mac']) type?: 'ipad' | 'mac'
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() proxyIp?: string | null
}

export class AssistantAccountUpdateDto {
  @ApiPropertyOptional({ maxLength: 64 }) @IsOptional() @IsString() name?: string
  @ApiPropertyOptional({ maxLength: 16 }) @IsOptional() @IsString() regionId?: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) @IsOptional() @IsString() proxyIp?: string | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
  @ApiProperty({ type: 'integer', minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number
}

export class AssistantLoginStatusQueryDto {
  @ApiProperty() @IsString() @Matches(/\S/u) uuid!: string
}

export class AssistantLoginQrDto {
  @ApiProperty({ format: 'uuid' }) accountId!: string
  @ApiProperty() appId!: string
  @ApiProperty() uuid!: string
  @ApiProperty() qrImgBase64!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) expiresAt!: string | null
}

export class AssistantLoginStatusDto {
  @ApiProperty({ enum: ['WAITING', 'SCANNED', 'ONLINE', 'EXPIRED'] }) status!: string
  @ApiProperty({ type: 'string', nullable: true }) wxidMasked!: string | null
  @ApiProperty({ type: 'string', nullable: true }) nickname!: string | null
}

export class AssistantContactDto {
  @ApiProperty() wxid!: string
  @ApiProperty({ type: 'string', nullable: true }) nickname!: string | null
  @ApiProperty({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ type: 'string', nullable: true }) alias!: string | null
  @ApiProperty({ type: 'string', nullable: true }) avatarUrl!: string | null
}

export class AssistantBindingDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiProperty() userName!: string
  @ApiProperty({ format: 'uuid' }) accountId!: string
  @ApiProperty() accountName!: string
  @ApiProperty() wxidMasked!: string
  @ApiProperty({ type: 'string', nullable: true }) wechatNickname!: string | null
  @ApiProperty({ enum: ['ACTIVE', 'INVALID', 'DISABLED'] }) status!: string
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) verifiedAt!: string | null
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) friendCheckedAt!: string | null
  @ApiProperty({ format: 'date-time' }) boundAt!: string
}

export class AssistantBindingPageDto {
  @ApiProperty({ type: () => [AssistantBindingDto] }) items!: AssistantBindingDto[]
  @ApiProperty({ type: 'integer' }) page!: number
  @ApiProperty({ type: 'integer' }) pageSize!: number
  @ApiProperty({ type: 'integer' }) total!: number
}

export class AssistantBindingCreateDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() userId!: string
  @ApiProperty({ maxLength: 128 }) @IsString() @Matches(/\S/u) wxid!: string
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() wechatNickname?: string
}

export class AssistantBindingQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() query?: string
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INVALID', 'DISABLED'] }) @IsOptional() @IsIn(['ACTIVE', 'INVALID', 'DISABLED']) status?: string
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
}

export class AssistantTargetDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() key!: string
  @ApiProperty() chatroomId!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) purpose!: string | null
  @ApiProperty() internalOnly!: boolean
  @ApiProperty({ nullable: true, type: 'integer' }) memberCount!: number | null
  @ApiProperty() enabled!: boolean
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true }) lastSyncedAt!: string | null
}

export class AssistantTargetUpdateDto {
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() name?: string
  @ApiPropertyOptional({ type: 'string', maxLength: 255, nullable: true }) @IsOptional() @ValidateIf((_object, value: unknown) => value !== null) @IsString() purpose?: string | null
  @ApiPropertyOptional() @IsOptional() @IsBoolean() internalOnly?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean
}

export class AssistantTestSendDto {
  @ApiProperty() accepted!: boolean
}

export class AssistantAccountQrDto {
  @ApiProperty() qrCodeBase64!: string
}

export class AssistantBindingCheckDto {
  @ApiProperty({ type: 'integer' }) checked!: number
  @ApiProperty({ type: 'integer' }) invalidated!: number
}

export class AssistantIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string
}

export class AssistantContactQueryDto {
  @ApiPropertyOptional({ maxLength: 128 }) @IsOptional() @IsString() query?: string
}
