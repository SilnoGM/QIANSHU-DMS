import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches } from 'class-validator'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export class NotificationContentMediaUploadDto {
  @ApiProperty({ format: 'uuid' }) assetId!: string
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] }) mimeType!: string
  @ApiProperty({ type: 'string', description: '字节数（BigInt 以字符串传输）' }) sizeBytes!: string
  @ApiProperty({ type: 'integer' }) width!: number
  @ApiProperty({ type: 'integer' }) height!: number
  @ApiProperty() originalFilename!: string
}

export class NotificationContentMediaParamDto {
  @ApiProperty({ format: 'uuid' }) @IsString() @Matches(UUID_PATTERN) assetId!: string
}
