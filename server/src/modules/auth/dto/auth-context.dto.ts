import { ApiProperty } from '@nestjs/swagger'

export class AuthUserDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  username!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  displayName!: string

  @ApiProperty({ type: 'boolean' })
  mustChangePassword!: boolean
}

export class AuthSessionDto {
  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  lastActivityAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  idleExpiresAt!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  absoluteExpiresAt!: string
}

/**
 * 前端恢复身份所需的完整、非敏感快照。
 *
 * Session id、Cookie、token、Hash 与密码均不属于响应模型；permissions 的去重与
 * 排序由读取实时权限的业务服务保证，Schema 使用 uniqueItems 固化无重复契约。
 */
export class AuthContextDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto

  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    uniqueItems: true,
  })
  permissions!: string[]

  @ApiProperty({ type: AuthSessionDto })
  session!: AuthSessionDto
}
