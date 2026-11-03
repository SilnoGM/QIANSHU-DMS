import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'

import {
  ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH,
  ADVERTISING_ACCOUNT_TYPE_VALUES,
  ADVERTISING_RECHARGE_CURRENCY_VALUES,
  ADVERTISING_RECHARGE_REASON_MAX_LENGTH,
  ADVERTISING_RECHARGE_REMARK_MAX_LENGTH,
  ADVERTISING_RECHARGE_STATUS_FILTER_VALUES,
  ADVERTISING_RECHARGE_STATUS_VALUES,
  type AdvertisingAccountTypeValue,
  type AdvertisingRechargeCurrencyValue,
  type AdvertisingRechargeStatusFilterValue,
  type AdvertisingRechargeStatusValue,
} from './advertising-recharge.contract'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u
const NON_BLANK_PATTERN = /\S/u

export class AdvertisingRechargeIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class CreateAdvertisingRechargeDto {
  @ApiProperty({ enum: ADVERTISING_ACCOUNT_TYPE_VALUES, description: '个人户必须上传收款二维码，非个人户不接受该字段。' })
  @IsIn(ADVERTISING_ACCOUNT_TYPE_VALUES) accountType!: AdvertisingAccountTypeValue

  @ApiProperty({ maxLength: ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH, example: '千树-美国投放户' })
  @IsString() @Matches(NON_BLANK_PATTERN) @MaxLength(ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH) adAccountName!: string

  @ApiProperty({ maxLength: ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH, example: 'act_1234567890' })
  @IsString() @Matches(NON_BLANK_PATTERN) @MaxLength(ADVERTISING_ACCOUNT_TEXT_MAX_LENGTH) adAccountNo!: string

  @ApiProperty({
    type: 'string',
    pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$',
    example: '500.00',
    description: '计划充值金额，必须大于 0，最多两位小数。',
  })
  @IsString() @Matches(AMOUNT_PATTERN) rechargeAmount!: string

  @ApiPropertyOptional({ enum: ADVERTISING_RECHARGE_CURRENCY_VALUES, default: 'USD', description: '充值金额币种，缺省美元。' })
  @IsOptional() @IsIn(ADVERTISING_RECHARGE_CURRENCY_VALUES) rechargeCurrency?: AdvertisingRechargeCurrencyValue

  @ApiPropertyOptional({ format: 'uuid', description: '个人户收款二维码媒体资产 id，由二维码上传接口返回。' })
  @IsOptional() @IsUUID('4') paymentQrMediaAssetId?: string

  @ApiPropertyOptional({ maxLength: ADVERTISING_RECHARGE_REMARK_MAX_LENGTH })
  @IsOptional() @IsString() @MaxLength(ADVERTISING_RECHARGE_REMARK_MAX_LENGTH) remark?: string
}

export class AdvertisingRechargeVersionDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '客户端读到的申请版本号。' })
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class RejectAdvertisingRechargeDto extends AdvertisingRechargeVersionDto {
  @ApiProperty({ maxLength: ADVERTISING_RECHARGE_REASON_MAX_LENGTH, description: '驳回原因，必填。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @MaxLength(ADVERTISING_RECHARGE_REASON_MAX_LENGTH) reason!: string
}

export class VoidAdvertisingRechargeDto extends AdvertisingRechargeVersionDto {
  @ApiProperty({ maxLength: ADVERTISING_RECHARGE_REASON_MAX_LENGTH, description: '作废原因，必填；资金批次按原金额整单冲正。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @MaxLength(ADVERTISING_RECHARGE_REASON_MAX_LENGTH) reason!: string
}

export class PayAdvertisingRechargeDto extends AdvertisingRechargeVersionDto {
  @ApiProperty({
    type: 'string',
    pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$',
    example: '3680.00',
    description: '财务实际支付的 CNY 金额，按申请人分成比例分摊到个人与公司账户。',
  })
  @IsString() @Matches(AMOUNT_PATTERN) paymentAmountCny!: string

  @ApiProperty({ format: 'uuid', description: '财务上传并预览后的付款截图媒体资产 id。' })
  @IsUUID('4') paymentProofMediaAssetId!: string
}

export class AdvertisingRechargeListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: ADVERTISING_RECHARGE_STATUS_FILTER_VALUES, default: 'ALL' })
  @IsOptional() @IsIn(ADVERTISING_RECHARGE_STATUS_FILTER_VALUES) status?: AdvertisingRechargeStatusFilterValue
  @ApiPropertyOptional({ maxLength: 128, description: '按单号、广告账户名称或广告账户编号查询；财务列表还可按申请人姓名查询。' })
  @IsOptional() @IsString() @MaxLength(128) keyword?: string
}

export class AdvertisingRechargeMediaDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ description: '上传时的展示文件名。' }) fileName!: string
  @ApiProperty({ type: 'string', description: '上传时间，ISO 8601。' }) uploadedAt!: string
}

export class AdvertisingRechargePersonDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty() name!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) avatarUrl!: string | null
}

export class AdvertisingRechargePaymentDto {
  @ApiProperty({ type: 'string', description: '财务实付人民币金额。' }) amountCny!: string
  @ApiProperty({ type: AdvertisingRechargeMediaDto }) proof!: AdvertisingRechargeMediaDto
  @ApiProperty({ type: 'string', description: '付款时间，ISO 8601。' }) paidAt!: string
  @ApiProperty({ type: AdvertisingRechargePersonDto }) paidBy!: AdvertisingRechargePersonDto
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '资金批次号。' }) fundPostingBatchNo!: string | null
}

export class AdvertisingRechargeRejectDto {
  @ApiProperty({ type: 'string' }) reviewedAt!: string
  @ApiProperty({ type: AdvertisingRechargePersonDto }) reviewedBy!: AdvertisingRechargePersonDto
  @ApiProperty() reason!: string
}

export class AdvertisingRechargeVoidDto {
  @ApiProperty({ type: 'string' }) voidedAt!: string
  @ApiProperty({ type: AdvertisingRechargePersonDto }) voidedBy!: AdvertisingRechargePersonDto
  @ApiProperty() reason!: string
  @ApiPropertyOptional({ type: 'string', nullable: true, description: '冲正资金批次号。' }) reversalBatchNo!: string | null
}

export class AdvertisingRechargeDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', description: '乐观锁版本号；所有写操作必须回传。' }) version!: number
  @ApiProperty() rechargeNo!: string
  @ApiProperty({ enum: ADVERTISING_RECHARGE_STATUS_VALUES }) status!: AdvertisingRechargeStatusValue
  @ApiProperty({ enum: ADVERTISING_ACCOUNT_TYPE_VALUES }) accountType!: AdvertisingAccountTypeValue
  @ApiProperty() adAccountName!: string
  @ApiProperty() adAccountNo!: string
  @ApiProperty({ type: 'string' }) rechargeAmount!: string
  @ApiProperty({ enum: ADVERTISING_RECHARGE_CURRENCY_VALUES }) rechargeCurrency!: AdvertisingRechargeCurrencyValue
  @ApiPropertyOptional({ type: 'string', nullable: true }) remark!: string | null
  @ApiProperty({ type: AdvertisingRechargePersonDto }) applicant!: AdvertisingRechargePersonDto
  @ApiProperty({ type: 'string', description: '提交时间，ISO 8601。' }) submittedAt!: string
  @ApiPropertyOptional({ type: AdvertisingRechargeMediaDto, nullable: true }) paymentQr!: AdvertisingRechargeMediaDto | null
  @ApiPropertyOptional({ type: AdvertisingRechargePaymentDto, nullable: true }) payment!: AdvertisingRechargePaymentDto | null
  @ApiPropertyOptional({ type: AdvertisingRechargeRejectDto, nullable: true }) reject!: AdvertisingRechargeRejectDto | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) withdrawnAt!: string | null
  @ApiPropertyOptional({ type: AdvertisingRechargeVoidDto, nullable: true }) void!: AdvertisingRechargeVoidDto | null
}

export class AdvertisingRechargeStatusCountDto {
  @ApiProperty({ enum: ADVERTISING_RECHARGE_STATUS_VALUES }) status!: AdvertisingRechargeStatusValue
  @ApiProperty({ type: 'integer', minimum: 0 }) count!: number
}

export class AdvertisingRechargePageDto {
  @ApiProperty({ type: [AdvertisingRechargeDto] }) items!: AdvertisingRechargeDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
  @ApiProperty({
    type: [AdvertisingRechargeStatusCountDto],
    description: '同一数据范围下的各状态数量；与当前分页、状态筛选相互独立',
  }) statusCounts!: AdvertisingRechargeStatusCountDto[]
}

export class AdvertisingRechargeMediaUploadDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ description: '自动生成的展示文件名。' }) fileName!: string
}
