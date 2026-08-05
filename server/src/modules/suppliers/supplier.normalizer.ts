import { HttpStatus } from '@nestjs/common'

import {
  SupplierEntityType,
  type SupplierEntityType as SupplierEntityTypeValue,
} from '../../generated/prisma/enums'
import { ApiException } from '../../infrastructure/http/api.exception'

const EDGE_UNICODE_WHITESPACE_PATTERN =
  /^\p{White_Space}+|\p{White_Space}+$/gu
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const PHONE_DISPLAY_SEPARATOR_PATTERN =
  /[\p{White_Space}()（）［］{}｛｝.．·・‐‑‒–—―-]|\[|\]/gu
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const LIMITS = {
  legalName: 200,
  shortName: 100,
  registrationNumber: 64,
  contactName: 128,
  contactPhone: 32,
  contactWechatId: 64,
  addressLine: 500,
  postalCode: 32,
  remark: 1000,
} as const

type SupplierTextField =
  | 'legalName'
  | 'shortName'
  | 'registration.number'
  | 'primaryContact.name'
  | 'primaryContact.phone'
  | 'primaryContact.wechatId'
  | 'primaryAddress.addressLine'
  | 'primaryAddress.postalCode'
  | 'remark'

export interface SupplierRegistrationInput {
  readonly countryRegionId: string
  readonly number: string
}

export interface SupplierPrimaryContactInput {
  readonly name: string | null
  readonly phone: string | null
  readonly wechatId: string | null
}

export interface SupplierPrimaryAddressInput {
  readonly countryRegionId: string | null
  readonly provinceStateId: string | null
  readonly cityId: string | null
  readonly addressLine: string | null
  readonly postalCode: string | null
}

export interface CreateSupplierInput {
  readonly legalName: string
  readonly shortName?: string | null
  readonly entityType: SupplierEntityTypeValue
  readonly registration?: SupplierRegistrationInput | null
  readonly primaryContact?: SupplierPrimaryContactInput | null
  readonly primaryAddress?: SupplierPrimaryAddressInput | null
  readonly remark?: string | null
}

export interface UpdateSupplierInput {
  readonly legalName?: string
  readonly shortName?: string | null
  readonly entityType?: SupplierEntityTypeValue
  readonly registration?: SupplierRegistrationInput | null
  readonly primaryContact?: SupplierPrimaryContactInput | null
  readonly primaryAddress?: SupplierPrimaryAddressInput | null
  readonly remark?: string | null
  readonly expectedVersion: number
}

export interface NormalizedSupplierRegistration {
  readonly countryRegionId: string
  readonly number: string
  readonly normalizedNumber: string
}

export interface NormalizedSupplierPrimaryContact {
  readonly name: string | null
  readonly normalizedName: string | null
  readonly phone: string | null
  readonly normalizedPhone: string | null
  readonly wechatId: string | null
  readonly normalizedWechatId: string | null
}

export interface NormalizedSupplierPrimaryAddress {
  readonly countryRegionId: string | null
  readonly provinceStateId: string | null
  readonly cityId: string | null
  readonly addressLine: string | null
  readonly postalCode: string | null
}

export interface NormalizedCreateSupplierInput {
  readonly legalName: string
  readonly normalizedLegalName: string
  readonly shortName: string | null
  readonly normalizedShortName: string | null
  readonly entityType: SupplierEntityTypeValue
  readonly registration: NormalizedSupplierRegistration | null
  readonly primaryContact: NormalizedSupplierPrimaryContact | null
  readonly primaryAddress: NormalizedSupplierPrimaryAddress | null
  readonly remark: string | null
}

export type NormalizedUpdateSupplierInput = Partial<
  NormalizedCreateSupplierInput
> & { readonly expectedVersion: number }

export interface NormalizedSupplierSearchQuery {
  readonly code: string
  readonly name: string
  readonly registrationNumber: string
  readonly contactPhone: string
  readonly contactWechatId: string
}

