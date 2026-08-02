import type {
  ChangeNumberingRuleStatusRequestDto,
  CloneNumberingRuleRequestDto,
  CreateNumberingRuleRequestDto,
  NumberingRuleDetailDto,
  NumberingRuleIssuancesListData,
  NumberingRuleListItemDto,
  NumberingRulesListData,
  PreviewNumberingRuleRequestDto,
  PublishNumberingRuleRequestDto,
  UpdateNumberingRuleRequestDto,
} from '@/api/generated/types.gen'

export type NumberingRuleSegment
  = PreviewNumberingRuleRequestDto['segments'][number]
export type NumberingResetPolicy
  = PreviewNumberingRuleRequestDto['resetPolicy']
export type NumberingRuleStatus = NumberingRuleListItemDto['status']
export type NumberingVersionStatus
  = NumberingRuleListItemDto['displayVersion']['status']
export type NumberingPeriodStatus
  = NumberingRuleListItemDto['statistics']['periodStatus']

export interface NumberingRuleFormModel {
  description: string
  name: string
  resetPolicy: NumberingResetPolicy
  ruleCode: string
  segments: NumberingRuleSegment[]
}

export interface BuildNumberingRuleListQueryInput {
  readonly keyword: string
  readonly page: number
  readonly pageSize: number
  readonly sortOrder: unknown
  readonly status: unknown
}

export interface BuildNumberingIssuanceQueryInput {
  readonly consumerCode: string
  readonly generatedNumber: string
  readonly generatedNumberMatch: unknown
  readonly page: number
  readonly pageSize: number
  readonly periodKey: string
}

export interface NumberingActionPermissions {
  readonly canCreate: boolean
  readonly canDisable: boolean
  readonly canEnable: boolean
  readonly canPublish: boolean
  readonly canRead: boolean
  readonly canReadIssuances: boolean
  readonly canUpdate: boolean
}

export interface NumberingRuleActions {
  readonly canClone: boolean
  readonly canDisable: boolean
  readonly canEdit: boolean
  readonly canEnable: boolean
  readonly canPublish: boolean
  readonly canReadIssuances: boolean
  readonly hasAny: boolean
}

export interface NumberingMutationFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId: string | undefined
  readonly requiresRefresh: boolean
  readonly unknownResult: boolean
}

type NumberingRuleListQuery = NonNullable<NumberingRulesListData['query']>
type NumberingIssuanceQuery
  = NonNullable<NumberingRuleIssuancesListData['query']>

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_SEGMENTS = 32
const MAX_OUTPUT_LENGTH = 64
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)$/u
const POSITIVE_DECIMAL = /^[1-9]\d*$/u
const PERIOD_KEY = /^(?:ALL|\d{4}|\d{6}|\d{8})$/u
const CONSUMER_CODE = /^[A-Z][A-Z\d._-]{0,63}$/u
const GENERATED_NUMBER = /^[A-Z\d._/-]{1,64}$/u
const FORM_FIELDS = new Set([
  'description',
  'name',
  'resetPolicy',
  'ruleCode',
  'segments',
])
const DATE_OUTPUT_LENGTH: Readonly<Record<
  Extract<NumberingRuleSegment, { type: 'DATE' }>['format'],
  number
