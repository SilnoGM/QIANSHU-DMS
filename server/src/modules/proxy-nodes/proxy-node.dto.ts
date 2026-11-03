import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsBoolean,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator'

import { IsUnicodeCodePointLength } from '../auth/dto/unicode-code-point-length.validator'
import { ProxyIpType, ProxyProtocol } from '../../generated/prisma/enums'
import {
  PROXY_NODE_STATUSES,
  type ProxyNodeStatus,
} from './proxy-node-status'

export class ProxyNodeAssigneeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  displayName!: string

  @ApiProperty({ type: 'string' })
  username!: string

  @ApiProperty({ type: 'string', nullable: true })
  avatarUrl!: string | null
}

export class ProxyNodeDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', description: 'IPFoxy 代理 ID' })
  providerProxyId!: string

  @ApiProperty({ type: 'string' })
  host!: string

  @ApiProperty({ type: 'string', nullable: true })
  publicIp!: string | null

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 65535 })
  port!: number

  @ApiProperty({ enum: ProxyProtocol })
  protocol!: ProxyProtocol

  @ApiProperty({ type: 'string', nullable: true })
  countryCode!: string | null

  @ApiProperty({ type: 'string', nullable: true, description: '展示用国家名，TW/HK 已按业务口径覆盖' })
  countryName!: string | null

  @ApiProperty({ type: 'string', nullable: true })
  areaId!: string | null

  @ApiProperty({ enum: ProxyIpType })
  ipType!: ProxyIpType

  @ApiProperty({ type: 'string' })
  ipVersion!: string

  @ApiProperty({ type: 'boolean' })
  autoExtend!: boolean

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  boughtAt!: string | null

  @ApiProperty({ type: 'string', format: 'date-time' })
  expiresAt!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  lastRenewedAt!: string | null

  @ApiProperty({ type: 'string' })
  username!: string

  @ApiProperty({ type: 'string', description: '仅本人或管理权限可读；服务端静态加密存储' })
  password!: string

  @ApiProperty({ type: 'boolean', description: '密文损坏或密钥不匹配时为 true，密码字段为空' })
  credentialUnavailable!: boolean

  @ApiProperty({ enum: PROXY_NODE_STATUSES })
  status!: ProxyNodeStatus

  @ApiProperty({ type: () => ProxyNodeAssigneeDto, nullable: true })
  assignedUser!: ProxyNodeAssigneeDto | null

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  assignedAt!: string | null

  @ApiProperty({ type: 'boolean', description: '最近一次同步时供应商侧未返回该节点' })
  vendorMissing!: boolean

  @ApiProperty({ type: 'string', format: 'date-time' })
  lastSyncedAt!: string
}

export class ProxyNodeListDto {
  @ApiProperty({ type: () => [ProxyNodeDto] })
  items!: ProxyNodeDto[]

  @ApiProperty({ type: 'string', format: 'date-time', description: '服务端当前时刻，用于倒计时校准' })
  serverNow!: string

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  lastSyncedAt!: string | null
}

export class SyncProxyNodesResultDto {
  @ApiProperty({ type: 'integer' })
  created!: number

  @ApiProperty({ type: 'integer' })
  updated!: number

  @ApiProperty({ type: 'integer' })
  skipped!: number

  @ApiProperty({ type: 'integer', description: '同步后仍标记为供应商侧缺失的节点数' })
  vendorMissing!: number

  @ApiProperty({ type: 'string', format: 'date-time' })
  lastSyncedAt!: string

  @ApiProperty({ type: 'array', items: { type: 'string' }, description: '跳过的节点与地区查询失败原因，不含凭据' })
  warnings!: string[]
}

export class AssignProxyNodeRequestDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  @IsUUID(undefined, { message: '必须是有效的用户 UUID' })
  userId!: string

  @ApiPropertyOptional({ type: 'boolean', default: false, description: '节点已绑定他人时是否显式改绑' })
  @ValidateIf((_object: AssignProxyNodeRequestDto, value: unknown) =>
    value !== undefined,
  )
  @IsBoolean({ message: '必须是布尔值' })
  replace?: boolean
}

export class ProxyNodeAssignmentResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string', format: 'uuid' })
  assignedUserId!: string

  @ApiProperty({ type: 'string', format: 'date-time' })
  assignedAt!: string
}

export class ProxyNodeReleaseResultDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string
}

export class AssignableUserDto {
  @ApiProperty({ type: 'string', format: 'uuid' })
  id!: string

  @ApiProperty({ type: 'string' })
  displayName!: string

  @ApiProperty({ type: 'string' })
  username!: string

  @ApiProperty({ type: 'string', nullable: true })
  avatarUrl!: string | null
}

export class AssignableUsersQueryDto {
  @ApiPropertyOptional({ type: 'string', maxLength: 128 })
  @ValidateIf((_object: AssignableUsersQueryDto, value: unknown) =>
    value !== undefined,
  )
  @IsString({ message: '必须是字符串' })
  @IsUnicodeCodePointLength(0, 128, { message: '长度不能超过 128 个字符' })
  keyword?: string
}
