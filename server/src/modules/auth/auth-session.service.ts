import { HttpStatus, Injectable } from '@nestjs/common'

import {
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_TOUCH_WINDOW_MS,
} from '../../config/auth.config'
import {
  type Prisma,
  SessionRevokedReason,
  UserStatus,
} from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { SessionTokenProvider } from './providers/session-token.provider'

const AUTH_SERVICE_UNAVAILABLE_CODE = 'AUTH_SERVICE_UNAVAILABLE'
const AUTH_SERVICE_UNAVAILABLE_MESSAGE = '认证服务暂时不可用'
const INVALID_DATABASE_CLOCK_MESSAGE = 'Invalid database clock result'

type AuthSessionTransaction = Prisma.TransactionClient

type DatabaseClockRow = Readonly<{
  now: Date
}>

type LockedSessionRow = Readonly<{
  absoluteExpiresAt: Date
  createdAt: Date
  displayName: string
  idleExpiresAt: Date
  lastActivityAt: Date
  mustChangePassword: boolean
  revokedAt: Date | null
  sessionAuthVersion: number
  status: UserStatus
  tokenHash: Uint8Array
  userAuthVersion: number
  userId: string
  username: string
}>

export type SessionUserSnapshot = Readonly<{
  authVersion: number
  displayName: string
  id: string
  mustChangePassword: boolean
  username: string
}>

export type AuthenticatedSession = Readonly<{
  absoluteExpiresAt: Date
  createdAt: Date
  displayName: string
  id: string
  idleExpiresAt: Date
  lastActivityAt: Date
  mustChangePassword: boolean
  userId: string
  username: string
}>

export type IssuedSession = Readonly<{
  session: AuthenticatedSession
  tokenValue: string
}>

/**
 * 管理单一 PostgreSQL Session 的创建、认证、活动续期与吊销。
 *
 * 所有过期判断都使用 `clock_timestamp()`；认证时先锁定 Session 行，再读取数据库
 * 时钟，避免并发续期、吊销与认证在不同时间基准下互相覆盖。
 */
