import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'
import {
  FUND_WITHDRAWAL_STATUS_FILTER_VALUES,
  FUND_WITHDRAWAL_STATUS_VALUES,
  type FundWithdrawalStatusFilterValue,
  type FundWithdrawalStatusValue,
} from './fund-withdrawal.contract'

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,27})(?:\.\d{1,2})?$/u
const NON_BLANK_PATTERN = /\S/u

export class FundWithdrawalIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') id!: string
}

export class CreateFundWithdrawalDto {
  @ApiProperty({
    type: 'string',
    pattern: '^(?:0|[1-9]\\d{0,27})(?:\\.\\d{1,2})?$',
    example: '100.00',
    description: '人民币金额，必须大于 0，最多两位小数。账户允许负余额，不做余额下限校验。',
  })
  @IsString() @Matches(AMOUNT_PATTERN) amount!: string
}

export class RejectFundWithdrawalDto {
  @ApiProperty({ maxLength: 500, description: '拒绝原因，必填。' })
  @IsString() @Matches(NON_BLANK_PATTERN) @MaxLength(500) reason!: string
  @ApiProperty({ type: 'integer', minimum: 1, description: '客户端读到的申请版本号。' })
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class ApproveFundWithdrawalDto {
  @ApiProperty({ format: 'uuid', description: '财务上传并预览后的付款截图媒体资产 id。' })
  @IsUUID('4') paymentProofMediaAssetId!: string
  @ApiProperty({ type: 'integer', minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number
}

export class FundWithdrawalListQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @ApiPropertyOptional({ enum: FUND_WITHDRAWAL_STATUS_FILTER_VALUES, default: 'ALL' })
  @IsOptional() @IsIn(FUND_WITHDRAWAL_STATUS_FILTER_VALUES) status?: FundWithdrawalStatusFilterValue
}

export class FundWithdrawalProofDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ description: '自动生成的展示名：用户展示名-提款{金额}元-YYYYMMDD。' }) fileName!: string
  @ApiProperty({ type: 'string', description: '上传时间，ISO 8601。' }) uploadedAt!: string
}

export class FundWithdrawalDto {
  @ApiProperty({ format: 'uuid' }) id!: string
  @ApiProperty({ type: 'integer', description: '乐观锁版本号；审批写操作必须回传。' }) version!: number
  @ApiProperty() withdrawalNo!: string
  @ApiProperty({ format: 'uuid' }) userId!: string
  @ApiProperty() applicantName!: string
  @ApiProperty() applicantUsername!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) applicantAvatarUrl!: string | null
  @ApiProperty({ type: 'string' }) amount!: string
  @ApiProperty() currency!: string
  @ApiProperty({ enum: FUND_WITHDRAWAL_STATUS_VALUES }) status!: FundWithdrawalStatusValue
  @ApiProperty({ type: 'string', description: '申请人账户当前余额（人民币，允许为负），仅展示，不参与审批判断。' }) accountBalance!: string
  @ApiProperty({ type: 'string', description: '提交时间，ISO 8601。' }) submittedAt!: string
  @ApiPropertyOptional({ type: 'string', nullable: true }) reviewedAt!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reviewerName!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) reviewerAvatarUrl!: string | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) rejectReason!: string | null
  @ApiPropertyOptional({ type: FundWithdrawalProofDto, nullable: true }) paymentProof!: FundWithdrawalProofDto | null
  @ApiPropertyOptional({ type: 'string', nullable: true }) fundPostingBatchNo!: string | null
}

export class FundWithdrawalPageDto {
  @ApiProperty({ type: [FundWithdrawalDto] }) items!: FundWithdrawalDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}

export class FundWithdrawalProofUploadDto {
  @ApiProperty({ format: 'uuid' }) mediaAssetId!: string
  @ApiProperty({ description: '自动生成的展示名。' }) fileName!: string
}
