import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class ContainerSourceFileIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}
export class ContainerSourceFileDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty() originalFilename!: string
  @ApiProperty({ enum: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] }) mimeType!: string
  @ApiProperty({ description: 'File size in bytes as an integer string.' }) sizeBytes!: string
}
