import { Prisma } from '../../../generated/prisma/client'
import type {
  FundAmountSignPolicy,
  FundBusinessCategory,
  FundRuleInputMode,
} from '../domain'
import {
  FUND_BUSINESS_SOURCE_VIEW_SELECT,
  FUND_POSTING_TYPE_VIEW_SELECT,
  type FundBusinessSourceViewRow,
  type FundPostingTypeViewRow,
} from './fund-configuration.mapper'

export interface FundPostingTypeConfigurationLockRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly businessCategory: FundBusinessCategory
  readonly requiresUser: boolean
  readonly amountSignPolicy: FundAmountSignPolicy
  readonly inputMode: FundRuleInputMode
  readonly enabled: boolean
  readonly currentRuleVersionId: string | null
  readonly version: number
}

export interface FundBusinessSourceConfigurationLockRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly description: string | null
  readonly enabled: boolean
  readonly version: number
}

export const FUND_EDITABLE_RULE_VERSION_SELECT = {
  id: true,
  postingTypeId: true,
  revision: true,
  status: true,
  legs: {
    select: {
      position: true,
      accountTarget: true,
      directionPolicy: true,
      amountStrategy: true,
      adjustmentMode: true,
    },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.FundPostingRuleVersionSelect

export type FundEditableRuleVersionRow = Prisma.FundPostingRuleVersionGetPayload<{
  select: typeof FUND_EDITABLE_RULE_VERSION_SELECT
}>

/** 所有类型配置修改先锁定主类型行，版本、规则与启停判断都在同一锁内完成。 */
export async function lockFundPostingTypeConfiguration(
  transaction: Prisma.TransactionClient,
  postingTypeId: string,
): Promise<FundPostingTypeConfigurationLockRow | null> {
  const rows = await transaction.$queryRaw<FundPostingTypeConfigurationLockRow[]>(
    Prisma.sql`
      SELECT
        type."id",
        type."code",
        type."name",
        type."description",
        type."business_category"::text AS "businessCategory",
        type."requires_user" AS "requiresUser",
        type."amount_sign_policy"::text AS "amountSignPolicy",
        type."input_mode"::text AS "inputMode",
        type."enabled",
        type."current_rule_version_id" AS "currentRuleVersionId",
        type."version"
      FROM "fund_posting_types" AS type
      WHERE type."id" = CAST(${postingTypeId} AS uuid)
      FOR UPDATE OF type
    `,
  )
  return rows[0] ?? null
}

/** 来源白名单替换与启停同样锁住来源主行，防止并发修改丢失。 */
export async function lockFundBusinessSourceConfiguration(
  transaction: Prisma.TransactionClient,
  businessSourceId: string,
): Promise<FundBusinessSourceConfigurationLockRow | null> {
  const rows = await transaction.$queryRaw<FundBusinessSourceConfigurationLockRow[]>(
    Prisma.sql`
      SELECT
        source."id",
        source."code",
        source."name",
        source."description",
        source."enabled",
        source."version"
      FROM "fund_business_sources" AS source
      WHERE source."id" = CAST(${businessSourceId} AS uuid)
      FOR UPDATE OF source
    `,
  )
  return rows[0] ?? null
}

export function readFundPostingTypeView(
  transaction: Prisma.TransactionClient,
  postingTypeId: string,
): Promise<FundPostingTypeViewRow | null> {
  return transaction.fundPostingType.findUnique({
    where: { id: postingTypeId },
    select: FUND_POSTING_TYPE_VIEW_SELECT,
  })
}

export function readFundBusinessSourceView(
  transaction: Prisma.TransactionClient,
  businessSourceId: string,
): Promise<FundBusinessSourceViewRow | null> {
  return transaction.fundBusinessSource.findUnique({
    where: { id: businessSourceId },
    select: FUND_BUSINESS_SOURCE_VIEW_SELECT,
  })
}

export function readDraftRuleVersion(
  transaction: Prisma.TransactionClient,
  postingTypeId: string,
): Promise<FundEditableRuleVersionRow | null> {
  return transaction.fundPostingRuleVersion.findFirst({
    where: { postingTypeId, status: 'DRAFT' },
    select: FUND_EDITABLE_RULE_VERSION_SELECT,
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
  })
}

export function readRuleVersionForPublish(
  transaction: Prisma.TransactionClient,
  ruleVersionId: string,
): Promise<FundEditableRuleVersionRow | null> {
  return transaction.fundPostingRuleVersion.findUnique({
    where: { id: ruleVersionId },
    select: FUND_EDITABLE_RULE_VERSION_SELECT,
  })
}
