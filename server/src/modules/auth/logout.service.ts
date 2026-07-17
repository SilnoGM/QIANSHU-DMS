import { HttpStatus, Injectable } from '@nestjs/common'

import { AuditService } from '../audit/audit.service'
import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  SessionRevokedReason,
  UserStatus,
  type UserStatus as UserStatusValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type { RequestAuthContext } from './auth-context'
import { AuthSessionService } from './auth-session.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'

type LockedUserRow = Readonly<{
  authVersion: number
  id: string
  status: UserStatusValue
}>

type LockedSessionRow = Readonly<{
  absoluteExpiresAt: Date
  authVersion: number
  idleExpiresAt: Date
  revokedAt: Date | null
  userId: string
}>

type DatabaseClockRow = Readonly<{ now: Date }>

export interface OptionalLogoutInput {
  auth: RequestAuthContext | null
  requestId: string
  sourceIp: string
}

export interface LogoutAllInput {
  auth: RequestAuthContext
  requestId: string
  sourceIp: string
}

/** 当前 Session 与全部 Session 的服务端退出流程。 */
@Injectable()
export class LogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
    private readonly subjectHasher: AuthSubjectHasher,
    private readonly audit: AuditService,
  ) {}

  async logout(input: OptionalLogoutInput): Promise<void> {
    if (input.auth === null) {
      return
    }

    try {
      const sourceIpHash = this.subjectHasher.hashIp(input.sourceIp)
      await this.prisma.$transaction(async (transaction) => {
        const revoked = await this.sessions.revokeSessionInTransaction(
          transaction,
          input.auth?.sessionId ?? '',
          SessionRevokedReason.LOGOUT,
        )

        // 并发 logout/logout-all 已完成吊销时保持幂等，也不重复制造成功 Audit。
        if (!revoked || input.auth === null) {
          return
        }

        await this.audit.record(transaction, {
          eventType: AuditEventType.AUTH_LOGOUT,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: input.auth.userId,
          targetType: 'AuthSession',
          targetId: input.auth.sessionId,
          requestId: input.requestId,
          sourceIpHash,
        })
      })
    } catch {
      throw this.createServiceUnavailableException()
    }
  }

  async logoutAll(input: LogoutAllInput): Promise<void> {
    try {
      const sourceIpHash = this.subjectHasher.hashIp(input.sourceIp)

      await this.prisma.$transaction(async (transaction) => {
        // 固定先锁 User，再锁当前 Session，与改密路径保持相同的互斥顺序。
        const users = await transaction.$queryRaw<LockedUserRow[]>(Prisma.sql`
          SELECT "id", "status", "auth_version" AS "authVersion"
          FROM "users"
          WHERE "id" = CAST(${input.auth.userId} AS uuid)
          FOR UPDATE
        `)
        const lockedUser = users[0]
        const sessions = await transaction.$queryRaw<LockedSessionRow[]>(
          Prisma.sql`
            SELECT
              "user_id" AS "userId",
              "auth_version" AS "authVersion",
              "idle_expires_at" AS "idleExpiresAt",
              "absolute_expires_at" AS "absoluteExpiresAt",
              "revoked_at" AS "revokedAt"
            FROM "auth_sessions"
            WHERE "id" = CAST(${input.auth.sessionId} AS uuid)
            FOR UPDATE
          `,
        )
        const clockRows = await transaction.$queryRaw<DatabaseClockRow[]>(
          Prisma.sql`SELECT clock_timestamp() AS "now"`,
        )
        const lockedSession = sessions[0]
        const databaseNow = clockRows[0]?.now

        if (
          !this.isValidDatabaseDate(databaseNow) ||
          !this.isLogoutAllStateValid(
            lockedUser,
            lockedSession,
            databaseNow,
          )
        ) {
          throw this.createAuthStateChangedException()
        }

        await transaction.user.update({
          where: { id: lockedUser.id },
          data: { authVersion: { increment: 1 } },
        })
        await this.sessions.revokeAllForUserInTransaction(
          transaction,
          lockedUser.id,
          SessionRevokedReason.LOGOUT_ALL,
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.AUTH_LOGOUT_ALL,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: lockedUser.id,
          targetType: 'User',
          targetId: lockedUser.id,
          requestId: input.requestId,
          sourceIpHash,
        })
      })
    } catch (error) {
      if (error instanceof ApiException) {
        throw error
      }

      throw this.createServiceUnavailableException()
    }
  }

  private isLogoutAllStateValid(
    user: LockedUserRow | undefined,
    session: LockedSessionRow | undefined,
    databaseNow: Date,
  ): user is LockedUserRow {
    return (
      user !== undefined &&
      session !== undefined &&
      user.status === UserStatus.ACTIVE &&
      session.userId === user.id &&
      session.authVersion === user.authVersion &&
      session.revokedAt === null &&
      this.isValidDatabaseDate(session.idleExpiresAt) &&
      this.isValidDatabaseDate(session.absoluteExpiresAt) &&
      databaseNow.getTime() < session.idleExpiresAt.getTime() &&
      databaseNow.getTime() < session.absoluteExpiresAt.getTime()
    )
  }

  private isValidDatabaseDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime())
  }

  private createAuthStateChangedException(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      'AUTH_STATE_CHANGED',
      '认证状态已变化，请重试',
    )
  }

  private createServiceUnavailableException(): ApiException {
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AUTH_SERVICE_UNAVAILABLE',
      '认证服务暂时不可用',
    )
  }
}
