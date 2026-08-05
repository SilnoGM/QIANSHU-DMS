import type {
  CreateSupplierRequestDto,
  SupplierDto,
  SupplierListItemDto,
  SupplierListQuery,
  UpdateSupplierRequestDto,
} from '@/api/modules/suppliers'
import type { RegionSelectorValue } from '@/components/business/QsRegionSelector/types'

export type { SupplierDto } from '@/api/modules/suppliers'

export type SupplierFormMode = 'create' | 'edit'
export type SupplierEntityType = SupplierDto['entityType']
export type SupplierMutationKind = 'create' | 'status' | 'update'

export interface SupplierFormModel {
  entityType: SupplierEntityType
  legalName: string
  primaryAddressLine: string
  primaryAddressPostalCode: string
  primaryAddressRegion: RegionSelectorValue
  primaryContactName: string
  primaryContactPhone: string
  primaryContactWechatId: string
  registrationCountryRegionId: string | null
  registrationNumber: string
  remark: string
  shortName: string
}

export type SupplierFormField
  = | 'entityType'
    | 'legalName'
    | 'primaryAddress.addressLine'
    | 'primaryAddress.postalCode'
    | 'primaryAddress.region'
    | 'primaryContact.channel'
    | 'primaryContact.name'
    | 'primaryContact.phone'
    | 'primaryContact.wechatId'
    | 'registration.countryRegionId'
    | 'registration.number'
    | 'remark'
    | 'shortName'

export type SupplierFormErrors = Partial<Record<SupplierFormField, string>>
export type SupplierFormFieldErrorValue = readonly string[] | string
export type SupplierFormFieldErrors = Readonly<
  Partial<Record<SupplierFormField, SupplierFormFieldErrorValue>>
>
export type SupplierStatusAction = 'disable' | 'enable'

export interface SupplierStatusPresentation {
  readonly action: SupplierStatusAction
  readonly canConfirm: boolean
  readonly confirmLabel: string
  readonly destructive: boolean
  readonly impact: string
  readonly title: string
}

export interface BuildSupplierListQueryInput {
  readonly entityType: unknown
  readonly page: number
  readonly pageSize: number
  readonly query: string
  readonly sortBy: unknown
  readonly sortOrder: unknown
  readonly status: unknown
}

export interface SupplierActionPermissions {
  readonly canDisable: boolean
  readonly canEnable: boolean
  readonly canRead: boolean
  readonly canUpdate: boolean
}

export interface SupplierActions {
  readonly canDisable: boolean
  readonly canEdit: boolean
  readonly canEnable: boolean
  readonly canView: boolean
  readonly hasAny: boolean
}

export interface SupplierMutationFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId: string | undefined
  readonly requiresRefresh: boolean
  readonly unknownResult: boolean
}

export interface SupplierQueryResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface SupplierMutationResultGuardInput {
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly currentGeneration: number
  readonly currentTargetId: string | null
  readonly generation: number
  readonly targetId: string | null
}

export interface SupplierCreateIntent {
  readonly idempotencyKey: string
  readonly payload: Readonly<CreateSupplierRequestDto>
  readonly state: 'ready' | 'unknown'
}

const PAGE_SIZES = new Set([20, 50, 100])
const ENTITY_TYPES = new Set<SupplierEntityType>([
  'INDIVIDUAL',
  'ORGANIZATION',
])
const SORT_FIELDS = new Set<NonNullable<SupplierListQuery['sortBy']>>([
  'code',
  'legalName',
  'updatedAt',
])
const MUTATION_FIELDS = new Set<SupplierFormField>([
  'entityType',
  'legalName',
  'primaryAddress.addressLine',
  'primaryAddress.postalCode',
  'primaryAddress.region',
  'primaryContact.channel',
  'primaryContact.name',
  'primaryContact.phone',
  'primaryContact.wechatId',
  'registration.countryRegionId',
  'registration.number',
  'remark',
  'shortName',
])
const FORM_FIELD_ORDER = [
  'legalName',
  'shortName',
  'entityType',
  'registration.countryRegionId',
  'registration.number',
  'primaryContact.name',
  'primaryContact.phone',
  'primaryContact.wechatId',
  'primaryContact.channel',
  'primaryAddress.region',
  'primaryAddress.addressLine',
  'primaryAddress.postalCode',
  'remark',
] as const satisfies readonly SupplierFormField[]
const CANONICAL_UUID_V4
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const UUID
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const PHONE_DISPLAY_SEPARATOR_PATTERN
  = /[\p{White_Space}()[\]（）［］{}｛｝.．·・‐‑‒–—―-]/gu

