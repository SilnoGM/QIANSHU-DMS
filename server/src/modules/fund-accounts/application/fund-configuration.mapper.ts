import { Prisma } from '../../../generated/prisma/client'
import type {
  FundBusinessSourceView,
  FundPostingRuleVersionView,
  FundPostingTypeView,
} from './fund-configuration.contract'

export const FUND_POSTING_RULE_VERSION_SELECT = {
  id: true,
  revision: true,
  status: true,
  createdByUserId: true,
  publishedByUserId: true,
  createdAt: true,
  publishedAt: true,
  legs: {
    select: {
      id: true,
      position: true,
      accountTarget: true,
      directionPolicy: true,
      amountStrategy: true,
      adjustmentMode: true,
    },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
} satisfies Prisma.FundPostingRuleVersionSelect

export const FUND_POSTING_TYPE_VIEW_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  businessCategory: true,
  requiresUser: true,
  amountSignPolicy: true,
  inputMode: true,
  enabled: true,
  currentRuleVersionId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  currentRuleVersion: { select: FUND_POSTING_RULE_VERSION_SELECT },
  ruleVersions: {
    where: { status: 'DRAFT' as const },
    select: FUND_POSTING_RULE_VERSION_SELECT,
    orderBy: [{ revision: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.FundPostingTypeSelect

export const FUND_BUSINESS_SOURCE_VIEW_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  enabled: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  allowedPostingTypes: {
    select: {
      createdAt: true,
      postingType: {
        select: {
          id: true,
          code: true,
          name: true,
          businessCategory: true,
          enabled: true,
        },
      },
    },
    orderBy: [
      { postingType: { code: 'asc' as const } },
      { postingTypeId: 'asc' as const },
    ],
  },
} satisfies Prisma.FundBusinessSourceSelect

export type FundPostingRuleVersionViewRow = Prisma.FundPostingRuleVersionGetPayload<{
  select: typeof FUND_POSTING_RULE_VERSION_SELECT
}>
export type FundPostingTypeViewRow = Prisma.FundPostingTypeGetPayload<{
  select: typeof FUND_POSTING_TYPE_VIEW_SELECT
}>
export type FundBusinessSourceViewRow = Prisma.FundBusinessSourceGetPayload<{
  select: typeof FUND_BUSINESS_SOURCE_VIEW_SELECT
}>

export function mapFundPostingRuleVersionView(
  row: FundPostingRuleVersionViewRow,
): FundPostingRuleVersionView {
  return Object.freeze({
    id: row.id,
    revision: row.revision,
    status: row.status,
    createdByUserId: row.createdByUserId,
    publishedByUserId: row.publishedByUserId,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    legs: Object.freeze(row.legs.map(leg => Object.freeze({
      id: leg.id,
      position: leg.position,
      accountTarget: leg.accountTarget,
      directionPolicy: leg.directionPolicy,
      amountStrategy: leg.amountStrategy,
      adjustmentMode: leg.adjustmentMode,
    }))),
  })
}

export function mapFundPostingTypeView(
  row: FundPostingTypeViewRow,
): FundPostingTypeView {
  const draft = row.ruleVersions[0] ?? null
  return Object.freeze({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    businessCategory: row.businessCategory,
    requiresUser: row.requiresUser,
    amountSignPolicy: row.amountSignPolicy,
    inputMode: row.inputMode,
    enabled: row.enabled,
    currentRuleVersionId: row.currentRuleVersionId,
    version: row.version,
    activeRule: row.currentRuleVersion === null
      ? null
      : mapFundPostingRuleVersionView(row.currentRuleVersion),
    draftRule: draft === null ? null : mapFundPostingRuleVersionView(draft),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

export function mapFundBusinessSourceView(
  row: FundBusinessSourceViewRow,
): FundBusinessSourceView {
  return Object.freeze({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    version: row.version,
    allowedPostingTypes: Object.freeze(row.allowedPostingTypes.map(relation => (
      Object.freeze({
        id: relation.postingType.id,
        code: relation.postingType.code,
        name: relation.postingType.name,
        businessCategory: relation.postingType.businessCategory,
        enabled: relation.postingType.enabled,
        allowedAt: relation.createdAt.toISOString(),
      })
    ))),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}