function validationFailure(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    Object.fromEntries([[field, [message]]]),
  )
}

function codePointLength(value: string): number {
  return [...value].length
}

/** 显示值只做 NFC 与 Unicode 首尾裁边，保留用户输入的内部排版。 */
function normalizeDisplayText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    return validationFailure(field, '必须是字符串')
  }
  return value.normalize('NFC').replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
}

function normalizeBoundedText(
  value: unknown,
  field: SupplierTextField,
  maximum: number,
  required: boolean,
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      return validationFailure(field, `规范化后长度必须为 1 到 ${maximum} 个字符`)
    }
    return null
  }
  const normalized = normalizeDisplayText(value, field)
  const length = codePointLength(normalized)
  if (length > maximum || (required && length === 0)) {
    return validationFailure(
      field,
      required
        ? `规范化后长度必须为 1 到 ${maximum} 个字符`
        : `规范化后长度不能超过 ${maximum} 个字符`,
    )
  }
  return normalized || null
}

function normalizeSearchName(
  value: string,
  field: 'legalName' | 'shortName' | 'primaryContact.name',
  maximum: number,
): string {
  const normalized = value
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .toLocaleLowerCase('en-US')
    .normalize('NFC')
  if (codePointLength(normalized) > maximum) {
    return validationFailure(field, `规范化后长度不能超过 ${maximum} 个字符`)
  }
  return normalized
}

function normalizeUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return validationFailure(field, '必须是有效的 UUID')
  }
  return value.toLowerCase()
}

function normalizeNullableUuid(value: unknown, field: string): string | null {
  return value === null ? null : normalizeUuid(value, field)
}

function normalizeEntityType(value: unknown): SupplierEntityTypeValue {
  if (
    value !== SupplierEntityType.ORGANIZATION
    && value !== SupplierEntityType.INDIVIDUAL
  ) {
    return validationFailure('entityType', '必须是有效的供应商主体类型')
  }
  return value
}

function normalizeRegistration(
  value: SupplierRegistrationInput | null | undefined,
): NormalizedSupplierRegistration | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    return validationFailure('registration', '必须是对象或 null')
  }
  const number = normalizeBoundedText(
    value.number,
    'registration.number',
    LIMITS.registrationNumber,
    true,
  )
  if (number === null) {
    return validationFailure('registration.number', '登记号不能为空')
  }
  const normalizedNumber = number
    .normalize('NFKC')
    .replace(UNICODE_WHITESPACE_PATTERN, '')
    .toLocaleUpperCase('en-US')
  if (
    normalizedNumber.length === 0
    || codePointLength(normalizedNumber) > LIMITS.registrationNumber
  ) {
    return validationFailure('registration.number', '规范化后长度必须为 1 到 64 个字符')
  }
  return {
    countryRegionId: normalizeUuid(
      value.countryRegionId,
      'registration.countryRegionId',
    ),
    number,
    normalizedNumber,
  }
}

function normalizePrimaryContact(
  value: SupplierPrimaryContactInput | null | undefined,
): NormalizedSupplierPrimaryContact | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    return validationFailure('primaryContact', '必须是对象或 null')
  }
  const name = normalizeBoundedText(
    value.name,
    'primaryContact.name',
    LIMITS.contactName,
    false,
  )
  const phone = normalizeBoundedText(
    value.phone,
    'primaryContact.phone',
    LIMITS.contactPhone,
    false,
  )
  const wechatId = normalizeBoundedText(
    value.wechatId,
    'primaryContact.wechatId',
    LIMITS.contactWechatId,
    false,
  )
  if (name === null && phone === null && wechatId === null) return null

  const normalizedPhone = phone === null
    ? null
    : phone.normalize('NFKC').replace(PHONE_DISPLAY_SEPARATOR_PATTERN, '')
  if (
    normalizedPhone !== null
    && codePointLength(normalizedPhone) > LIMITS.contactPhone
  ) {
    return validationFailure(
      'primaryContact.phone',
      '规范化后长度不能超过 32 个字符',
    )
  }
  const normalizedWechatId = wechatId === null
    ? null
    : wechatId.toLocaleLowerCase('en-US').normalize('NFC')
  if (
    normalizedWechatId !== null
    && codePointLength(normalizedWechatId) > LIMITS.contactWechatId
  ) {
    return validationFailure(
      'primaryContact.wechatId',
      '规范化后长度不能超过 64 个字符',
    )
  }

  return {
    name,
    normalizedName: name === null
      ? null
      : normalizeSearchName(name, 'primaryContact.name', LIMITS.contactName),
    phone,
    normalizedPhone,
    wechatId,
    normalizedWechatId,
  }
}