function normalizeText(value: string): string {
  return value.normalize('NFC').trim()
}

function normalizeOptionalText(value: string): string | null {
  const normalized = normalizeText(value)
  return normalized === '' ? null : normalized
}

function normalizeQueryText(value: string): string {
  return normalizeText(value).replaceAll(/\p{White_Space}+/gu, ' ')
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateOptionalLength(
  errors: SupplierFormErrors,
  field: SupplierFormField,
  value: string,
  maximum: number,
  message: string,
): void {
  if (codePointLength(normalizeText(value)) > maximum) {
    errors[field] = message
  }
}

export function buildSupplierListQuery(
  input: BuildSupplierListQueryInput,
): SupplierListQuery {
  const query = normalizeQueryText(input.query)
  const entityType = input.entityType === 'ORGANIZATION'
    || input.entityType === 'INDIVIDUAL'
    ? input.entityType
    : undefined
  const status = input.status === 'ENABLED' || input.status === 'DISABLED'
    ? input.status
    : undefined
  const sortBy = SORT_FIELDS.has(
    input.sortBy as NonNullable<SupplierListQuery['sortBy']>,
  )
    ? input.sortBy as NonNullable<SupplierListQuery['sortBy']>
    : 'updatedAt'

  return {
    page: Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1,
    pageSize: PAGE_SIZES.has(input.pageSize) ? input.pageSize : 20,
    ...(query === '' ? {} : { query }),
    ...(status === undefined ? {} : { status }),
    ...(entityType === undefined ? {} : { entityType }),
    sortBy,
    sortOrder: input.sortOrder === 'asc' ? 'asc' : 'desc',
  }
}

export function createSupplierFormModel(
  mode: SupplierFormMode,
  supplier: SupplierDto | null,
): SupplierFormModel {
  if (mode === 'edit' && supplier !== null) {
    return {
      entityType: supplier.entityType,
      legalName: supplier.legalName,
      primaryAddressLine: supplier.primaryAddress?.addressLine ?? '',
      primaryAddressPostalCode: supplier.primaryAddress?.postalCode ?? '',
      primaryAddressRegion: {
        countryRegionId: supplier.primaryAddress?.countryRegionId ?? null,
        provinceStateId: supplier.primaryAddress?.provinceStateId ?? null,
        cityId: supplier.primaryAddress?.cityId ?? null,
      },
      primaryContactName: supplier.primaryContact?.name ?? '',
      primaryContactPhone: supplier.primaryContact?.phone ?? '',
      primaryContactWechatId: supplier.primaryContact?.wechatId ?? '',
      registrationCountryRegionId:
        supplier.registration?.countryRegion.id ?? null,
      registrationNumber: supplier.registration?.number ?? '',
      remark: supplier.remark ?? '',
      shortName: supplier.shortName ?? '',
    }
  }

  return {
    entityType: 'ORGANIZATION',
    legalName: '',
    primaryAddressLine: '',
    primaryAddressPostalCode: '',
    primaryAddressRegion: {
      cityId: null,
      countryRegionId: null,
      provinceStateId: null,
    },
    primaryContactName: '',
    primaryContactPhone: '',
    primaryContactWechatId: '',
    registrationCountryRegionId: null,
    registrationNumber: '',
    remark: '',
    shortName: '',
  }
}

/** 抽屉始终编辑隔离副本，尤其不能与父页面共享地区对象引用。 */
export function cloneSupplierFormModel(
  model: SupplierFormModel,
): SupplierFormModel {
  return {
    ...model,
    primaryAddressRegion: { ...model.primaryAddressRegion },
  }
}

function resolveFieldErrorMessage(
  value: SupplierFormFieldErrorValue | undefined,
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && candidate.trim() !== ''
    ? candidate
    : undefined
}

export function resolveSupplierFormFieldErrors(
  errors: SupplierFormFieldErrors | undefined,
): SupplierFormErrors {
  if (errors === undefined) {
    return {}
  }
  const resolved: SupplierFormErrors = {}
  for (const field of FORM_FIELD_ORDER) {
    const message = resolveFieldErrorMessage(errors[field])
    if (message !== undefined) {
      resolved[field] = message
    }
  }
  return resolved
}

export function firstSupplierFormErrorField(
  errors: SupplierFormErrors,
): SupplierFormField | undefined {
  return FORM_FIELD_ORDER.find(field => errors[field] !== undefined)
}

export function resolveSupplierEnableReadiness(
  model: SupplierFormModel,
): SupplierDto['enableReadiness'] {
  const missingFields: SupplierDto['enableReadiness']['missingFields'] = []
  if (normalizeOptionalText(model.primaryContactName) === null) {
    missingFields.push('primaryContact.name')
  }
  if (
    normalizeOptionalText(model.primaryContactPhone) === null
    && normalizeOptionalText(model.primaryContactWechatId) === null
  ) {
    missingFields.push('primaryContact.channel')
  }
  return { ready: missingFields.length === 0, missingFields }
}

/**
 * Web 校验只用于快速反馈，Server 仍是唯一业务真相源。`requireEnableReady`
 * 仅用于已启用记录编辑和启用操作；登记、地址与邮编从不参与启用门槛。
 */
export function validateSupplierForm(
  model: SupplierFormModel,
  requireEnableReady: boolean,
): SupplierFormErrors {
  const errors: SupplierFormErrors = {}
  const legalName = normalizeText(model.legalName)
  if (codePointLength(legalName) < 1 || codePointLength(legalName) > 200) {
    errors.legalName = '法定名称应为 1 到 200 个字符'
  }
  if (!ENTITY_TYPES.has(model.entityType)) {
    errors.entityType = '请选择有效的主体类型'
  }

  validateOptionalLength(errors, 'shortName', model.shortName, 100, '简称不能超过 100 个字符')
  validateOptionalLength(errors, 'registration.number', model.registrationNumber, 64, '登记号不能超过 64 个字符')
  validateOptionalLength(errors, 'primaryContact.name', model.primaryContactName, 128, '联系人姓名不能超过 128 个字符')
  validateOptionalLength(errors, 'primaryContact.phone', model.primaryContactPhone, 32, '联系人电话不能超过 32 个字符')
  validateOptionalLength(errors, 'primaryContact.wechatId', model.primaryContactWechatId, 64, '联系人微信号不能超过 64 个字符')
  validateOptionalLength(errors, 'primaryAddress.addressLine', model.primaryAddressLine, 500, '详细地址不能超过 500 个字符')
  validateOptionalLength(errors, 'primaryAddress.postalCode', model.primaryAddressPostalCode, 32, '邮编不能超过 32 个字符')
  validateOptionalLength(errors, 'remark', model.remark, 1000, '备注不能超过 1000 个字符')

  const hasRegistrationCountry = model.registrationCountryRegionId !== null
    && model.registrationCountryRegionId !== ''
  const hasRegistrationNumber
    = normalizeOptionalText(model.registrationNumber) !== null
  if (hasRegistrationCountry !== hasRegistrationNumber) {
    errors[hasRegistrationCountry
      ? 'registration.number'
      : 'registration.countryRegionId']
      = '登记国家/地区与登记号必须同时填写或同时留空'
  }
  if (
    hasRegistrationCountry
    && !UUID.test(model.registrationCountryRegionId ?? '')
  ) {
    errors['registration.countryRegionId'] = '请选择有效的登记国家/地区'
  }

  const { cityId, countryRegionId, provinceStateId }
    = model.primaryAddressRegion
  const invalidAddressPrefix = (provinceStateId !== null && countryRegionId === null)
    || (cityId !== null && provinceStateId === null)
  const invalidAddressId = [countryRegionId, provinceStateId, cityId]
    .some(value => value !== null && !UUID.test(value))
  if (invalidAddressPrefix || invalidAddressId) {
    errors['primaryAddress.region']
      = '主要地址地区必须按国家/地区、省/州、城市依次选择'
  }

  // 电话展示值合规后，还需防止去除展示分隔符后的派生搜索值越界。
  const normalizedPhone = normalizeText(model.primaryContactPhone)
    .normalize('NFKC')
    .replace(PHONE_DISPLAY_SEPARATOR_PATTERN, '')
  if (codePointLength(normalizedPhone) > 32) {
    errors['primaryContact.phone'] = '联系人电话不能超过 32 个字符'
  }

  if (requireEnableReady) {
    const readiness = resolveSupplierEnableReadiness(model)
    if (readiness.missingFields.includes('primaryContact.name')) {
      errors['primaryContact.name'] = '启用前必须填写联系人姓名'
    }
    if (readiness.missingFields.includes('primaryContact.channel')) {
      errors['primaryContact.channel'] = '联系人电话或微信号至少填写一项'
    }
  }

  return errors
}

function buildNormalizedMutableFields(
  model: SupplierFormModel,
): Omit<UpdateSupplierRequestDto, 'expectedVersion'> {
  const registrationNumber = normalizeOptionalText(model.registrationNumber)
  const contact = {
    name: normalizeOptionalText(model.primaryContactName),
    phone: normalizeOptionalText(model.primaryContactPhone),
    wechatId: normalizeOptionalText(model.primaryContactWechatId),
  }
  const primaryContact = Object.values(contact).every(value => value === null)
    ? null
    : contact
  const address = {
    countryRegionId: model.primaryAddressRegion.countryRegionId,
    provinceStateId: model.primaryAddressRegion.provinceStateId,
    cityId: model.primaryAddressRegion.cityId,
    addressLine: normalizeOptionalText(model.primaryAddressLine),
    postalCode: normalizeOptionalText(model.primaryAddressPostalCode),
  }
  const primaryAddress = Object.values(address).every(value => value === null)
    ? null
    : address

  return {
    legalName: normalizeText(model.legalName),
    shortName: normalizeOptionalText(model.shortName),
    entityType: model.entityType,
    registration: model.registrationCountryRegionId === null
      || registrationNumber === null
      ? null
      : {
          countryRegionId: model.registrationCountryRegionId,
          number: registrationNumber,
        },
    primaryContact,
    primaryAddress,
    remark: normalizeOptionalText(model.remark),
  }
}

export function buildCreateSupplierRequest(
  model: SupplierFormModel,
): CreateSupplierRequestDto {
  return buildNormalizedMutableFields(model) as CreateSupplierRequestDto
}

export function buildUpdateSupplierRequest(
  model: SupplierFormModel,
  supplier: SupplierDto,
): UpdateSupplierRequestDto {
  return {
    ...buildNormalizedMutableFields(model),
    expectedVersion: supplier.version,
  }
}

export function hasSupplierFormChanges(
  model: SupplierFormModel,
  supplier: SupplierDto,
): boolean {
  const current = buildUpdateSupplierRequest(
    createSupplierFormModel('edit', supplier),
    supplier,
  )
  return JSON.stringify(buildUpdateSupplierRequest(model, supplier))
    !== JSON.stringify(current)
}

export function resolveSupplierActions(
  supplier: Pick<SupplierListItemDto, 'enabled'>,
  permissions: SupplierActionPermissions,
): SupplierActions {
  const canView = permissions.canRead
  const canEdit = canView && permissions.canUpdate
  const canEnable = canView && permissions.canEnable && !supplier.enabled
  const canDisable = canView && permissions.canDisable && supplier.enabled
  return {
    canDisable,
    canEdit,
    canEnable,
    canView,
    hasAny: canView || canEdit || canEnable || canDisable,
  }
}

export function buildSupplierStatusRequest(
  supplier: SupplierDto,
): { readonly expectedVersion: number } {
  return { expectedVersion: supplier.version }
}

export function buildSupplierStatusPresentation(
  action: SupplierStatusAction,
  supplier: SupplierDto,
): SupplierStatusPresentation {
  if (action === 'disable') {
    return {
      action,
      canConfirm: supplier.enabled,
      confirmLabel: '确认停用',
      destructive: true,
      impact: '停用后该供应商不再进入后续业务使用范围；历史资料继续保留，不删除任何数据。',
      title: '确认停用供应商',
    }
  }

  const missingLabels = supplier.enableReadiness.missingFields.map(field => ({
    'primaryContact.channel': '联系人电话或微信号',
    'primaryContact.name': '联系人姓名',
  })[field])
  return {
    action,
    canConfirm: !supplier.enabled && supplier.enableReadiness.ready,
    confirmLabel: '确认启用',
    destructive: false,
    impact: supplier.enableReadiness.ready
      ? '启用后该供应商可进入后续业务使用范围；登记、地址和邮编仍可为空。'
      : `暂不能启用，请先补充${missingLabels.join('、')}。`,
    title: '确认启用供应商',
  }
}

/**
 * mutation 错误仅消费标准 API client 的公开结构。网络错误可能发生在提交之后，
 * 创建时必须保留同一创建意图；任何底层异常文本都不得进入供应商页面或 Toast。
 */
export function getSupplierMutationFailure(
  error: unknown,
  kind: SupplierMutationKind = 'update',
): SupplierMutationFailure {
  const fallback: SupplierMutationFailure = {
    code: undefined,
    fieldErrors: {},
    message: '供应商操作失败，请稍后重试',
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
        message: kind === 'create'
          ? '网络中断，创建结果未知，请使用原请求确认结果'
          : '网络中断，操作结果未知，请重新加载核对供应商状态',
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
          MUTATION_FIELDS.has(field as SupplierFormField)
          && Array.isArray(messages)
          && typeof messages[0] === 'string'
        ) {
          fieldErrors[field] = messages[0]
        }
      }
    }
    if (
      code === 'SUPPLIER_REGISTRATION_ALREADY_EXISTS'
      && fieldErrors['registration.number'] === undefined
    ) {
      fieldErrors['registration.number'] = message
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
      requiresRefresh: code === 'SUPPLIER_STATE_CHANGED',
      unknownResult: false,
    }
  }
  catch {
    return fallback
  }
}

