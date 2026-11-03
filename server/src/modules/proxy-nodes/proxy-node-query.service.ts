import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { UserStatus } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type {
  AssignableUserDto,
  ProxyNodeDto,
  ProxyNodeExpirySummaryDto,
  ProxyNodeListDto,
} from './proxy-node.dto'
import { resolveProxyCountryLabel } from './proxy-node.mapper'
import {
  ProxyNodeSecretInvalidError,
  ProxyNodeSecretService,
  ProxyNodeSecretUnavailableError,
} from './proxy-node-secret.service'
import { resolveProxyNodeStatus } from './proxy-node-status'

const ASSIGNEE_SELECT = {
  id: true,
  displayName: true,
  username: true,
  profile: { select: { avatarUrl: true } },
} as const satisfies Prisma.UserSelect

const PROXY_NODE_INCLUDE = {
  assignedUser: { select: ASSIGNEE_SELECT },
} as const satisfies Prisma.ProxyNodeInclude

type ProxyNodeRow = Prisma.ProxyNodeGetPayload<{
  include: typeof PROXY_NODE_INCLUDE
}>

const TWO_DAY_WINDOW_MS = 2 * 86_400_000

@Injectable()
export class ProxyNodeQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secret: ProxyNodeSecretService,
  ) {}

  async listMine(userId: string): Promise<ProxyNodeListDto> {
    return this.list({ assignedUserId: userId })
  }

  async listAll(): Promise<ProxyNodeListDto> {
    return this.list({})
  }

  async expirySummaryMine(userId: string): Promise<ProxyNodeExpirySummaryDto> {
    return this.expirySummary({ assignedUserId: userId })
  }

  async expirySummaryAll(): Promise<ProxyNodeExpirySummaryDto> {
    return this.expirySummary({})
  }

  private async expirySummary(
    where: Prisma.ProxyNodeWhereInput,
  ): Promise<ProxyNodeExpirySummaryDto> {
    const now = new Date()
    const threshold = new Date(now.getTime() + TWO_DAY_WINDOW_MS)
    const expiring2d = await this.prisma.proxyNode.count({
      where: {
        ...where,
        expiresAt: { gt: now, lte: threshold },
      },
    })
    return { expiring2d }
  }

  async assignableUsers(keyword?: string): Promise<AssignableUserDto[]> {
    const trimmed = keyword?.trim() ?? ''
    const rows = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        ...(trimmed.length > 0
          ? {
            OR: [
              { displayName: { contains: trimmed, mode: 'insensitive' } },
              { username: { contains: trimmed, mode: 'insensitive' } },
            ],
          }
          : {}),
      },
      select: {
        id: true,
        displayName: true,
        username: true,
        profile: { select: { avatarUrl: true } },
      },
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      take: 50,
    })

    return rows.map(row => ({
      id: row.id,
      displayName: row.displayName,
      username: row.username,
      avatarUrl: row.profile?.avatarUrl ?? null,
    }))
  }

  private async list(
    where: Prisma.ProxyNodeWhereInput,
  ): Promise<ProxyNodeListDto> {
    const now = new Date()
    const rows = await this.prisma.proxyNode.findMany({
      where,
      include: PROXY_NODE_INCLUDE,
      orderBy: [{ expiresAt: 'asc' }, { providerProxyId: 'asc' }],
    })

    return {
      items: rows.map(row => this.toDto(row, now)),
      serverNow: now.toISOString(),
      lastSyncedAt: latestSync(rows),
    }
  }

  private toDto(row: ProxyNodeRow, now: Date): ProxyNodeDto {
    let password = ''
    let credentialUnavailable = false

    try {
      password = this.secret.decrypt(row.passwordCiphertext)
    }
    catch (error) {
      if (error instanceof ProxyNodeSecretUnavailableError) {
        throw new ApiException(
          503,
          'PROXY_NODE_SECRET_UNAVAILABLE',
          '静态节点加密密钥未配置',
        )
      }
      if (error instanceof ProxyNodeSecretInvalidError) {
        credentialUnavailable = true
      }
      else {
        throw error
      }
    }

    return {
      id: row.id,
      providerProxyId: row.providerProxyId,
      host: row.host,
      publicIp: row.publicIp,
      port: row.port,
      protocol: row.protocol,
      countryCode: row.countryCode,
      countryName: resolveProxyCountryLabel(row.countryCode, row.vendorCountry),
      areaId: row.areaId,
      ipType: row.ipType,
      ipVersion: row.ipVersion,
      autoExtend: row.autoExtend,
      boughtAt: row.boughtAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      lastRenewedAt: row.lastRenewedAt?.toISOString() ?? null,
      username: row.username,
      password,
      credentialUnavailable,
      status: resolveProxyNodeStatus(row.expiresAt, now),
      assignedUser: row.assignedUser === null
        ? null
        : {
          id: row.assignedUser.id,
          displayName: row.assignedUser.displayName,
          username: row.assignedUser.username,
          avatarUrl: row.assignedUser.profile?.avatarUrl ?? null,
        },
      assignedAt: row.assignedAt?.toISOString() ?? null,
      vendorMissing: row.vendorMissing,
      lastSyncedAt: row.lastSyncedAt.toISOString(),
    }
  }
}

function latestSync(rows: readonly ProxyNodeRow[]): string | null {
  if (rows.length === 0) {
    return null
  }

  let latest = rows[0].lastSyncedAt.getTime()
  for (const row of rows) {
    latest = Math.max(latest, row.lastSyncedAt.getTime())
  }
  return new Date(latest).toISOString()
}
