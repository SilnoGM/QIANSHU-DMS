import { ApiProperty } from '@nestjs/swagger'

export class CurrentUserProfileDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  userId!: string

  @ApiProperty({ type: 'string', maxLength: 254, nullable: true })
  email!: string | null

  @ApiProperty({ type: 'string', maxLength: 16, nullable: true })
  mobileE164!: string | null

  @ApiProperty({ type: 'string', maxLength: 2048, nullable: true })
  avatarUrl!: string | null

  @ApiProperty({ type: 'string', maxLength: 3, nullable: true, description: '出单人前缀；最多 3 个汉字' })
  issuerPrefix!: string | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}
