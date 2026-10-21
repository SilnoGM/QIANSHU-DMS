import { Prisma } from '../../../generated/prisma/client'
import type { FundAccountCreateInput } from './fund-account.contract'
import {
  FUND_ACCOUNT_VIEW_SELECT,
  type FundAccountViewRow,
} from './fund-account.mapper'

export interface FundAccountCreateTargetRow {
  readonly id: string
  readonly existingAccountId: string | null
}

export interface FundAccountShareRateUpdateRow {
  readonly userShareRate: Prisma.Decimal
  readonly version: number
  readonly shareRateUpdatedAt: Date
  readonly updatedAt: Date
}

/**
 * 锁住用户行并同时读取是否已有账户。友好预检查不替代 userId unique；两个并发
 * 事务都看到空值时，最终仍由数据库唯一约束决定唯一赢家。
 */
export async function readFundAccountCreateTarget(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<FundAccountCreateTargetRow | null> {
  const rows = await transaction.$queryRaw<FundAccountCreateTargetRow[]>(
    Prisma.sql`
      SELECT
        users."id",
        account."id" AS "existingAccountId"
      FROM "users" AS users
      LEFT JOIN "fund_accounts" AS account
        ON account."user_id" = users."id"
      WHERE users."id" = CAST(${userId} AS uuid)
      FOR SHARE OF users
    `,
  )
  return rows[0] ?? null
}

export async function createFundAccountRecord(
  transaction: Prisma.TransactionClient,
  input: FundAccountCreateInput,
): Promise<{ readonly id: string }> {
  return transaction.fundAccount.create({
    data: {
      ownerType: 'USER',
      userId: input.userId,
      currency: 'CNY',
      balance: new Prisma.Decimal('0.00'),
      userShareRate: new Prisma.Decimal(input.userShareRate),
      nextSequence: 1n,
      version: 1,
      // 用户账户创建时比例立即生效；数据库 owner-shape 约束要求该时间非空。
      shareRateUpdatedAt: new Date(),
    },
    select: { id: true },
  })
}

export function readFundAccountView(
  transaction: Prisma.TransactionClient,
  accountId: string,
): Promise<FundAccountViewRow | null> {
  return transaction.fundAccount.findUnique({
    where: { id: accountId },
    select: FUND_ACCOUNT_VIEW_SELECT,
  })
}

/** 比例更新先锁账户行；JOIN 的用户仅用于构造同一稳定返回视图。 */
export async function lockFundAccountForShareRateUpdate(
  transaction: Prisma.TransactionClient,
  accountId: string,
): Promise<FundAccountViewRow | null> {
  const rows = await transaction.$queryRaw<FundAccountViewRow[]>(
    Prisma.sql`
      SELECT
        account."id",
        account."owner_type"::text AS "ownerType",
        account."user_id" AS "userId",
        account."currency",
        account."balance",
        account."user_share_rate" AS "userShareRate",
        account."version",
        account."share_rate_updated_at" AS "shareRateUpdatedAt",
        account."created_at" AS "createdAt",
        account."updated_at" AS "updatedAt",
        CASE
          WHEN users."id" IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', users."id",
            'username', users."username",
            'displayName', users."display_name",
            'status', users."status"::text,
            'profile', CASE
              WHEN profile."user_id" IS NULL THEN NULL
              ELSE jsonb_build_object('avatarUrl', profile."avatar_url")
            END
          )
        END AS "user"
      FROM "fund_accounts" AS account
      LEFT JOIN "users" AS users
        ON users."id" = account."user_id"
      LEFT JOIN "user_profiles" AS profile
        ON profile."user_id" = users."id"
      WHERE account."id" = CAST(${accountId} AS uuid)
      FOR UPDATE OF account
    `,
  )
  return rows[0] ?? null
}

/**
 * 锁后仍把 expectedVersion 放进 UPDATE 谓词，避免未来重构移除锁时静默失去最终
 * 并发保护。SQL 只更新当前比例和账户版本，不接触余额、批次或流水。
 */
export async function updateFundAccountShareRate(
  transaction: Prisma.TransactionClient,
  input: {
    readonly accountId: string
    readonly userShareRate: string
    readonly expectedVersion: number
  },
): Promise<FundAccountShareRateUpdateRow | null> {
  const rows = await transaction.$queryRaw<FundAccountShareRateUpdateRow[]>(
    Prisma.sql`
      UPDATE "fund_accounts"
      SET
        "user_share_rate" = CAST(${input.userShareRate} AS numeric(7, 4)),
        "version" = "version" + 1,
        "share_rate_updated_at" = CURRENT_TIMESTAMP,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = CAST(${input.accountId} AS uuid)
        AND "owner_type" = 'USER'::"fund_account_owner_type"
        AND "version" = ${input.expectedVersion}
      RETURNING
        "user_share_rate" AS "userShareRate",
        "version",
        "share_rate_updated_at" AS "shareRateUpdatedAt",
        "updated_at" AS "updatedAt"
    `,
  )
  return rows[0] ?? null
}
