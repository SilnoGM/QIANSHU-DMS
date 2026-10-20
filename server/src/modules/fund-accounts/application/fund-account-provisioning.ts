import type { Prisma } from '../../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../../generated/prisma/enums'
import type { AuditService } from '../../audit/audit.service'
import { createFundAccountRecord } from './fund-account-command.persistence'
import { mapFundPersistenceError } from './fund-persistence-error.mapper'

export interface FundAccountProvisioningInput {
  readonly userId: string
  readonly userShareRate: string
  readonly actorUserId: string
  readonly requestId: string
  readonly correlationId?: string
}

/**
 * 用户开户的唯一写入路径，必须在调用方事务内执行。
 *
 * 新建用户与开户共享同一个 interactive transaction：账户插入或 Audit 失败时，
 * 调用方的用户写入会一起回滚。这里不创建嵌套事务，也不做“用户是否已存在”的
 * 友好预检查——新建用户场景由数据库唯一约束兜底，既有开户命令仍自行预检查。
 */
export async function createUserFundAccountInTransaction(
  transaction: Prisma.TransactionClient,
  audit: AuditService,
  input: FundAccountProvisioningInput,
): Promise<{ readonly id: string }> {
  try {
    const created = await createFundAccountRecord(transaction, {
      userId: input.userId,
      userShareRate: input.userShareRate,
    })

    await audit.record(transaction, {
      eventType: AuditEventType.FUND_ACCOUNT_CREATED,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: input.actorUserId,
      targetType: 'FundAccount',
      targetId: created.id,
      requestId: input.requestId,
      ...(input.correlationId === undefined
        ? {}
        : { correlationId: input.correlationId }),
      metadata: {
        userId: input.userId,
        userShareRate: input.userShareRate,
      },
    })

    return created
  }
  catch (error) {
    throw mapFundPersistenceError(error)
  }
}
