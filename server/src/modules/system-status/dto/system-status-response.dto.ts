import { ApiProperty } from '@nestjs/swagger'

export const SYSTEM_STATUS_LEVELS = [
  'ok',
  'warning',
  'critical',
  'unknown',
] as const

export type SystemStatusLevel = (typeof SYSTEM_STATUS_LEVELS)[number]

export class SystemBackendServiceDto {
  @ApiProperty({ enum: SYSTEM_STATUS_LEVELS })
  status!: SystemStatusLevel

  @ApiProperty({ type: 'number', nullable: true })
  latencyMs!: number | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  checkedAt!: string
}

export class SystemDatabaseServiceDto {
  @ApiProperty({ enum: SYSTEM_STATUS_LEVELS })
  status!: SystemStatusLevel

  @ApiProperty({ type: 'number', nullable: true })
  latencyMs!: number | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  checkedAt!: string

  @ApiProperty({ type: 'string', nullable: true })
  version!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  timeZone!: string | null

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  startedAt!: string | null

  @ApiProperty({ type: 'number', nullable: true })
  sizeBytes!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  connections!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  activeConnections!: number | null
}

export class SystemMediaServiceDto {
  @ApiProperty({ enum: SYSTEM_STATUS_LEVELS })
  status!: SystemStatusLevel

  @ApiProperty({ type: 'string' })
  driver!: string

  @ApiProperty({ type: 'string' })
  storageEnvironment!: string

  @ApiProperty({ type: 'string', enum: ['up', 'down', 'unknown'] })
  readStatus!: 'up' | 'down' | 'unknown'

  @ApiProperty({ type: 'string', enum: ['up', 'down', 'unknown'] })
  writeStatus!: 'up' | 'down' | 'unknown'

  @ApiProperty({ type: 'string', enum: ['up', 'down', 'unknown'] })
  videoValidatorStatus!: 'up' | 'down' | 'unknown'

  @ApiProperty({ type: 'number', nullable: true })
  capacityFreePercent!: number | null

  @ApiProperty({
    type: 'string',
    enum: ['ok', 'warning', 'critical', 'unknown'],
    nullable: true,
  })
  capacityLevel!: 'ok' | 'warning' | 'critical' | 'unknown' | null

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  probedAt!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  message!: string | null
}

export class SystemServicesDto {
  @ApiProperty({ type: () => SystemBackendServiceDto })
  backend!: SystemBackendServiceDto

  @ApiProperty({ type: () => SystemDatabaseServiceDto })
  database!: SystemDatabaseServiceDto

  @ApiProperty({ type: () => SystemMediaServiceDto })
  media!: SystemMediaServiceDto
}

export class SystemHostResourceDto {
  @ApiProperty({ type: 'integer' })
  cpuCount!: number

  @ApiProperty({ type: 'number', nullable: true })
  cpuUsagePercent!: number | null

  @ApiProperty({
    type: 'array',
    items: { type: 'number' },
    nullable: true,
  })
  loadAverage!: number[] | null

  @ApiProperty({ type: 'number' })
  memoryTotalBytes!: number

  @ApiProperty({ type: 'number' })
  memoryAvailableBytes!: number
}

export class SystemContainerResourceDto {
  @ApiProperty({ type: 'number', nullable: true })
  cpuUsageCores!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  cpuUsagePercentOfHost!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  cpuQuotaCores!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  cpuThrottledPeriods!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  memoryCurrentBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  memoryLimitBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  memoryPeakBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  memoryAnonBytes!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  memoryOomKillCount!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  pidCount!: number | null

  @ApiProperty({ type: 'integer', nullable: true })
  pidLimit!: number | null
}

export class SystemProcessResourceDto {
  @ApiProperty({ type: 'number' })
  rssBytes!: number

  @ApiProperty({ type: 'number' })
  heapUsedBytes!: number

  @ApiProperty({ type: 'number' })
  uptimeSeconds!: number
}

export class SystemDiskResourceDto {
  @ApiProperty({ type: 'number', nullable: true })
  totalBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  freeBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  availableBytes!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  freePercent!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  inodeTotal!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  inodeFree!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  inodeUsedPercent!: number | null
}

export class SystemNetworkResourceDto {
  @ApiProperty({ type: 'number', nullable: true })
  rxBytesPerSecond!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  txBytesPerSecond!: number | null
}

export class SystemResourceDto {
  @ApiProperty({ type: () => SystemHostResourceDto })
  host!: SystemHostResourceDto