@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenProvider: SessionTokenProvider,
  ) {}

  async createInTransaction(
    transaction: AuthSessionTransaction,
    user: SessionUserSnapshot,
  ): Promise<IssuedSession> {
    const databaseNow = await this.readDatabaseNow(transaction)
    const generatedToken = this.tokenProvider.generate()
    const absoluteExpiresAt = new Date(
      databaseNow.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS,
    )
    const idleExpiresAt = new Date(
      Math.min(
        databaseNow.getTime() + SESSION_IDLE_TIMEOUT_MS,
        absoluteExpiresAt.getTime(),
      ),
    )

    await transaction.authSession.create({
      data: {
        id: generatedToken.sessionId,
        userId: user.id,
        // Prisma 7 的 `Bytes` 输入要求拥有普通 ArrayBuffer backing；显式复制还可避免
        // 后续意外持有或修改 provider 返回的 Buffer。
        tokenHash: Uint8Array.from(generatedToken.tokenHash),
        authVersion: user.authVersion,
        createdAt: databaseNow,
        lastActivityAt: databaseNow,
        idleExpiresAt,
        absoluteExpiresAt,
      },
    })

    return {
      tokenValue: generatedToken.value,
      session: {
        id: generatedToken.sessionId,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        mustChangePassword: user.mustChangePassword,
        createdAt: databaseNow,
        lastActivityAt: databaseNow,
        idleExpiresAt,
        absoluteExpiresAt,
      },
    }
  }

  authenticate(tokenValue: string): Promise<AuthenticatedSession | null> {
    return this.validateToken(tokenValue, true)
  }

  /** 登录接口只判断“已经登录”，不能把这次探测当作用户活动续期。 */
  validateWithoutTouch(
    tokenValue: string,
  ): Promise<AuthenticatedSession | null> {
    return this.validateToken(tokenValue, false)
  }

  async revokeSessionInTransaction(
    transaction: AuthSessionTransaction,
    sessionId: string,
    reason: SessionRevokedReason,
  ): Promise<boolean> {
    const databaseNow = await this.readDatabaseNow(transaction)
    const result = await transaction.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: databaseNow, revokedReason: reason },
    })

    return result.count > 0
  }

  async revokeAllForUserInTransaction(
    transaction: AuthSessionTransaction,
    userId: string,
    reason: SessionRevokedReason,
  ): Promise<number> {
    const databaseNow = await this.readDatabaseNow(transaction)
    const result = await transaction.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: databaseNow, revokedReason: reason },
    })

    return result.count
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevokedReason,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return this.revokeSessionInTransaction(transaction, sessionId, reason)
      })
    } catch {
      throw this.createServiceUnavailableException()
    }
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevokedReason,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        return this.revokeAllForUserInTransaction(transaction, userId, reason)
      })
    } catch {
      throw this.createServiceUnavailableException()
    }
  }

  private async validateToken(
    tokenValue: string,
    touchActivity: boolean,
  ): Promise<AuthenticatedSession | null> {
    const parsedToken = this.tokenProvider.parse(tokenValue)
    if (!parsedToken) {
      return null
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        // selector 行锁也必须受 transaction-local lock/statement timeout 约束。
        await applyTransactionTimeouts(transaction)
        const rows = await transaction.$queryRaw<LockedSessionRow[]>`
          SELECT
            s.token_hash AS "tokenHash",
            s.auth_version AS "sessionAuthVersion",
            s.created_at AS "createdAt",
            s.last_activity_at AS "lastActivityAt",
            s.idle_expires_at AS "idleExpiresAt",
            s.absolute_expires_at AS "absoluteExpiresAt",
            s.revoked_at AS "revokedAt",
            u.id AS "userId",
            u.username,
            u.display_name AS "displayName",
            u.status,
            u.must_change_password AS "mustChangePassword",
            u.auth_version AS "userAuthVersion"
          FROM auth_sessions AS s
          INNER JOIN users AS u ON u.id = s.user_id
          WHERE s.id = CAST(${parsedToken.sessionId} AS uuid)
          FOR UPDATE OF s
        `

        const row = rows[0]
        if (!row) {
          return null
        }

        if (!this.tokenProvider.matchesTokenHash(parsedToken.secret, row.tokenHash)) {
          return null
        }

        // 时钟必须在取得 Session 行锁之后读取，才能为随后判断和 touch 提供同一基准。
        const databaseNow = await this.readDatabaseNow(transaction)
        if (!this.isValidSession(row, databaseNow)) {
          return null
        }

        let lastActivityAt = row.lastActivityAt
        let idleExpiresAt = row.idleExpiresAt

        if (
          touchActivity &&
          databaseNow.getTime() - row.lastActivityAt.getTime() >=
            SESSION_TOUCH_WINDOW_MS
        ) {
          idleExpiresAt = new Date(
            Math.min(
              databaseNow.getTime() + SESSION_IDLE_TIMEOUT_MS,
              row.absoluteExpiresAt.getTime(),
            ),
          )

          await transaction.authSession.update({
            where: { id: parsedToken.sessionId },
            data: {
              lastActivityAt: databaseNow,
              idleExpiresAt,
            },
          })
          lastActivityAt = databaseNow
        }

        return {
          id: parsedToken.sessionId,
          userId: row.userId,
          username: row.username,
          displayName: row.displayName,
          mustChangePassword: row.mustChangePassword,
          createdAt: row.createdAt,
          lastActivityAt,
          idleExpiresAt,
          absoluteExpiresAt: row.absoluteExpiresAt,
        }
      })
    } catch {
      // 驱动错误和连接信息可能含敏感数据，对外只能返回固定错误。
      throw this.createServiceUnavailableException()
    }
  }

  private isValidSession(
    row: LockedSessionRow,
    databaseNow: Date,
  ): boolean {
    return (
      row.revokedAt === null &&
      row.status === UserStatus.ACTIVE &&
      row.sessionAuthVersion === row.userAuthVersion &&
      databaseNow.getTime() < row.idleExpiresAt.getTime() &&
      databaseNow.getTime() < row.absoluteExpiresAt.getTime()
    )
  }

  private async readDatabaseNow(
    transaction: AuthSessionTransaction,
  ): Promise<Date> {
    const rows = await transaction.$queryRaw<DatabaseClockRow[]>`
      SELECT clock_timestamp() AS "now"
    `
    const databaseNow = rows[0]?.now

    if (
      !(databaseNow instanceof Date) ||
      !Number.isFinite(databaseNow.getTime())
    ) {
      throw new Error(INVALID_DATABASE_CLOCK_MESSAGE)
    }

    return databaseNow
  }

  private createServiceUnavailableException(): ApiException {
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      AUTH_SERVICE_UNAVAILABLE_CODE,
      AUTH_SERVICE_UNAVAILABLE_MESSAGE,
    )
  }
}
