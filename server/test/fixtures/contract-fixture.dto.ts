import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator'

export class ContractFixtureItemDto {
  @ApiProperty()
  @IsString({ message: '必须是字符串' })
  @IsNotEmpty({ message: '不能为空' })
  name!: string
}

export class ContractFixtureDto {
  @ApiProperty()
  @IsString({ message: '必须是字符串' })
  @IsNotEmpty({ message: '不能为空' })
  name!: string

  @ApiProperty({ type: ContractFixtureItemDto, isArray: true })
  @IsArray({ message: '必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ContractFixtureItemDto)
  items!: ContractFixtureItemDto[]
}

export class ContractFixtureRecordDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  name!: string
}

export class ContractFixturePageDto {
  @ApiProperty({ type: ContractFixtureRecordDto, isArray: true })
  items!: ContractFixtureRecordDto[]

  @ApiProperty()
  page!: number

  @ApiProperty()
  pageSize!: number

  @ApiProperty()
  total!: number
}

export class ContractFixtureJobDto {
  @ApiProperty()
  jobId!: string

  @ApiProperty()
  status!: string
}
