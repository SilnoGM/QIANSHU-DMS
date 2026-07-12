import { Type } from 'class-transformer'
import {
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator'

export class ContractFixtureItemDto {
  @IsString({ message: '必须是字符串' })
  @IsNotEmpty({ message: '不能为空' })
  name!: string
}

export class ContractFixtureDto {
  @IsString({ message: '必须是字符串' })
  @IsNotEmpty({ message: '不能为空' })
  name!: string

  @IsArray({ message: '必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ContractFixtureItemDto)
  items!: ContractFixtureItemDto[]
}