function normalizePrimaryAddress(
  value: SupplierPrimaryAddressInput | null | undefined,
): NormalizedSupplierPrimaryAddress | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    return validationFailure('primaryAddress', '必须是对象或 null')
  }
  const normalized = {
    countryRegionId: normalizeNullableUuid(
      value.countryRegionId,
      'primaryAddress.countryRegionId',
    ),
    provinceStateId: normalizeNullableUuid(
      value.provinceStateId,
      'primaryAddress.provinceStateId',
    ),
    cityId: normalizeNullableUuid(value.cityId, 'primaryAddress.cityId'),
    addressLine: normalizeBoundedText(
      value.addressLine,
      'primaryAddress.addressLine',
      LIMITS.addressLine,
      false,
    ),
    postalCode: normalizeBoundedText(
      value.postalCode,
      'primaryAddress.postalCode',
      LIMITS.postalCode,
      false,
    ),
  }
  return Object.values(normalized).every(item => item === null)
    ? null
    : normalized
}

function normalizeNames(input: CreateSupplierInput): Pick<
  NormalizedCreateSupplierInput,
  'legalName' | 'normalizedLegalName' | 'shortName' | 'normalizedShortName'
> {
  const legalName = normalizeBoundedText(
    input.legalName,
    'legalName',
    LIMITS.legalName,
    true,
  )
  if (legalName === null) return validationFailure('legalName', '法定名称不能为空')
  const shortName = normalizeBoundedText(
    input.shortName,
    'shortName',
    LIMITS.shortName,
    false,
  )
  return {
    legalName,
    normalizedLegalName: normalizeSearchName(
      legalName,
      'legalName',
      LIMITS.legalName,
    ),
    shortName,
    normalizedShortName: shortName === null
      ? null
      : normalizeSearchName(shortName, 'shortName', LIMITS.shortName),
  }
}

export function normalizeCreateSupplierInput(
  input: CreateSupplierInput,
): NormalizedCreateSupplierInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailure('body', '必须是对象')
  }
  return {
    ...normalizeNames(input),
    entityType: normalizeEntityType(input.entityType),
    registration: normalizeRegistration(input.registration),
    primaryContact: normalizePrimaryContact(input.primaryContact),
    primaryAddress: normalizePrimaryAddress(input.primaryAddress),
    remark: normalizeBoundedText(
      input.remark,
      'remark',
      LIMITS.remark,
      false,
    ),
  }
}