>> = {
  YYYY: 4,
  YY: 2,
  MM: 2,
  DD: 2,
  YYYYMM: 6,
  YYYYMMDD: 8,
  YYMMDD: 6,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeField(value: string): string {
  return value.normalize('NFC').trim()
}

function normalizeQueryText(value: string): string {
  return normalizeField(value).replaceAll(/\s+/gu, ' ')
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function normalizePage(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_PAGE
}

function normalizePageSize(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE
    ? value
    : DEFAULT_PAGE_SIZE
}

export function buildNumberingRuleListQuery(
  input: BuildNumberingRuleListQueryInput,
): NumberingRuleListQuery {
  const keyword = normalizeQueryText(input.keyword)
  const status = input.status === 'DRAFT'
    || input.status === 'ENABLED'
    || input.status === 'DISABLED'
    ? input.status
    : undefined
  const sortOrder = input.sortOrder === 'asc' ? 'asc' : 'desc'

  return {
    page: normalizePage(input.page),
    pageSize: normalizePageSize(input.pageSize),
    ...(keyword === '' || codePointLength(keyword) > 128
      ? {}
      : { keyword }),
    ...(status === undefined ? {} : { status }),
    sortBy: 'updatedAt',
    sortOrder,
  }
}

export function buildNumberingIssuanceQuery(
  input: BuildNumberingIssuanceQueryInput,
): NumberingIssuanceQuery {
  const periodKey = normalizeField(input.periodKey).toUpperCase()
  const consumerCode = normalizeField(input.consumerCode).toUpperCase()
  const generatedNumber = normalizeField(input.generatedNumber).toUpperCase()
  const generatedNumberMatch = input.generatedNumberMatch === 'PREFIX'
    ? 'PREFIX'
    : 'EXACT'
  const hasGeneratedNumber = GENERATED_NUMBER.test(generatedNumber)

  return {
    page: normalizePage(input.page),
    pageSize: normalizePageSize(input.pageSize),
    ...(PERIOD_KEY.test(periodKey) ? { periodKey } : {}),
    ...(CONSUMER_CODE.test(consumerCode) ? { consumerCode } : {}),
    ...(hasGeneratedNumber
      ? { generatedNumber, generatedNumberMatch }
      : {}),
  }
}

export function numberingRuleStatusLabel(status: NumberingRuleStatus): string {
  return {
    DRAFT: '草稿',
    ENABLED: '已启用',
    DISABLED: '已停用',
  }[status]
}

export function numberingVersionStatusLabel(
  status: NumberingVersionStatus,
): string {
  return {
    DRAFT: '待发布',
    ACTIVE: '生效中',
    RETIRED: '已归档',
  }[status]
}

export function numberingPeriodStatusLabel(
  status: NumberingPeriodStatus,
): string {
  return status === 'EXHAUSTED' ? '本周期已耗尽' : '本周期可用'
}

export function resolveNumberingRuleActions(
  rule: Pick<
    NumberingRuleListItemDto,
    'activeRevision' | 'draftRevision' | 'status'
  >,
  permissions: NumberingActionPermissions,
): NumberingRuleActions {
  const canClone = permissions.canRead && permissions.canCreate
  const canDisable = permissions.canDisable && rule.status === 'ENABLED'
  const canEdit = permissions.canUpdate
  const canEnable = permissions.canEnable
    && rule.status !== 'ENABLED'
    && rule.activeRevision !== null
  const canPublish = permissions.canPublish && rule.draftRevision !== null
  const canReadIssuances = permissions.canRead
    && permissions.canReadIssuances

  return {
    canClone,
    canDisable,
    canEdit,
    canEnable,
    canPublish,
    canReadIssuances,
    hasAny: canClone
      || canDisable
      || canEdit
      || canEnable
      || canPublish
      || canReadIssuances,
  }
}

export function addNumberingSegment(
  segments: readonly NumberingRuleSegment[],
  segment: NumberingRuleSegment,
): NumberingRuleSegment[] {
  if (segments.length >= MAX_SEGMENTS) {
    throw new RangeError('片段数量不能超过 32')
  }
  return [...segments, segment]
}

export function removeNumberingSegment(
  segments: readonly NumberingRuleSegment[],
  index: number,
): NumberingRuleSegment[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= segments.length) {
    return [...segments]
  }
  return segments.filter((_segment, position) => position !== index)
}

export function moveNumberingSegment(
  segments: readonly NumberingRuleSegment[],
  index: number,
  direction: 'down' | 'up',
): NumberingRuleSegment[] {
  const result = [...segments]
  const target = direction === 'up' ? index - 1 : index + 1
  if (
    !Number.isSafeInteger(index)
    || index < 0
    || index >= result.length
    || target < 0
    || target >= result.length
  ) {
    return result
  }

  const currentSegment = result[index]
  const targetSegment = result[target]
  if (currentSegment === undefined || targetSegment === undefined) {
    return result
  }
  result[index] = targetSegment
  result[target] = currentSegment
  return result
}

function cloneSegment(segment: NumberingRuleSegment): NumberingRuleSegment {
  return { ...segment }
}

export function createNumberingRuleFormModel(
  rule: NumberingRuleDetailDto | null,
): NumberingRuleFormModel {
  const source = rule?.draftVersion ?? rule?.activeVersion
  if (rule !== null && source !== null && source !== undefined) {
    return {
      description: rule.description ?? '',
      name: rule.name,
      resetPolicy: source.config.resetPolicy,
      ruleCode: rule.ruleCode,
      segments: source.config.segments.map(cloneSegment),
    }
  }

  return {
    description: '',
    name: '',
    resetPolicy: 'NEVER',
    ruleCode: '',
    segments: [{
      type: 'SEQUENCE',
      width: 6,
      startValue: '1',
      step: '1',
    }],
  }
}

function setError(
  errors: Record<string, string>,
  path: string,
  message: string,
): void {
  if (errors[path] === undefined) {
    errors[path] = message
  }
}

function validateSequenceSegment(
  segment: Extract<NumberingRuleSegment, { type: 'SEQUENCE' }>,
  path: string,
  errors: Record<string, string>,
): number {
  if (!Number.isInteger(segment.width) || segment.width < 1 || segment.width > 18) {
    setError(errors, `${path}.width`, '自增数字位数必须是 1 到 18 的整数')
    return 0
  }
  if (!NON_NEGATIVE_DECIMAL.test(segment.startValue)) {
    setError(errors, `${path}.startValue`, '起始值必须是规范的非负整数')
  }
  if (!POSITIVE_DECIMAL.test(segment.step)) {
    setError(errors, `${path}.step`, '步长必须是规范的正整数')
  }
  const maximum = 10n ** BigInt(segment.width) - 1n
  if (
    NON_NEGATIVE_DECIMAL.test(segment.startValue)
    && BigInt(segment.startValue) > maximum
  ) {
    setError(errors, `${path}.startValue`, '起始值超出当前位数可表示范围')
  }
  if (
    POSITIVE_DECIMAL.test(segment.step)
    && BigInt(segment.step) > maximum
  ) {
    setError(errors, `${path}.step`, '步长超出当前位数可表示范围')
  }
  return segment.width
}

function validateRandomSegment(
  segment: Extract<NumberingRuleSegment, { type: 'RANDOM' }>,
  path: string,
  errors: Record<string, string>,
): number {
  const lengthsValid = Number.isInteger(segment.letterLength)
    && segment.letterLength >= 0
    && segment.letterLength <= 32
    && Number.isInteger(segment.digitLength)
    && segment.digitLength >= 0
    && segment.digitLength <= 32
  const total = segment.letterLength + segment.digitLength
  if (!lengthsValid || total < 1 || total > 32) {
    setError(errors, path, '随机字母与数字总长度必须是 1 到 32')
    return 0
  }
  return total
}

function dateParts(
  format: Extract<NumberingRuleSegment, { type: 'DATE' }>['format'],
): { day: boolean, month: boolean, year: boolean } {
  return {
    year: format.includes('YY'),
    month: format.includes('MM'),
    day: format.includes('DD'),
  }
}

/**
 * Web 只做快速、确定且无副作用的校验；发布兼容性、周期容量和最终 preview
 * 仍以 Server 为真相源。十进制边界只使用字符串与 bigint，不经过浮点数。
 */
export function validateNumberingRuleForm(
  model: NumberingRuleFormModel,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {}
  const ruleCode = normalizeField(model.ruleCode).toUpperCase()
  const name = normalizeField(model.name)
  const description = normalizeField(model.description)

  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(ruleCode)) {
    setError(errors, 'ruleCode', '规则编码须以字母开头且只包含大写字母、数字和下划线')
  }
  if (name === '' || codePointLength(name) > 128) {
    setError(errors, 'name', '名称应为 1 到 128 个字符且不能全为空白')
  }
  if (codePointLength(description) > 500) {
    setError(errors, 'description', '说明不能超过 500 个字符')
  }
  if (model.segments.length < 1 || model.segments.length > MAX_SEGMENTS) {
    setError(errors, 'segments', '片段数量必须是 1 到 32')
  }

  let sequenceCount = 0
  let randomCount = 0
  let outputLength = 0
  let hasYear = false
  let hasMonth = false
  let hasDay = false
  model.segments.forEach((segment, index) => {
    const path = `segments[${index}]`
    switch (segment.type) {
      case 'FIXED':
        if (!/^[A-Z0-9]{1,64}$/u.test(segment.value)) {
          setError(errors, `${path}.value`, '固定字符只能包含 1 到 64 位大写字母或数字')
        }
        outputLength += segment.value.length
        break
      case 'DATE': {
        const parts = dateParts(segment.format)
        hasYear ||= parts.year
        hasMonth ||= parts.month
        hasDay ||= parts.day
        outputLength += DATE_OUTPUT_LENGTH[segment.format]
        if (
          model.resetPolicy !== 'NEVER'
          && (segment.format === 'YY' || segment.format === 'YYMMDD')
        ) {
          setError(errors, `${path}.format`, '重置规则不能使用两位年份日期格式')
        }
        break
      }
      case 'SEPARATOR':
        outputLength += 1
        break
      case 'SEQUENCE':
        sequenceCount += 1
        outputLength += validateSequenceSegment(segment, path, errors)
        break
      case 'RANDOM':
        randomCount += 1
        outputLength += validateRandomSegment(segment, path, errors)
        break
    }
  })

  if (sequenceCount + randomCount === 0) {
    setError(errors, 'segments', '至少需要一个自增数字或随机字符串片段')
  }
  if (sequenceCount > 1) {
    setError(errors, 'segments', '最多只能添加一个自增数字片段')
  }
  if (randomCount > 1) {
    setError(errors, 'segments', '最多只能添加一个随机字符串片段')
  }
  if (outputLength > MAX_OUTPUT_LENGTH) {
    setError(errors, 'segments', '编号最大输出长度不能超过 64')
  }
  const missingPeriodDate = (
    model.resetPolicy === 'YEARLY' && !hasYear
  ) || (
    model.resetPolicy === 'MONTHLY' && (!hasYear || !hasMonth)
  ) || (
    model.resetPolicy === 'DAILY' && (!hasYear || !hasMonth || !hasDay)
  )
  if (missingPeriodDate) {
    setError(errors, 'segments', '日期片段不足以区分当前重置周期')
  }

  return errors
}

