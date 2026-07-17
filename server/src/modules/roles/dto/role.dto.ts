import { ApiProperty } from '@nestjs/swagger'

/** Role 响应不返回 UserRole、审计或其他内部关系，只公开扁平权限 ID 快照。 */
export class RoleDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  code!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  description!: string | null

  @ApiProperty({ type: 'boolean' })
  isSystem!: boolean

  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    uniqueItems: true,
  })
  permissionIds!: string[]
}
