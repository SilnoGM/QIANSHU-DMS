import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import {
  MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH,
  MACHINE_VIEWING_FEEDBACK_MAX_LENGTH,
  MACHINE_VIEWING_HOUR_MAX,
  MACHINE_VIEWING_HOUR_MIN,
  MACHINE_VIEWING_MACHINE_TYPE_VALUES,
  MACHINE_VIEWING_PERIOD_VALUES,
  MACHINE_VIEWING_SITE_VALUES,
  MACHINE_VIEWING_STATUS_VALUES,
  type MachineViewingMachineTypeValue,
  type MachineViewingPeriodValue,
  type MachineViewingSiteValue,
  type MachineViewingStatusValue,
} from './machine-viewing.contract'

export class MachineViewingListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

/**
 * 创建请求传「月 + 日」而不是完整日期：年份口径只由服务端按上海自然日推断，
 * 客户端时钟或时区不参与，避免同一份输入在不同机器上落到不同年份。
 */
export class CreateMachineViewingDto {
  @ApiProperty({ enum: MACHINE_VIEWING_SITE_VALUES, description: '看机地点。' })
  @IsIn(MACHINE_VIEWING_SITE_VALUES) site!: MachineViewingSiteValue

  @ApiProperty({ enum: MACHINE_VIEWING_MACHINE_TYPE_VALUES, description: '看机机型。' })
  @IsIn(MACHINE_VIEWING_MACHINE_TYPE_VALUES) machineType!: MachineViewingMachineTypeValue

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 12, description: '预约月份，不选择年份。' })
  @IsInt() @Min(1) @Max(12) appointmentMonth!: number

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 31, description: '预约日；服务端按推断年份校验当月天数。' })
  @IsInt() @Min(1) @Max(31) appointmentDay!: number

  @ApiProperty({ enum: MACHINE_VIEWING_PERIOD_VALUES, description: '上午或下午。' })
  @IsIn(MACHINE_VIEWING_PERIOD_VALUES) period!: MachineViewingPeriodValue

  @ApiPropertyOptional({
    type: 'integer',
    minimum: MACHINE_VIEWING_HOUR_MIN,
    maximum: MACHINE_VIEWING_HOUR_MAX,
    description: '选填；只表示所选时段内第几点。不传表示只约定上午/下午。',
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(MACHINE_VIEWING_HOUR_MIN) @Max(MACHINE_VIEWING_HOUR_MAX) hour?: number

  @ApiProperty({ maxLength: MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH, example: '陈先生' })
  @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH) customerName!: string

  @ApiPropertyOptional({ maxLength: MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH, example: '0912-345-678' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH) customerPhone?: string

  @ApiProperty({ maxLength: MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH, description: '默认为当前用户的出单人前缀，可修改。' })
  @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH) contactPerson!: string
}

export class MachineViewingPersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiProperty({ type: 'string', nullable: true }) avatarUrl!: string | null
}

export class MachineViewingDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ maxLength: 64, example: 'MV/20261106-0001', description: '看机预约编号，由规则 MACHINE_VIEWING_NO 在提交时派发。' })
  appointmentNo!: string
  @ApiProperty({ enum: MACHINE_VIEWING_SITE_VALUES }) site!: MachineViewingSiteValue
  @ApiProperty({ enum: MACHINE_VIEWING_MACHINE_TYPE_VALUES }) machineType!: MachineViewingMachineTypeValue
  @ApiProperty({ type: 'string', format: 'date', example: '2026-11-05', description: '已按创建时刻推断年份的实际日期。' })
  appointmentDate!: string
  @ApiProperty({ enum: MACHINE_VIEWING_PERIOD_VALUES }) period!: MachineViewingPeriodValue
  @ApiProperty({ type: 'integer', nullable: true, minimum: MACHINE_VIEWING_HOUR_MIN, maximum: MACHINE_VIEWING_HOUR_MAX })
  hour!: number | null
  @ApiProperty() customerName!: string
  @ApiProperty({ type: 'string', nullable: true }) customerPhone!: string | null
  @ApiProperty() contactPerson!: string
  @ApiProperty({
    enum: MACHINE_VIEWING_STATUS_VALUES,
    description: '预约状态；提交后默认为 PENDING_APPOINTMENT，状态流转入口尚未开放。',
  })
  status!: MachineViewingStatusValue
  @ApiProperty({ type: 'string', nullable: true, maxLength: MACHINE_VIEWING_FEEDBACK_MAX_LENGTH })
  feedback!: string | null
  @ApiProperty({ type: MachineViewingPersonDto }) createdBy!: MachineViewingPersonDto
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt!: string
}

export class MachineViewingPageDto {
  @ApiProperty({ type: [MachineViewingDto] }) items!: MachineViewingDto[]
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
  @ApiProperty() total!: number
}