function freezeCreatePayload(
  payload: CreateSupplierRequestDto,
): Readonly<CreateSupplierRequestDto> {
  if (payload.registration !== null && payload.registration !== undefined) {
    Object.freeze(payload.registration)
  }
  if (payload.primaryContact !== null && payload.primaryContact !== undefined) {
    Object.freeze(payload.primaryContact)
  }
  if (payload.primaryAddress !== null && payload.primaryAddress !== undefined) {
    Object.freeze(payload.primaryAddress)
  }
  return Object.freeze(payload)
}

function cloneCreatePayload(
  payload: CreateSupplierRequestDto,
): CreateSupplierRequestDto {
  return {
    ...payload,
    registration: payload.registration === undefined
      ? undefined
      : payload.registration === null
        ? null
        : { ...payload.registration },
    primaryContact: payload.primaryContact === undefined
      ? undefined
      : payload.primaryContact === null
        ? null
        : { ...payload.primaryContact },
    primaryAddress: payload.primaryAddress === undefined
      ? undefined
      : payload.primaryAddress === null
        ? null
        : { ...payload.primaryAddress },
  }
}

export function createSupplierCreateIntentFromPayload(
  payload: CreateSupplierRequestDto,
  idempotencyKey: string = crypto.randomUUID(),
): SupplierCreateIntent {
  if (!CANONICAL_UUID_V4.test(idempotencyKey)) {
    throw new TypeError('Idempotency-Key 必须是 canonical lowercase UUID v4')
  }
  return Object.freeze({
    idempotencyKey,
    payload: freezeCreatePayload(cloneCreatePayload(payload)),
    state: 'ready' as const,
  })
}

