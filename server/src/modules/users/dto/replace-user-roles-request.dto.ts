import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsUUID } from 'class-validator'

export class ReplaceUserRolesRequestDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
  })
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds!: string[]
}
