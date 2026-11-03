import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { UserStatus } from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService, AuditWriteFailedError } from '../audit/audit.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import type {
  AssignProxyNodeRequestDto,
  ProxyNodeAssignmentResultDto,
  ProxyNodeReleaseResultDto,
  SyncProxyNodesResultDto,
} from './proxy-node.dto'
import {
  IpfoxyClient,
  IpfoxyClientError,
  type RawIpfoxyAreaRecord,
} from './ipfoxy.client'
import {
  buildAreaCountryMap,
  mapIpfoxyProxy,
  ProxyNodeRecordError,
  type NormalizedProxyNode,
} from './proxy-node.mapper'
import {
  ProxyNodeSecretService,
  ProxyNodeSecretUnavailableError,
} from './proxy-node-secret.service'

export interface ProxyNodeCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

interface LockedProxyNodeRow {
  readonly id: string
  readonly provider_proxy_id: string
  readonly assigned_user_id: string | null
  readonly assigned_at: Date | null
  readonly expires_at: Date
  readonly vendor_missing: boolean
}

const CONFLICT_CODES = ['P2034', '40001', '40P01', '55P03', '57014'] as const
const MAX_WARNINGS = 10

function mapIpfoxyFailure(error: IpfoxyClientError): ApiException {
  switch (error.kind) {
    case 'NOT_CONFIGURED':
      return new ApiException(
        503,
        'PROXY_PROVIDER_NOT_CONFIGURED',
        '尚未配置 IPFoxy 凭据，请联系管理员',
      )
    case 'UNAUTHORIZED':
      return new ApiException(
        503,
        'PROXY_PROVIDER_UNAUTHORIZED',
        'IPFoxy 授权失败，请检查 API 凭据',
      )
    case 'RATE_LIMITED':
      return new ApiException(
        503,
        'PROXY_PROVIDER_RATE_LIMITED',
        'IPFoxy 请求过于频繁，请稍后重试',
      )
    case 'INVALID_RESPONSE':
      return new ApiException(
        503,
        'PROXY_PROVIDER_INVALID_RESPONSE',
        'IPFoxy 返回数据异常，请稍后重试',
      )
    default:
      return new ApiException(
        503,
        'PROXY_PROVIDER_UNAVAILABLE',
        'IPFoxy 暂时不可用，请稍后重试',
      )
  }
}

function mapStateConflict(error: unknown): unknown {
  if (error instanceof ApiException) {
    return error
  }

  if (error instanceof AuditWriteFailedError) {
    if (error.transactionConflict) {
      return new ApiException(
        409,
        'PROXY_NODE_STATE_CHANGED',
        '节点状态已变化，请刷新后重试',
      )
    }
    return error
  }

  const facts = readPersistenceErrorFacts(error)
  if (CONFLICT_CODES.some(code => hasPersistenceCode(facts, code))) {
    return new ApiException(
      409,
      'PROXY_NODE_STATE_CHANGED',
      '节点状态已变化，请刷新后重试',
    )
  }

  return error
}