/** 创建意图在首次发送前冻结，页面状态变化不得改变后续人工确认的 payload/key。 */
export function createSupplierCreateIntent(
  model: SupplierFormModel,
  idempotencyKey: string = crypto.randomUUID(),
): SupplierCreateIntent {
  return createSupplierCreateIntentFromPayload(
    buildCreateSupplierRequest(model),
    idempotencyKey,
  )
}

export function markSupplierCreateIntentUnknown(
  intent: SupplierCreateIntent,
): SupplierCreateIntent {
  return Object.freeze({ ...intent, state: 'unknown' as const })
}

/** 该显式函数只能由“使用原请求确认结果”按钮调用，禁止后台自动重放。 */
export function retrySupplierCreateIntent(
  intent: SupplierCreateIntent,
): {
  readonly idempotencyKey: string
  readonly payload: Readonly<CreateSupplierRequestDto>
} {
  if (intent.state !== 'unknown') {
    throw new Error('只有创建结果未知时才允许手动重放')
  }
  return {
    idempotencyKey: intent.idempotencyKey,
    payload: intent.payload,
  }
}

export function canApplySupplierQueryResponse(
  input: SupplierQueryResponseGuardInput,
): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

export function canApplySupplierMutationResult(
  input: SupplierMutationResultGuardInput,
): boolean {
  return input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.generation === input.currentGeneration
    && input.targetId === input.currentTargetId
}

export function isSupplierAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException
      && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && error.code === 'ERR_CANCELED'
    )
  }
  catch {
    return false
  }
}

export function getSupplierApiFailure(error: unknown): {
  readonly message: string
  readonly requestId: string | undefined
} {
  const failure = getSupplierMutationFailure(error)
  return {
    message: failure.message === '供应商操作失败，请稍后重试'
      ? '供应商资料加载失败，请稍后重试'
      : failure.message,
    requestId: failure.requestId,
  }
}
