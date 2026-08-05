import { createHash, createHmac } from 'node:crypto'

import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../infrastructure/http/api.exception'
import type { NormalizedCreateSupplierInput } from './supplier.normalizer'

const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export const SUPPLIER_CREATE_ENDPOINT = '/api/suppliers' as const
export const SUPPLIER_CREATE_SCOPE_VERSION = 'supplier.create.scope.v1' as const
export const SUPPLIER_CREATE_FINGERPRINT_VERSION =
  'supplier.create.payload.v1' as const

function validationFailure(field: string, message: string): never {
  throw new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    Object.fromEntries([[field, [message]]]),
  )
}

export function normalizeSupplierIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    return validationFailure(
      'idempotencyKey',
      '必须是 canonical lowercase UUID v4',
    )
  }
  return value
}

function normalizeActorUserId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return validationFailure('actorUserId', '必须是有效的 UUID')
  }
  return value.toLowerCase()
}

/** 固定重建公开 payload；派生搜索列不进入字节合同，避免同一语义被重复编码。 */
export function serializeCanonicalSupplierCreatePayload(
  input: NormalizedCreateSupplierInput,
): string {
  return JSON.stringify({
    version: SUPPLIER_CREATE_FINGERPRINT_VERSION,
    legalName: input.legalName,
    shortName: input.shortName,
    entityType: input.entityType,
    registration: input.registration === null
      ? null
      : {
          countryRegionId: input.registration.countryRegionId,
          number: input.registration.number,
        },
    primaryContact: input.primaryContact === null
      ? null
      : {
          name: input.primaryContact.name,
          phone: input.primaryContact.phone,
          wechatId: input.primaryContact.wechatId,
        },
    primaryAddress: input.primaryAddress === null
      ? null
      : {
          countryRegionId: input.primaryAddress.countryRegionId,
          provinceStateId: input.primaryAddress.provinceStateId,
          cityId: input.primaryAddress.cityId,
          addressLine: input.primaryAddress.addressLine,
          postalCode: input.primaryAddress.postalCode,
        },
    remark: input.remark,
  })
}

/** scopeHash 隔离用户、端点和协议版本，不保存原始公共 key。 */
export function calculateSupplierCreateScopeHash(
  actorUserId: unknown,
  idempotencyKey: unknown,
): Buffer {
  const actor = normalizeActorUserId(actorUserId)
  const key = normalizeSupplierIdempotencyKey(idempotencyKey)
  return createHash('sha256').update(Buffer.from(
    `${SUPPLIER_CREATE_SCOPE_VERSION}\0${actor}\0${SUPPLIER_CREATE_ENDPOINT}\0${key}`,
    'utf8',
  )).digest()
}

/** UUID v4 自身作为 HMAC key；返回值只保留固定 32-byte 摘要。 */
export function calculateSupplierCreateFingerprintHash(
  idempotencyKey: unknown,
  input: NormalizedCreateSupplierInput,
): Buffer {
  const key = normalizeSupplierIdempotencyKey(idempotencyKey)
  const canonical = serializeCanonicalSupplierCreatePayload(input)
  return createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(Buffer.from(canonical, 'utf8'))
    .digest()
}

export function buildSupplierNumberingIdempotencyKey(
  actorUserId: unknown,
  idempotencyKey: unknown,
): string {
  const actor = normalizeActorUserId(actorUserId)
  const key = normalizeSupplierIdempotencyKey(idempotencyKey)
  return `supplier.create.v1:${actor}:${key}`
}
