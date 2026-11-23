import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AdAccountAssignmentResultDto, AdAccountReleaseResultDto } from './ad-account.dto'
import {
  adAccountAlreadyAssigned,
  adAccountAssigneeInvalid,
  adAccountNotAssigned,
  adAccountNotFound,
  adAccountStateChanged,
} from './ad-account.errors'

export interface AdAccountCommandContext {
  readonly actorUserId: string
  readonly requestId?: string
}

export interface AssignAdAccountInput {
  readonly userId: string
  readonly replace?: boolean
}

/**
 * 绑定关系维护。
 *
 * 单绑定模型：一个账户最多一个主责人。并发保护用「带旧值的条件更新」而不是
 * 行锁：更新时把读到的 assignedUserId 放进 where，命中 0 行说明期间被别人改过。
 */
@Injectable()
export class AdAccountCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assign(
    id: string,
    input: AssignAdAccountInput,
    context: AdAccountCommandContext,
  ): Promise<AdAccountAssignmentResultDto> {
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.adAccount.findUnique({
        where: { id },
        select: { id: true, accountId: true, assignedUserId: true },
      })

      if (account === null) {
        adAccountNotFound()
      }

      const assignee = await transaction.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true },
      })

      if (assignee === null || assignee.status !== 'ACTIVE') {
        adAccountAssigneeInvalid()
      }

      // 幂等：重复绑定同一用户直接返回，不产生审计噪音。
      if (account.assignedUserId === assignee.id) {
        return { assignedUserId: assignee.id }
      }

      if (account.assignedUserId !== null && input.replace !== true) {
        adAccountAlreadyAssigned()
      }

      const now = new Date()
      const updated = await transaction.adAccount.updateMany({
        where: { id: account.id, assignedUserId: account.assignedUserId },
        data: {
          assignedUserId: assignee.id,
          assignedAt: now,
          assignedByUserId: context.actorUserId,
        },
      })

      if (updated.count !== 1) {
        adAccountStateChanged()
      }

      await this.audit.record(transaction, {
        eventType: 'AD_ACCOUNT_ASSIGNED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'AD_ACCOUNT',
        targetId: account.id,
        metadata: {
          accountId: account.accountId,
          assignedUserId: assignee.id,
          previousAssignedUserId: account.assignedUserId ?? '',
        },
      })

      return { assignedUserId: assignee.id }
    })
  }

  async release(id: string, context: AdAccountCommandContext): Promise<AdAccountReleaseResultDto> {
    return this.prisma.$transaction(async (transaction) => {
      const account = await transaction.adAccount.findUnique({
        where: { id },
        select: { id: true, accountId: true, assignedUserId: true },
      })

      if (account === null) {
        adAccountNotFound()
      }

      if (account.assignedUserId === null) {
        adAccountNotAssigned()
      }

      // 三列必须一起置空，否则违反 assignment_shape_check。
      const updated = await transaction.adAccount.updateMany({
        where: { id: account.id, assignedUserId: account.assignedUserId },
        data: { assignedUserId: null, assignedAt: null, assignedByUserId: null },
      })

      if (updated.count !== 1) {
        adAccountStateChanged()
      }

      await this.audit.record(transaction, {
        eventType: 'AD_ACCOUNT_RELEASED',
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'AD_ACCOUNT',
        targetId: account.id,
        metadata: {
          accountId: account.accountId,
          previousAssignedUserId: account.assignedUserId,
        },
      })

      return { released: true }
    })
  }
}