  @ApiProperty({ type: () => SystemContainerResourceDto })
  container!: SystemContainerResourceDto

  @ApiProperty({ type: () => SystemProcessResourceDto })
  process!: SystemProcessResourceDto

  @ApiProperty({ type: () => SystemDiskResourceDto })
  disk!: SystemDiskResourceDto

  @ApiProperty({ type: () => SystemNetworkResourceDto })
  network!: SystemNetworkResourceDto

  @ApiProperty({ type: 'string', format: 'date-time' })
  sampledAt!: string
}

export class SystemPerformanceSlowRequestDto {
  @ApiProperty({ type: 'string', format: 'date-time' })
  occurredAt!: string

  @ApiProperty({ type: 'number' })
  durationMs!: number

  @ApiProperty({ type: 'string' })
  operation!: string

  @ApiProperty({ type: 'integer' })
  statusCode!: number
}

export class SystemPerformanceDto {
  @ApiProperty({ type: 'integer' })
  windowSeconds!: number

  @ApiProperty({ type: 'integer' })
  totalRequests!: number

  @ApiProperty({ type: 'integer' })
  windowRequests!: number

  @ApiProperty({ type: 'integer' })
  serverErrors!: number

  @ApiProperty({ type: 'integer' })
  clientErrors!: number

  @ApiProperty({ type: 'number', nullable: true })
  errorRatePercent!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  averageMs!: number | null

  @ApiProperty({ type: 'number', nullable: true })
  p95Ms!: number | null

  @ApiProperty({ type: 'boolean' })
  insufficientData!: boolean

  @ApiProperty({ type: () => [SystemPerformanceSlowRequestDto] })
  slowest!: SystemPerformanceSlowRequestDto[]
}

export class SystemRuntimeDto {
  @ApiProperty({ type: 'string' })
  version!: string

  @ApiProperty({ type: 'string' })
  nodeVersion!: string

  @ApiProperty({ type: 'string' })
  platform!: string

  @ApiProperty({ type: 'string' })
  arch!: string

  @ApiProperty({ type: 'string', enum: ['dev', 'test', 'prod', 'unknown'] })
  environment!: 'dev' | 'test' | 'prod' | 'unknown'

  @ApiProperty({ type: 'string', enum: ['APP_ENV', 'MEDIA_STORAGE_ENV', 'none'] })
  environmentSource!: 'APP_ENV' | 'MEDIA_STORAGE_ENV' | 'none'

  @ApiProperty({ type: 'string' })
  nodeEnv!: string

  @ApiProperty({ type: 'integer' })
  port!: number

  @ApiProperty({ type: 'string' })
  timeZone!: string

  @ApiProperty({ type: 'string' })
  mediaDriver!: string

  @ApiProperty({ type: 'string' })
  mediaStorageEnvironment!: string

  @ApiProperty({ type: 'string' })
  mediaDeliveryMode!: string

  @ApiProperty({ type: 'boolean' })
  assistantWorkerEnabled!: boolean

  @ApiProperty({ type: 'string', format: 'date-time' })
  startedAt!: string

  @ApiProperty({ type: 'number' })
  uptimeSeconds!: number

  @ApiProperty({ type: 'string', nullable: true })
  migration!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  databaseVersion!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  databaseTimeZone!: string | null
}

export class SystemStatusCheckDto {
  @ApiProperty({ type: 'string' })
  key!: string

  @ApiProperty({ type: 'string' })
  label!: string

  @ApiProperty({
    type: 'string',
    enum: ['service', 'resource', 'performance'],
  })
  category!: 'service' | 'resource' | 'performance'

  @ApiProperty({ enum: SYSTEM_STATUS_LEVELS })
  status!: SystemStatusLevel

  @ApiProperty({ type: 'string', nullable: true })
  message!: string | null
}

export class SystemStatusResponseDto {
  @ApiProperty({ enum: SYSTEM_STATUS_LEVELS })
  overallStatus!: SystemStatusLevel

  @ApiProperty({ type: 'string', format: 'date-time' })
  generatedAt!: string

  @ApiProperty({ type: () => [SystemStatusCheckDto] })
  checks!: SystemStatusCheckDto[]

  @ApiProperty({ type: () => SystemServicesDto })
  services!: SystemServicesDto

  @ApiProperty({ type: () => SystemResourceDto })
  resources!: SystemResourceDto

  @ApiProperty({ type: () => SystemPerformanceDto })
  performance!: SystemPerformanceDto

  @ApiProperty({ type: () => SystemRuntimeDto })
  runtime!: SystemRuntimeDto
}