function normalizedSegments(
  segments: readonly NumberingRuleSegment[],
): NumberingRuleSegment[] {
  return segments.map((segment) => {
    switch (segment.type) {
      case 'FIXED':
        return { ...segment, value: normalizeField(segment.value).toUpperCase() }
      case 'SEQUENCE':
        return {
          ...segment,
          startValue: normalizeField(segment.startValue),
          step: normalizeField(segment.step),
        }
      default:
        return { ...segment }
    }
  })
}

export function buildCreateNumberingRuleRequest(
  model: NumberingRuleFormModel,
): CreateNumberingRuleRequestDto {
  const description = normalizeField(model.description)
  return {
    resetPolicy: model.resetPolicy,
    segments: normalizedSegments(model.segments),
    ruleCode: normalizeField(model.ruleCode).toUpperCase(),
    name: normalizeField(model.name),
    ...(description === '' ? {} : { description }),
  }
}

export function buildUpdateNumberingRuleRequest(
  model: NumberingRuleFormModel,
  rule: NumberingRuleDetailDto,
): UpdateNumberingRuleRequestDto {
  const description = normalizeField(model.description)
  return {
    resetPolicy: model.resetPolicy,
    segments: normalizedSegments(model.segments),
    name: normalizeField(model.name),
    description: description === '' ? null : description,
    expectedVersion: rule.version,
  }
}

