import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import type { AuditEvent, Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  type AuditActorType as AuditActorTypeValue,
  type AuditEventType as AuditEventTypeValue,
  type AuditOutcome as AuditOutcomeValue,
} from '../../generated/prisma/enums'
import { hasPersistenceCode, readPersistenceErrorFacts } from '../../infrastructure/database/persistence-error-facts'

export const MAX_AUDIT_METADATA_KEY_LENGTH = 128
export const MAX_AUDIT_METADATA_STRING_LENGTH = 512
export const MAX_AUDIT_METADATA_ENTRY_COUNT = 32
export const MAX_AUDIT_METADATA_SERIALIZED_BYTES = 8_192
const MAX_PRODUCT_CHANGE_AUDIT_METADATA_SERIALIZED_BYTES = 32_768
const MAX_PRODUCT_CHANGE_AUDIT_ARRAY_LENGTH = 100
const MAX_PURCHASE_PART_AUDIT_METADATA_SERIALIZED_BYTES = 65_536

const MAX_REQUEST_ID_LENGTH = 64
const MAX_AUDIT_REFERENCE_LENGTH = 128
const SOURCE_IP_HASH_LENGTH = 32
const AUDIT_EVENT_INVALID_MESSAGE = 'Audit event is invalid'
const AUDIT_WRITE_FAILED_MESSAGE = 'Audit event write failed'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

const AUDIT_ACTOR_TYPES = new Set<AuditActorTypeValue>(
  Object.values(AuditActorType),
)
const AUDIT_EVENT_TYPES = new Set<AuditEventTypeValue>(
  Object.values(AuditEventType),
)
const AUDIT_OUTCOMES = new Set<AuditOutcomeValue>(Object.values(AuditOutcome))

const SENSITIVE_METADATA_KEY_FRAGMENTS = [
  'authorization',
  'connectionstring',
  'credential',
  'password',
  'cookie',
  'secret',
  'session',
  'token',
] as const

const SAFE_PASSWORD_STATE_METADATA_KEYS = new Set(['mustchangepassword'])
const RESERVED_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type AuditMetadataScalar = string | number | boolean | null
export type AuditMetadataObject = Record<string, AuditMetadataScalar>
export type AuditMetadataValue =
  | AuditMetadataScalar
  | AuditMetadataScalar[]
  | AuditMetadataObject[]
export type AuditMetadata = Record<string, AuditMetadataValue>

export interface RecordAuditEventInput {
  eventType: AuditEventTypeValue
  outcome: AuditOutcomeValue
  actorType: AuditActorTypeValue
  actorUserId?: string
  targetType?: string
  targetId?: string
  requestId?: string
  correlationId?: string
  reasonCode?: string
  sourceIpHash?: Buffer
  metadata?: AuditMetadata
}

export class AuditEventValidationError extends Error {
  readonly code = 'AUDIT_EVENT_INVALID'

  constructor() {
    super(AUDIT_EVENT_INVALID_MESSAGE)
    this.name = 'AuditEventValidationError'
  }
}

export class AuditWriteFailedError extends Error {
  readonly code = 'AUDIT_WRITE_FAILED'

  constructor(readonly transactionConflict = false) {
    super(AUDIT_WRITE_FAILED_MESSAGE)
    this.name = 'AuditWriteFailedError'
  }
}

interface ValidatedAuditEventInput {
  eventType: AuditEventTypeValue
  outcome: AuditOutcomeValue
  actorType: AuditActorTypeValue
  actorUserId: string | null
  targetType: string | null
  targetId: string | null
  requestId: string
  correlationId: string | null
  reasonCode: string | null
  sourceIpHash: Uint8Array<ArrayBuffer> | null
  metadata: AuditMetadata
}

