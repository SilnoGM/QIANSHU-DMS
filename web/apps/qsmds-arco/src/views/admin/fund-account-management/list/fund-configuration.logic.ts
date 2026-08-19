import type {
  CreateFundBusinessSourceRequestDto,
  CreateFundPostingTypeRequestDto,
  FundBusinessSourceDto,
  FundPostingRuleLegRequestDto,
  FundPostingTypeDto,
  ReplaceFundDraftRuleRequestDto,
  UpdateFundBusinessSourceRequestDto,
  UpdateFundPostingTypeRequestDto,
} from '@/api/generated/types.gen'

export interface FundPostingTypeCreateFormInput {
  amountSignPolicy: CreateFundPostingTypeRequestDto['amountSignPolicy']
  businessCategory: CreateFundPostingTypeRequestDto['businessCategory']
  code: string
  description: null | string
  legs: readonly FundPostingRuleLegRequestDto[]
  name: string
}

export interface FundBusinessSourceFormInput {
  allowedPostingTypeIds: readonly string[]
  description: null | string
  enabled: boolean
  name: string
}

export interface FundBusinessSourceCreateFormInput
  extends FundBusinessSourceFormInput {
  code: string
}

const CONFIGURATION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u

function normalizeText(
  value: string,
  fieldLabel: string,
  maximumCodePoints: number,
): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (
    normalized.length === 0
    || [...normalized].length > maximumCodePoints
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new RangeError(`${fieldLabel}不能为空且不能超过 ${maximumCodePoints} 个字符`)
  }
  return normalized
}

function normalizeDescription(value: null | string): null | string {
  if (value === null) {
    return null
  }
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) {
    return null
  }
  if (
    [...normalized].length > 500
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new RangeError('说明不能超过 500 个字符且不能包含控制字符')
  }
  return normalized
}

function normalizeCode(value: string): string {
  const normalized = value.normalize('NFC').trim().toUpperCase()
  if (!CONFIGURATION_CODE_PATTERN.test(normalized)) {
    throw new RangeError('编码必须以大写字母开头，且只能包含大写字母、数字和下划线')
  }
  return normalized
}

function normalizeAllowedPostingTypeIds(
  value: readonly string[],
): string[] {
  if (value.length > 100) {
    throw new RangeError('允许业务类型不能超过 100 项')
  }
  const normalized = value.map(item => item.trim())
  if (normalized.some(item => item.length === 0)) {
    throw new RangeError('允许业务类型包含无效标识')
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right))
}

/**
 * 首期标准类型只允许三种守恒拓扑：用户全额、公司全额、用户比例加公司尾差。
 * position 始终按界面顺序重建；禁止把管理员调账 adjustmentMode 混入普通类型。
 */
export function normalizeFundStandardRuleLegs(
  value: readonly FundPostingRuleLegRequestDto[],
  amountSignPolicy: CreateFundPostingTypeRequestDto['amountSignPolicy'],
): FundPostingRuleLegRequestDto[] {
  if (value.length < 1 || value.length > 2) {
    throw new RangeError('标准规则必须包含一到两条分录')
  }

  const legs = value.map((leg, index) => {
    if (leg.adjustmentMode !== undefined && leg.adjustmentMode !== null) {
      throw new RangeError('标准规则不能包含管理员调账模式')
    }
    if (
      amountSignPolicy === 'NON_ZERO_SIGNED'
      && leg.directionPolicy !== 'FOLLOW_AMOUNT_SIGN'
    ) {
      throw new RangeError('可正可负金额必须使用跟随金额符号方向')
    }
    return {
      accountTarget: leg.accountTarget,
      amountStrategy: leg.amountStrategy,
      directionPolicy: leg.directionPolicy,
      position: index + 1,
    }
  })

  if (new Set(legs.map(leg => leg.accountTarget)).size !== legs.length) {
    throw new RangeError('同一规则不能重复配置相同账户目标')
  }

  if (legs.length === 1) {
    if (legs[0]?.amountStrategy !== 'FULL_AMOUNT') {
      throw new RangeError('单账户规则必须使用全额金额策略')
    }
    return legs
  }

  const userLeg = legs.find(leg => leg.accountTarget === 'USER')
  const companyLeg = legs.find(leg => leg.accountTarget === 'COMPANY')
  if (
    userLeg?.amountStrategy !== 'USER_SHARE'
    || companyLeg?.amountStrategy !== 'COMPANY_REMAINDER'
  ) {
    throw new RangeError('双账户规则必须使用用户比例和公司尾差策略')
  }
  return legs
}

export function buildFundPostingTypeCreateRequest(
  input: FundPostingTypeCreateFormInput,
): CreateFundPostingTypeRequestDto {
  const code = normalizeCode(input.code)
  if (code === 'ADMIN_MANUAL_ADJUSTMENT') {
    throw new RangeError('管理员手动调账是系统保留类型，不能重复创建')
  }
  const legs = normalizeFundStandardRuleLegs(
    input.legs,
    input.amountSignPolicy,
  )
  return {
    amountSignPolicy: input.amountSignPolicy,
    businessCategory: input.businessCategory,
    code,
    description: normalizeDescription(input.description),
    legs,
    name: normalizeText(input.name, '类型名称', 128),
    requiresUser: legs.some(leg => leg.accountTarget === 'USER'),
  }
}