export function buildPreviewNumberingRuleRequest(
  model: NumberingRuleFormModel,
  ruleId?: string,
): PreviewNumberingRuleRequestDto {
  return {
    resetPolicy: model.resetPolicy,
    segments: normalizedSegments(model.segments),
    ...(ruleId === undefined ? {} : { ruleId }),
  }
}

export function buildPublishNumberingRuleRequest(
  rule: NumberingRuleDetailDto,
): PublishNumberingRuleRequestDto {
  if (rule.draftVersion === null) {
    throw new RangeError('当前规则没有可发布草稿')
  }
  return {
    expectedVersion: rule.version,
    draftRevision: rule.draftVersion.revision,
  }
}

export function buildChangeNumberingRuleStatusRequest(
  rule: NumberingRuleDetailDto,
): ChangeNumberingRuleStatusRequestDto {
  return { expectedVersion: rule.version }
}

export function buildCloneNumberingRuleRequest(
  model: NumberingRuleFormModel,
  source: NumberingRuleDetailDto,
): CloneNumberingRuleRequestDto {
  const description = normalizeField(model.description)
  return {
    expectedVersion: source.version,
    ruleCode: normalizeField(model.ruleCode).toUpperCase(),
    name: normalizeField(model.name),
    description: description === '' ? null : description,
  }
}

