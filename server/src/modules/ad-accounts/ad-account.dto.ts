import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export class AdAccountAssigneeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  displayName!: string
}

export class AdAccountDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', description: '猎豹广告账户 ID（纯数字，不含 act_ 前缀）' })
  accountId!: string

  @ApiProperty({ type: 'string' })
  accountName!: string

  @ApiProperty({ type: 'string', nullable: true, description: '开户主体（营业执照中文名称）' })
  companyCn!: string | null

  @ApiProperty({ type: 'integer' })
  accountStatus!: number

  @ApiProperty({ type: 'string', nullable: true })
  accountStatusText!: string | null

  @ApiProperty({ type: 'integer', nullable: true, description: '1 冻结 / 2 解冻；null 表示上游未返回' })
  freeze!: number | null

  @ApiProperty({ type: 'integer' })
  disableReason!: number

  @ApiProperty({ type: 'string', description: '花费上限（USD）' })
  spendCap!: string

  @ApiProperty({ type: 'string', description: '已花费金额（USD）' })
  amountSpent!: string

  @ApiProperty({ type: 'string', nullable: true, description: '日限额（USD）；null 表示未设置' })
  dailySpendLimit!: string | null

  @ApiProperty({ type: 'string', description: '封户取款金额（USD）' })
  disabledTransferAmount!: string

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: '可用余额（USD）= 花费上限 - 已花费 - 封户取款；无花费上限账户为 null',
  })
  availableBalance!: string | null

  @ApiProperty({ type: 'string', description: '最近 7 个完整自然日的日均消耗（USD）' })
  sevenDayAverage!: string

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: '预计可持续天数；余额已耗尽为 0，无上限或零消耗为 null（前端显示「—」）',
  })
  sustainableDays!: number | null

  @ApiProperty({ type: 'boolean', description: '可用余额是否低于预警阈值' })
  lowBalance!: boolean

  @ApiProperty({ type: 'number', description: '余额预警阈值（USD），与后端常量保持一致' })
  balanceAlertThreshold!: number

  @ApiProperty({ type: 'boolean', description: '上游本次未返回该账户，数据为上次同步快照' })
  vendorMissing!: boolean

  @ApiProperty({ type: 'string', format: 'date-time', description: '账户创建时间' })
  createdTime!: string

  @ApiProperty({ type: 'string', format: 'date-time', description: '猎豹侧数据刷新时间' })
  vendorUpdatedAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', description: '本系统最近一次同步时间' })
  lastSyncedAt!: string

  @ApiProperty({ type: AdAccountAssigneeDto, nullable: true })
  assignedUser!: AdAccountAssigneeDto | null
}

export class AdAccountListDto {
  @ApiProperty({ type: [AdAccountDto] })
  list!: AdAccountDto[]
}

export class AdAccountBalanceAlertSummaryDto {
  @ApiProperty({ type: 'integer', description: '当前用户绑定账户中余额低于阈值的数量' })
  mine!: number

  @ApiProperty({ type: 'integer', description: '全部账户中余额低于阈值的数量' })
  all!: number

  @ApiProperty({ type: 'number', description: '余额预警阈值（USD）' })
  threshold!: number
}

export class AssignableUsersQueryDto {
  @ApiPropertyOptional({ type: 'string', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string
}

export class AssignAdAccountRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID()
  userId!: string

  @ApiPropertyOptional({ type: 'boolean', description: '为 true 时允许抢占已绑定给其他用户的账户' })
  @IsOptional()
  @IsBoolean()
  replace?: boolean
}

export class AdAccountAssignmentResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  assignedUserId!: string
}

export class AdAccountReleaseResultDto {
  @ApiProperty({ type: 'boolean' })
  released!: boolean
}

export class SyncAdAccountsResultDto {
  @ApiProperty({ type: 'string', enum: ['completed', 'skipped'] })
  status!: 'completed' | 'skipped'

  @ApiPropertyOptional({ type: 'string', enum: ['disabled', 'already_running'] })
  reason?: 'disabled' | 'already_running'

  @ApiProperty({ type: 'boolean' })
  dryRun!: boolean

  @ApiProperty({ type: 'integer' })
  accounts!: number

  @ApiProperty({ type: 'integer' })
  missing!: number

  @ApiProperty({ type: 'integer' })
  spendRows!: number

  @ApiProperty({ type: 'integer' })
  alerts!: number

  @ApiProperty({ type: 'integer' })
  resets!: number

  @ApiProperty({ type: 'boolean', description: '本轮日消耗是否成功拉取；false 表示只更新了账户主数据' })
  spendSynced!: boolean
}
