import { ApiProperty } from '@nestjs/swagger'

/** 公开 Permission 目录只包含管理界面展示和授权选择所需的非敏感字段。 */
export class PermissionDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  code!: string

  @ApiProperty({ type: 'string', maxLength: 128 })
  name!: string

  @ApiProperty({ type: 'string', nullable: true })
  description!: string | null

  @ApiProperty({ type: 'boolean' })
  systemOnly!: boolean
}