@Injectable()
export class AuditService {
  /**
   * 审计必须复用业务调用方已经打开的事务。服务不持有 PrismaService，避免业务
   * 状态提交后才单独补写审计，造成“操作成功但没有审计”的不一致状态。
   */
  async record(
    transaction: Prisma.TransactionClient,
    input: RecordAuditEventInput,
  ): Promise<AuditEvent> {
    const data = validateAuditEventInput(input)

    try {
      return await transaction.auditEvent.create({ data })
    }
    catch (error) {
      // 驱动异常可能包含 SQL 参数或连接信息，不能保留原始 cause/meta；仅将
      // 明确的事务冲突白名单缩减为布尔分类，供业务在事务退出后提示刷新重试。
      // 其他审计写入失败仍须失败关闭，不能伪装为状态冲突或在这里重试审计。
      const facts = readPersistenceErrorFacts(error)
      throw new AuditWriteFailedError(
        ['P2034', '40001', '40P01'].some(code => hasPersistenceCode(facts, code)),
      )
    }
  }
}

function validateAuditEventInput(
  input: RecordAuditEventInput,
): ValidatedAuditEventInput {
  if (
    !input
    || typeof input !== 'object'
    || !AUDIT_EVENT_TYPES.has(input.eventType)
    || !AUDIT_OUTCOMES.has(input.outcome)
    || !AUDIT_ACTOR_TYPES.has(input.actorType)
  ) {
    throw new AuditEventValidationError()
  }

  const actorUserId = validateActorIdentity(
    input.actorType,
    input.actorUserId,
  )
  const requestId =
    input.requestId === undefined
      ? randomUUID()
      : validateRequiredText(input.requestId, MAX_REQUEST_ID_LENGTH)

  return {
    eventType: input.eventType,
    outcome: input.outcome,
    actorType: input.actorType,
    actorUserId,
    targetType: validateOptionalText(
      input.targetType,
      MAX_AUDIT_REFERENCE_LENGTH,
    ),
    targetId: validateOptionalText(
      input.targetId,
      MAX_AUDIT_REFERENCE_LENGTH,
    ),
    requestId,
    correlationId: validateOptionalText(
      input.correlationId,
      MAX_AUDIT_REFERENCE_LENGTH,
    ),
    reasonCode: validateOptionalText(
      input.reasonCode,
      MAX_AUDIT_REFERENCE_LENGTH,
    ),
    sourceIpHash: validateSourceIpHash(input.sourceIpHash),
    metadata: validateMetadata(input.metadata, input.eventType),
  }
}

function validateActorIdentity(
  actorType: AuditActorTypeValue,
  actorUserId: string | undefined,
): string | null {
  if (actorType === AuditActorType.USER) {
    if (
      typeof actorUserId !== 'string'
      || !UUID_PATTERN.test(actorUserId)
    ) {
      throw new AuditEventValidationError()
    }

    return actorUserId
  }

  if (actorUserId !== undefined) {
    throw new AuditEventValidationError()
  }

  return null
}

function validateOptionalText(
  value: string | undefined,
  maxLength: number,
): string | null {
  if (value === undefined) {
    return null
  }

  return validateRequiredText(value, maxLength)
}

function validateRequiredText(value: string, maxLength: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || Array.from(value).length > maxLength
    || hasControlCharacter(value)
  ) {
    throw new AuditEventValidationError()
  }

  return value
}

function validateSourceIpHash(
  value: Buffer | undefined,
): Uint8Array<ArrayBuffer> | null {
  if (value === undefined) {
    return null
  }

  if (!Buffer.isBuffer(value) || value.length !== SOURCE_IP_HASH_LENGTH) {
    throw new AuditEventValidationError()
  }

  return Buffer.from(value)
}

