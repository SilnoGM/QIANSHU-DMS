import { ApiProperty } from '@nestjs/swagger'

import { UserStatus } from '../../../generated/prisma/enums'

export class AdminUserProfileDto {
  @ApiProperty({ type: 'string', maxLength: 254, nullable: true })
  email!: string | null

  @ApiProperty({ type: 'string', maxLength: 16, nullable: true })
  mobileE164!: string | null

  @ApiProperty({ type: 'string', maxLength: 2048, nullable: true })
  avatarUrl!: string | null

  @ApiProperty({ type: 'string', maxLength: 2000, nullable: true })
  remark!: string | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string
}

export class UserDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  username!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  displayName!: string

  @ApiProperty({ type: 'string', enum: [UserStatus.ACTIVE, UserStatus.DISABLED] })
  status!: UserStatus

  @ApiProperty({ type: 'boolean' })
  mustChangePassword!: boolean

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    uniqueItems: true,
  })
  roleIds!: string[]

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  lastLoginAt!: string | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt!: string

  @ApiProperty({ type: () => AdminUserProfileDto })
  profile!: AdminUserProfileDto
}

export class UserPageDto {
  @ApiProperty({ type: [UserDto] })
  items!: UserDto[]

  @ApiProperty({ type: 'integer', minimum: 1 })
  page!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100 })
  pageSize!: number

  @ApiProperty({ type: 'integer', minimum: 0 })
  total!: number
}
