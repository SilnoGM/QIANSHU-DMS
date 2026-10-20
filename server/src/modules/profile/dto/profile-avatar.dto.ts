import { ApiProperty } from '@nestjs/swagger'
import { IsUUID } from 'class-validator'

export class ProfileAvatarUploadDto {
  @ApiProperty({ format: 'uuid' })
  mediaAssetId!: string

  @ApiProperty({ maxLength: 2048 })
  avatarUrl!: string
}

export class ProfileAvatarParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string
}