export function buildFundPostingTypeUpdateRequest(
  target: FundPostingTypeDto,
  name: string,
  description: null | string,
): UpdateFundPostingTypeRequestDto {
  return {
    description: normalizeDescription(description),
    expectedVersion: target.version,
    name: normalizeText(name, '类型名称', 128),
  }
}

export function buildFundDraftRuleRequest(
  target: FundPostingTypeDto,
  legs: readonly FundPostingRuleLegRequestDto[],
): ReplaceFundDraftRuleRequestDto {
  if (target.inputMode !== 'STANDARD') {
    throw new RangeError('系统管理员调账规则不允许编辑')
  }
  const normalizedLegs = normalizeFundStandardRuleLegs(
    legs,
    target.amountSignPolicy,
  )
  if (target.requiresUser !== normalizedLegs.some(leg => leg.accountTarget === 'USER')) {
    throw new RangeError('新规则的账户目标不能改变类型的用户账户要求')
  }
  return {
    expectedVersion: target.version,
    legs: normalizedLegs,
  }
}

export function buildFundBusinessSourceCreateRequest(
  input: FundBusinessSourceCreateFormInput,
): CreateFundBusinessSourceRequestDto {
  return {
    allowedPostingTypeIds: normalizeAllowedPostingTypeIds(
      input.allowedPostingTypeIds,
    ),
    code: normalizeCode(input.code),
    description: normalizeDescription(input.description),
    enabled: input.enabled,
    name: normalizeText(input.name, '来源名称', 128),
  }
}

export function buildFundBusinessSourceUpdateRequest(
  target: FundBusinessSourceDto,
  input: Omit<FundBusinessSourceFormInput, 'enabled'>,
): UpdateFundBusinessSourceRequestDto {
  return {
    allowedPostingTypeIds: normalizeAllowedPostingTypeIds(
      input.allowedPostingTypeIds,
    ),
    description: normalizeDescription(input.description),
    expectedVersion: target.version,
    name: normalizeText(input.name, '来源名称', 128),
  }
}

function comparableLeg(leg: {
  accountTarget: FundPostingRuleLegRequestDto['accountTarget']
  adjustmentMode?: FundPostingRuleLegRequestDto['adjustmentMode'] | null
  amountStrategy: FundPostingRuleLegRequestDto['amountStrategy']
  directionPolicy: FundPostingRuleLegRequestDto['directionPolicy']
  position: number
}): string {
  return [
    leg.position,
    leg.accountTarget,
    leg.directionPolicy,
    leg.amountStrategy,
    leg.adjustmentMode ?? '',
  ].join('|')
}

export function matchesFundPostingTypeDraft(
  latest: FundPostingTypeDto,
  expectedLegs: readonly FundPostingRuleLegRequestDto[],
): boolean {
  const actual = latest.draftRule?.legs
  if (actual === undefined || actual.length !== expectedLegs.length) {
    return false
  }
  const normalizedExpected = normalizeFundStandardRuleLegs(
    expectedLegs,
    latest.amountSignPolicy,
  )
  return actual.every((leg, index) => (
    comparableLeg(leg) === comparableLeg(normalizedExpected[index]!)
  ))
}

export function matchesFundPostingTypeStatus(
  latest: FundPostingTypeDto,
  enabled: boolean,
): boolean {
  return latest.enabled === enabled
}

export function matchesFundBusinessSource(
  latest: FundBusinessSourceDto,
  expected: FundBusinessSourceFormInput,
): boolean {
  const expectedIds = normalizeAllowedPostingTypeIds(
    expected.allowedPostingTypeIds,
  )
  const actualIds = normalizeAllowedPostingTypeIds(
    latest.allowedPostingTypes.map(item => item.id),
  )
  return latest.name === normalizeText(expected.name, '来源名称', 128)
    && latest.description === normalizeDescription(expected.description)
    && latest.enabled === expected.enabled
    && expectedIds.length === actualIds.length
    && expectedIds.every((id, index) => id === actualIds[index])
}

export function describeFundRuleTargets(
  legs: readonly FundPostingRuleLegRequestDto[],
): string {
  if (legs.length === 1 && legs[0]?.accountTarget === 'USER') {
    return '用户全额'
  }
  if (legs.length === 1 && legs[0]?.accountTarget === 'COMPANY') {
    return '公司全额'
  }
  if (
    legs.some(leg => leg.amountStrategy === 'USER_SHARE')
    && legs.some(leg => leg.amountStrategy === 'COMPANY_REMAINDER')
  ) {
    return '用户当前比例 / 公司尾差'
  }
  return '自定义受控分录'
}