function validateMetadata(
  value: AuditMetadata | undefined,
  eventType: AuditEventTypeValue,
): AuditMetadata {
  if (value === undefined) {
    return {}
  }

  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new AuditEventValidationError()
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const entries = Object.entries(descriptors)

  if (entries.length > MAX_AUDIT_METADATA_ENTRY_COUNT) {
    throw new AuditEventValidationError()
  }

  const metadata: AuditMetadata = {}

  const allowStructured = eventType === AuditEventType.SALES_ORDER_PRODUCTS_CHANGED
  for (const [key, descriptor] of entries) {
    if (
      !descriptor.enumerable
      || !('value' in descriptor)
      || !isSafeMetadataEntry(key, descriptor.value)
    ) {
      throw new AuditEventValidationError()
    }
    if (eventType === AuditEventType.PURCHASE_ORDER_CREATED && key === 'shippingMarkIssuanceIds') {
      // 采购一次最多生成 1000 个货件；只开放该固定字段的 UUID 列表，其他审计边界不变。
      const ids: unknown = descriptor.value
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 1000
        || !ids.every((id: unknown) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        throw new AuditEventValidationError()
      }
      metadata[key] = [...(ids as string[])]
    }
    else if (eventType === AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED && key === 'partIds') {
      // 分批发货仅开放本事件的货件 ID 清单，不能借此写入其他结构化或敏感数据。
      const ids: unknown = descriptor.value
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 1000
        || !ids.every((id: unknown) => typeof id === 'string' && UUID_PATTERN.test(id))
        || new Set(ids).size !== ids.length) {
        throw new AuditEventValidationError()
      }
      metadata[key] = [...(ids as string[])]
    }
    else metadata[key] = validateMetadataValue(descriptor.value, allowStructured)
  }

  if (
    Buffer.byteLength(JSON.stringify(metadata), 'utf8')
    > (eventType === AuditEventType.PURCHASE_ORDER_CREATED
        || (eventType === AuditEventType.PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED && 'partIds' in metadata)
        ? MAX_PURCHASE_PART_AUDIT_METADATA_SERIALIZED_BYTES
        : allowStructured
        ? MAX_PRODUCT_CHANGE_AUDIT_METADATA_SERIALIZED_BYTES
        : MAX_AUDIT_METADATA_SERIALIZED_BYTES)
  ) {
    throw new AuditEventValidationError()
  }

  return metadata
}

function isPlainObject(value: unknown): value is AuditMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value) as unknown

  return prototype === Object.prototype || prototype === null
}

function isSafeMetadataEntry(
  key: string,
  value: unknown,
): boolean {
  if (
    key.length === 0
    || Array.from(key).length > MAX_AUDIT_METADATA_KEY_LENGTH
    || RESERVED_METADATA_KEYS.has(key.toLowerCase())
  ) {
    return false
  }

  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '')

  // 设计明确要求 password-reset 仅记录这个布尔状态；它描述流程，不承载密码。
  if (SAFE_PASSWORD_STATE_METADATA_KEYS.has(normalizedKey)) {
    return typeof value === 'boolean'
  }

  return !SENSITIVE_METADATA_KEY_FRAGMENTS.some(fragment =>
    normalizedKey.includes(fragment),
  )
}

function validateMetadataValue(
  value: unknown,
  allowStructured: boolean,
): AuditMetadataValue {
  if (isMetadataScalar(value)) return value
  if (
    !allowStructured
    || !Array.isArray(value)
    || value.length > MAX_PRODUCT_CHANGE_AUDIT_ARRAY_LENGTH
  ) {
    throw new AuditEventValidationError()
  }
  if (value.every(isMetadataScalar)) return [...value]
  if (value.every(item => isPlainObject(item))) {
    return value.map((item) => {
      const entries = Object.entries(item)
      if (entries.length > 8) throw new AuditEventValidationError()
      const normalized: AuditMetadataObject = {}
      for (const [key, nestedValue] of entries) {
        if (
          !isMetadataScalar(nestedValue)
          || !isSafeMetadataEntry(key, nestedValue)
        ) {
          throw new AuditEventValidationError()
        }
        normalized[key] = nestedValue
      }
      return normalized
    })
  }
  throw new AuditEventValidationError()
}

function isMetadataScalar(value: unknown): value is AuditMetadataScalar {
  if (value === null || typeof value === 'boolean') {
    return true
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  return (
    typeof value === 'string'
    && Array.from(value).length <= MAX_AUDIT_METADATA_STRING_LENGTH
  )
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true
    }
  }

  return false
}