export function formatNumberingDecimal(value: string): string {
  if (!NON_NEGATIVE_DECIMAL.test(value)) {
    return '—'
  }
  return value.replace(/\B(?=(?:\d{3})+(?!\d))/gu, ',')
}

function isNumberingFieldPath(path: string): boolean {
  return FORM_FIELDS.has(path)
    || /^segments\[\d+\](?:\.[A-Za-z]+)?$/u.test(path)
}

/**
 * mutation 只读取标准化 API client 的公开结构。网络错误可能发生在提交之后，
 * 因此标记结果未知并要求刷新核对，绝不依据底层 message 猜测数据库状态。
 */
export function getNumberingMutationFailure(
  error: unknown,
): NumberingMutationFailure {
  const fallback: NumberingMutationFailure = {
    code: undefined,
    fieldErrors: {},
    message: '编号规则操作失败，请稍后重试',
    requestId: undefined,
    requiresRefresh: false,
    unknownResult: false,
  }

  try {
    if (!isRecord(error)) {
      return fallback
    }
    if (error.kind === 'network') {
      return {
        ...fallback,
        message: typeof error.message === 'string'
          ? error.message
          : '网络连接失败，请重新加载后核对规则状态',
        requiresRefresh: true,
        unknownResult: true,
      }
    }
    if (error.kind !== 'http' || !isRecord(error.body)) {
      return fallback
    }

    const body = error.body
    const code = typeof body.code === 'string' ? body.code : undefined
    const message = typeof body.message === 'string'
      ? body.message
      : fallback.message
    const fieldErrors: Record<string, string> = {}
    if (isRecord(body.fieldErrors)) {
      for (const [field, messages] of Object.entries(body.fieldErrors)) {
        if (
          isNumberingFieldPath(field)
          && Array.isArray(messages)
          && typeof messages[0] === 'string'
        ) {
          fieldErrors[field] = messages[0]
        }
      }
    }
    if (
      code === 'NUMBERING_RULE_CODE_ALREADY_EXISTS'
      && fieldErrors.ruleCode === undefined
    ) {
      fieldErrors.ruleCode = message
    }

    return {
      code,
      fieldErrors,
      message,
      requestId: typeof body.requestId === 'string'
        ? body.requestId
        : typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
      requiresRefresh: code === 'NUMBERING_RULE_STATE_CHANGED',
      unknownResult: false,
    }
  }
  catch {
    return fallback
  }
}