@Injectable()
export class ProxyNodeCommandService {
  private syncing = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: IpfoxyClient,
    private readonly secret: ProxyNodeSecretService,
    private readonly audit: AuditService,
  ) {}

  async sync(context: ProxyNodeCommandContext): Promise<SyncProxyNodesResultDto> {
    if (this.syncing) {
      throw new ApiException(409, 'PROXY_SYNC_IN_PROGRESS', '正在同步，请稍后重试')
    }

    this.syncing = true
    const warnings: string[] = []
    let skipped = 0

    try {
      const proxies = await this.client.listProxies()

      // 供应商偶尔会返回空的成功响应；在已有本地节点时不能把整表标记为缺失。
      if (proxies.length === 0) {
        const existingCount = await this.prisma.proxyNode.count()
        if (existingCount > 0) {
          throw new ApiException(
            503,
            'PROXY_PROVIDER_INVALID_RESPONSE',
            'IPFoxy 未返回任何节点，已保留本地数据',
          )
        }
      }

      let areas: RawIpfoxyAreaRecord[] = []
      try {
        areas = await this.client.listAreas()
      }
      catch (error) {
        if (error instanceof IpfoxyClientError) {
          warnings.push(`地区列表查询失败（${error.kind}），国家名可能不完整`)
        }
        else {
          throw error
        }
      }

      const areaCountryById = buildAreaCountryMap(areas)
      const normalized: NormalizedProxyNode[] = []

      for (const proxy of proxies) {
        try {
          normalized.push(mapIpfoxyProxy(proxy, areaCountryById))
        }
        catch (error) {
          if (error instanceof ProxyNodeRecordError) {
            skipped += 1
            warnings.push(`${error.providerProxyId}: ${error.reason}`)
            continue
          }
          throw error
        }
      }

      if (proxies.length > 0 && normalized.length === 0) {
        throw new ApiException(
          503,
          'PROXY_PROVIDER_INVALID_RESPONSE',
          'IPFoxy 返回的节点均无法识别，请检查供应商接口',
        )
      }

      const now = new Date()
      const result = await this.prisma.$transaction(async (transaction) => {
        // 事务级 advisory lock 只保护短写入阶段；网络请求已在事务外完成。
        // 必须 SELECT 出布尔列，直接 SELECT pg_try_advisory_xact_lock() 在 Prisma
        // 下会把 void 结果当成异常。
        const lockRows = await transaction.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext('qianshu.proxy_nodes.sync')) AS locked
        `
        if (!lockRows[0]?.locked) {
          throw new ApiException(
            409,
            'PROXY_SYNC_IN_PROGRESS',
            '正在同步，请稍后重试',
          )
        }

        await transaction.proxyNode.updateMany({
          data: { vendorMissing: true },
        })

        const existing = await transaction.proxyNode.findMany({
          where: {
            providerProxyId: {
              in: normalized.map(node => node.providerProxyId),
            },
          },
          select: { providerProxyId: true },
        })
        const existingIds = new Set(
          existing.map(row => row.providerProxyId),
        )

        for (const node of normalized) {
          const passwordCiphertext = this.secret.encrypt(node.password)
          const base = {
            host: node.host,
            publicIp: node.publicIp,
            port: node.port,
            protocol: node.protocol,
            countryCode: node.countryCode,
            areaId: node.areaId,
            ipType: node.ipType,
            ipVersion: node.ipVersion,
            autoExtend: node.autoExtend,
            boughtAt: node.boughtAt,
            expiresAt: node.expiresAt,
            lastRenewedAt: node.lastRenewedAt,
            username: node.username,
            passwordCiphertext,
            vendorMissing: false,
            lastSyncedAt: now,
          } satisfies Omit<
            Prisma.ProxyNodeUncheckedCreateInput,
            'id' | 'providerProxyId' | 'vendorCountry' | 'createdAt' | 'updatedAt'
          >

          await transaction.proxyNode.upsert({
            where: { providerProxyId: node.providerProxyId },
            create: {
              ...base,
              providerProxyId: node.providerProxyId,
              vendorCountry: node.vendorCountry,
            },
            // area-list 失败时保留旧国家名，避免一次地区查询异常把已有展示清空。
            update: node.vendorCountry === null
              ? base
              : { ...base, vendorCountry: node.vendorCountry },
          })
        }

        const vendorMissing = await transaction.proxyNode.count({
          where: { vendorMissing: true },
        })
        const created = normalized.filter(
          node => !existingIds.has(node.providerProxyId),
        ).length

        await this.audit.record(transaction, {
          eventType: 'PROXY_NODE_SYNCED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'PROXY_NODE',
          metadata: {
            created,
            updated: normalized.length - created,
            skipped,
            vendorMissing,
          },
        })

        return {
          created,
          updated: normalized.length - created,
          vendorMissing,
        }
      }, { timeout: 30_000 })

      if (normalized.length < proxies.length && warnings.length >= MAX_WARNINGS) {
        warnings.push('其余无法识别的节点已跳过')
      }

      return {
        ...result,
        skipped,
        lastSyncedAt: now.toISOString(),
        warnings: warnings.slice(0, MAX_WARNINGS),
      }
    }
    catch (error) {
      if (error instanceof IpfoxyClientError) {
        throw mapIpfoxyFailure(error)
      }
      if (error instanceof ProxyNodeSecretUnavailableError) {
        throw new ApiException(
          503,
          'PROXY_NODE_SECRET_UNAVAILABLE',
          '静态节点加密密钥未配置',
        )
      }
      throw error
    }
    finally {
      this.syncing = false
    }
  }

  async assign(
    id: string,
    input: AssignProxyNodeRequestDto,
    context: ProxyNodeCommandContext,
  ): Promise<ProxyNodeAssignmentResultDto> {
    const now = new Date()

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<LockedProxyNodeRow[]>`
          SELECT id, provider_proxy_id, assigned_user_id, assigned_at,
                 expires_at, vendor_missing
          FROM proxy_nodes
          WHERE id = ${id}::uuid
          FOR UPDATE
        `
        const node = rows[0]
        if (node === undefined) {
          throw new ApiException(404, 'PROXY_NODE_NOT_FOUND', '静态节点不存在')
        }
        if (node.vendor_missing) {
          throw new ApiException(
            409,
            'PROXY_NODE_UNAVAILABLE',
            '该节点在供应商侧已不可见，请先同步',
          )
        }
        if (node.expires_at.getTime() <= now.getTime()) {
          throw new ApiException(
            409,
            'PROXY_NODE_EXPIRED',
            '该节点已过期，不能绑定',
          )
        }

        const user = await transaction.user.findUnique({
          where: { id: input.userId },
          select: { status: true },
        })
        if (user === null || user.status !== UserStatus.ACTIVE) {
          throw new ApiException(
            422,
            'PROXY_NODE_ASSIGNEE_INVALID',
            '目标用户不存在或已停用',
          )
        }

        if (node.assigned_user_id === input.userId) {
          return {
            id: node.id,
            assignedUserId: input.userId,
            assignedAt: (node.assigned_at ?? now).toISOString(),
          }
        }

        if (node.assigned_user_id !== null && input.replace !== true) {
          throw new ApiException(
            409,
            'PROXY_NODE_ALREADY_ASSIGNED',
            '该节点已绑定其他用户，请确认后改绑',
          )
        }

        await transaction.proxyNode.update({
          where: { id: node.id },
          data: {
            assignedUserId: input.userId,
            assignedAt: now,
            assignedByUserId: context.actorUserId,
          },
        })

        await this.audit.record(transaction, {
          eventType: 'PROXY_NODE_ASSIGNED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'PROXY_NODE',
          targetId: node.id,
          metadata: {
            providerProxyId: node.provider_proxy_id,
            assignedUserId: input.userId,
            previousAssignedUserId: node.assigned_user_id ?? null,
          },
        })

        return {
          id: node.id,
          assignedUserId: input.userId,
          assignedAt: now.toISOString(),
        }
      }, { timeout: 15_000 })
    }
    catch (error) {
      throw mapStateConflict(error)
    }
  }

  async release(
    id: string,
    context: ProxyNodeCommandContext,
  ): Promise<ProxyNodeReleaseResultDto> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRaw<LockedProxyNodeRow[]>`
          SELECT id, provider_proxy_id, assigned_user_id, assigned_at,
                 expires_at, vendor_missing
          FROM proxy_nodes
          WHERE id = ${id}::uuid
          FOR UPDATE
        `
        const node = rows[0]
        if (node === undefined) {
          throw new ApiException(404, 'PROXY_NODE_NOT_FOUND', '静态节点不存在')
        }
        if (node.assigned_user_id === null) {
          throw new ApiException(
            409,
            'PROXY_NODE_NOT_ASSIGNED',
            '该节点尚未绑定用户',
          )
        }

        await transaction.proxyNode.update({
          where: { id: node.id },
          data: {
            assignedUserId: null,
            assignedAt: null,
            assignedByUserId: null,
          },
        })

        await this.audit.record(transaction, {
          eventType: 'PROXY_NODE_RELEASED',
          outcome: 'SUCCESS',
          actorType: 'USER',
          actorUserId: context.actorUserId,
          requestId: context.requestId,
          targetType: 'PROXY_NODE',
          targetId: node.id,
          metadata: {
            providerProxyId: node.provider_proxy_id,
            previousAssignedUserId: node.assigned_user_id,
          },
        })

        return { id: node.id }
      }, { timeout: 15_000 })
    }
    catch (error) {
      throw mapStateConflict(error)
    }
  }
}