export function normalizeUpdateSupplierInput(
  input: UpdateSupplierInput,
): NormalizedUpdateSupplierInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailure('body', '必须是对象')
  }
  if (
    !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1
    || input.expectedVersion > 2_147_483_647
  ) {
    return validationFailure('expectedVersion', '必须是 1 到 2147483647 的整数')
  }
  const result: Record<string, unknown> = { expectedVersion: input.expectedVersion }
  if (input.legalName !== undefined) {
    Object.assign(result, normalizeNames({
      legalName: input.legalName,
      shortName: input.shortName,
      entityType: SupplierEntityType.ORGANIZATION,
    }))
    if (input.shortName === undefined) {
      delete result.shortName
      delete result.normalizedShortName
    }
  } else if (input.shortName !== undefined) {
    const shortName = normalizeBoundedText(
      input.shortName,
      'shortName',
      LIMITS.shortName,
      false,
    )
    result.shortName = shortName
    result.normalizedShortName = shortName === null
      ? null
      : normalizeSearchName(shortName, 'shortName', LIMITS.shortName)
  }
  if (input.entityType !== undefined) {
    result.entityType = normalizeEntityType(input.entityType)
  }
  if (input.registration !== undefined) {
    result.registration = normalizeRegistration(input.registration)
  }
  if (input.primaryContact !== undefined) {
    result.primaryContact = normalizePrimaryContact(input.primaryContact)
  }
  if (input.primaryAddress !== undefined) {
    result.primaryAddress = normalizePrimaryAddress(input.primaryAddress)
  }
  if (input.remark !== undefined) {
    result.remark = normalizeBoundedText(
      input.remark,
      'remark',
      LIMITS.remark,
      false,
    )
  }
  if (Object.keys(result).length === 1) {
    return validationFailure('legalName', '至少提交一个可修改字段')
  }
  return result as NormalizedUpdateSupplierInput
}

/**
 * 一个公开搜索框同时覆盖五类索引。先 NFKC 统一全角兼容字符，再分别生成与各列
 * 完全一致的大小写、空白和电话分隔符形式，查询层不得临时发明另一套规则。
 */
export function normalizeSupplierSearchQuery(
  value: unknown,
): NormalizedSupplierSearchQuery {
  const display = normalizeDisplayText(value, 'query').normalize('NFKC')
  if (codePointLength(display) < 1 || codePointLength(display) > 200) {
    return validationFailure('query', '规范化后长度必须为 1 到 200 个字符')
  }
  const name = display
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .toLocaleLowerCase('en-US')
    .normalize('NFC')
  return {
    code: display.toLocaleUpperCase('en-US'),
    name,
    registrationNumber: display
      .replace(UNICODE_WHITESPACE_PATTERN, '')
      .toLocaleUpperCase('en-US'),
    contactPhone: display.replace(PHONE_DISPLAY_SEPARATOR_PATTERN, ''),
    contactWechatId: display.toLocaleLowerCase('en-US').normalize('NFC'),
  }
}

export function isNormalizableSupplierSearchQuery(value: unknown): boolean {
  try {
    normalizeSupplierSearchQuery(value)
    return true
  } catch {
    return false
  }
}

function canNormalizeText(
  value: unknown,
  field: SupplierTextField,
  maximum: number,
  required: boolean,
): boolean {
  try {
    normalizeBoundedText(value, field, maximum, required)
    return true
  } catch {
    return false
  }
}

export const supplierTextValidators = {
  legalName: (value: unknown) => canNormalizeText(value, 'legalName', 200, true),
  shortName: (value: unknown) => canNormalizeText(value, 'shortName', 100, false),
  registrationNumber: (value: unknown) => {
    try {
      const registration = normalizeRegistration({
        countryRegionId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        number: value as string,
      })
      return registration !== null
    } catch {
      return false
    }
  },
  contactName: (value: unknown) => canNormalizeText(value, 'primaryContact.name', 128, false),
  contactPhone: (value: unknown) => canNormalizeText(value, 'primaryContact.phone', 32, false),
  contactWechatId: (value: unknown) => canNormalizeText(value, 'primaryContact.wechatId', 64, false),
  addressLine: (value: unknown) => canNormalizeText(value, 'primaryAddress.addressLine', 500, false),
  postalCode: (value: unknown) => canNormalizeText(value, 'primaryAddress.postalCode', 32, false),
  remark: (value: unknown) => canNormalizeText(value, 'remark', 1000, false),
} as const
