import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator'

import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import {
  MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH,
  MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH,
  MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH,
  MACHINE_VIEWING_FEEDBACK_MAX_LENGTH,
  MACHINE_VIEWING_HOUR_MAX,
  MACHINE_VIEWING_HOUR_MIN,
  MACHINE_VIEWING_MACHINE_TYPE_VALUES,
  MACHINE_VIEWING_PERIOD_VALUES,
  MACHINE_VIEWING_SITE_VALUES,
  MACHINE_VIEWING_STATUS_FILTER_VALUES,
  MACHINE_VIEWING_STATUS_VALUES,
  MACHINE_VIEWING_TRANSITION_TARGET_VALUES,
  type MachineViewingMachineTypeValue,
  type MachineViewingPeriodValue,
  type MachineViewingSiteValue,
  type MachineViewingStatusFilterValue,
  type MachineViewingStatusValue,
  type MachineViewingTransitionTargetValue,
} from './machine-viewing.contract'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export class MachineViewingListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number

  @ApiPropertyOptional({
    type: 'string',
    minLength: 1,
    maxLength: 128,
    description: '按预约编号、客户姓名、客户电话或业务对接人模糊搜索',
  })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, 128) keyword?: string

  @ApiPropertyOptional({ enum: MACHINE_VIEWING_STATUS_VALUES, description: '预约状态精确匹配。' })
  @IsOptional() @IsIn(MACHINE_VIEWING_STATUS_VALUES) status?: MachineViewingStatusValue

  @ApiPropertyOptional({ enum: MACHINE_VIEWING_SITE_VALUES, description: '看机地点精确匹配。' })
  @IsOptional() @IsIn(MACHINE_VIEWING_SITE_VALUES) site?: MachineViewingSiteValue

  @ApiPropertyOptional({ enum: MACHINE_VIEWING_MACHINE_TYPE_VALUES, description: '看机机型精确匹配。' })
  @IsOptional() @IsIn(MACHINE_VIEWING_MACHINE_TYPE_VALUES) machineType?: MachineViewingMachineTypeValue

  @ApiPropertyOptional({ type: 'string', format: 'date', description: '预约日期起（含），YYYY-MM-DD。' })
  @IsOptional() @Matches(DATE_ONLY_PATTERN) dateFrom?: string

  @ApiPropertyOptional({ type: 'string', format: 'date', description: '预约日期止（含），YYYY-MM-DD。' })
  @IsOptional() @Matches(DATE_ONLY_PATTERN) dateTo?: string
}

/** 状态计数复用列表筛选，但排除分页与状态本身，保证切换状态时数量不塌缩。 */
export class MachineViewingStatusCountsQueryDto extends OmitType(
  MachineViewingListQueryDto,
  ['page', 'pageSize', 'status'] as const,
) {}

export class MachineViewingStatusCountDto {
  @ApiProperty({ enum: MACHINE_VIEWING_STATUS_FILTER_VALUES }) value!: MachineViewingStatusFilterValue
  @ApiProperty() count!: number
}

export class MachineViewingStatusCountsDto {
  @ApiProperty({
    type: [MachineViewingStatusCountDto],
    description: '每个状态的数量，外加 ALL 的合计；关键词、地点、机型与日期筛选生效，状态筛选不生效。',
  })
  statuses!: MachineViewingStatusCountDto[]
}

export class MachineViewingIdParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4') id!: string
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

/**
 * 编辑使用完整日期而不是「月 + 日」：原预约可能跨年，重新按今天推断年份会把
 * 未改动的日期悄悄推到下一年。前端只在用户改过月/日时才重算年份。
 */
export class UpdateMachineViewingDto {
  @ApiProperty({ enum: MACHINE_VIEWING_SITE_VALUES, description: '看机地点。' })
  @IsIn(MACHINE_VIEWING_SITE_VALUES) site!: MachineViewingSiteValue

  @ApiProperty({ enum: MACHINE_VIEWING_MACHINE_TYPE_VALUES, description: '看机机型。' })
  @IsIn(MACHINE_VIEWING_MACHINE_TYPE_VALUES) machineType!: MachineViewingMachineTypeValue

  @ApiProperty({ type: 'string', format: 'date', description: '预约日期 YYYY-MM-DD，只能为今年或明年且不能早于今天。' })
  @Matches(DATE_ONLY_PATTERN) appointmentDate!: string

  @ApiProperty({ enum: MACHINE_VIEWING_PERIOD_VALUES, description: '上午或下午。' })
  @IsIn(MACHINE_VIEWING_PERIOD_VALUES) period!: MachineViewingPeriodValue

  @ApiPropertyOptional({
    type: 'integer',
    minimum: MACHINE_VIEWING_HOUR_MIN,
    maximum: MACHINE_VIEWING_HOUR_MAX,
    description: '选填；只表示所选时段内第几点。不传表示只保留上午/下午。',
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(MACHINE_VIEWING_HOUR_MIN) @Max(MACHINE_VIEWING_HOUR_MAX) hour?: number

  @ApiProperty({ maxLength: MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH, example: '陈先生' })
  @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CUSTOMER_NAME_MAX_LENGTH) customerName!: string

  @ApiPropertyOptional({ maxLength: MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH, example: '0912-345-678' })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CUSTOMER_PHONE_MAX_LENGTH) customerPhone?: string

  @ApiProperty({ maxLength: MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH })
  @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CONTACT_PERSON_MAX_LENGTH) contactPerson!: string
}

export class MachineViewingStatusTransitionDto {
  @ApiProperty({
    enum: MACHINE_VIEWING_TRANSITION_TARGET_VALUES,
    description: '目标状态：已预约、已反馈或已取消。',
  })
  @IsIn(MACHINE_VIEWING_TRANSITION_TARGET_VALUES) status!: MachineViewingTransitionTargetValue

  @ApiPropertyOptional({
    type: 'string',
    maxLength: MACHINE_VIEWING_FEEDBACK_MAX_LENGTH,
    description: '目标状态为已反馈时必填；已反馈状态下再次提交表示修改反馈。',
  })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_FEEDBACK_MAX_LENGTH) feedback?: string

  @ApiPropertyOptional({
    type: 'string',
    maxLength: MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH,
    description: '取消预约时选填；只写入审计，不落库到反馈字段。',
  })
  @IsOptional() @IsString() @IsUnicodeCodePointLength(1, MACHINE_VIEWING_CANCEL_REASON_MAX_LENGTH) cancelReason?: string
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
    description: '预约状态；提交后默认为 PENDING_APPOINTMENT，之后按 已预约 → 已反馈 顺序流转，或从待预约/已预约取消。',
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

export class MachineViewingManualNotificationTextDto {
  @ApiProperty({ type: 'string', nullable: true }) title!: string | null
  @ApiProperty() body!: string
}
