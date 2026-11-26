import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsInt, Max, Min } from 'class-validator'

export class PurchaseAutoReviewSettingActorDto {
  @ApiProperty({ type: 'string', format: 'uuid' }) readonly id!: string
  @ApiProperty({ type: 'string' }) readonly displayName!: string
  @ApiProperty({ type: 'string', nullable: true }) readonly avatarUrl!: string | null
}

export class PurchaseAutoReviewSettingDto {
  @ApiProperty({ type: 'boolean', description: '开启后仅对此后新建的采购单生效。' })
  readonly enabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 1, description: '设置版本，更新时必须回传。' })
  readonly version!: number

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  readonly updatedAt!: string | null

  @ApiProperty({ type: PurchaseAutoReviewSettingActorDto, nullable: true })
  readonly updatedBy!: PurchaseAutoReviewSettingActorDto | null

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, description: '扫描任务最近一次运行的数据库时间。' })
  readonly lastScanAt!: string | null

  @ApiProperty({ type: 'integer', minimum: 0, description: '待处理与处理中的任务数。' })
  readonly pendingJobCount!: number

  @ApiProperty({ type: 'integer', minimum: 0, description: '已转人工的失败任务数。' })
  readonly failedJobCount!: number
}

export class PurchaseAutoReviewSettingUpdateRequestDto {
  @ApiProperty({ type: 'boolean' })
  @IsBoolean()
  enabled!: boolean

  @ApiProperty({ type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion!: number
}
