import { ApiProperty } from '@nestjs/swagger'
import { ArrayUnique, IsArray, IsUUID } from 'class-validator'

export class ReplaceRolePermissionsRequestDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    uniqueItems: true,
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  permissionIds!: string[]
}
