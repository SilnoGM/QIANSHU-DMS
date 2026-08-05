import { timingSafeEqual } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  RegionLevel,
} from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  hasPersistenceConstraint,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  type LockedRegionReference,
  RegionLookupService,
} from '../regions/region-lookup.service'
import {
  completeSupplierCreateRequest,
  createSupplierRecord,
  lockSupplierCreateRequest,
  lockSupplierNumberingIssuance,
  readSupplierDetailForCommand,
  readSupplierRegistrationDuplicate,
  upsertAndLockSupplierCreateRequest,
  type CreateSupplierRecordInput,
  type SupplierCreateIntentRecord,
} from './supplier-command.persistence'
import type { CreateSupplierRequestDto } from './dto/supplier-command.dto'
import type { SupplierDto } from './dto/supplier-response.dto'
import {
  createSupplierApiException,
  SUPPLIER_ERROR_CODES,
} from './supplier.errors'
import {
  buildSupplierNumberingIdempotencyKey,
  calculateSupplierCreateFingerprintHash,
  calculateSupplierCreateScopeHash,
  normalizeSupplierIdempotencyKey,
} from './supplier-idempotency'
import {
  normalizeCreateSupplierInput,
  type NormalizedCreateSupplierInput,
} from './supplier.normalizer'

const REGISTRATION_UNIQUE_CONSTRAINT =
  'suppliers_registration_country_number_key'

export interface SupplierCommandContext {
  /** 只接受 AuthenticationGuard 写入的可信 Session User id。 */
  readonly actorUserId: string
  /** 只接受 request-id middleware 生成或校验后的请求标识。 */
  readonly requestId: string
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function assertMatchingIntent(
  intent: SupplierCreateIntentRecord | null,
  fingerprintHash: Buffer,
): asserts intent is SupplierCreateIntentRecord {
  if (intent === null) {
    throw new Error('Supplier create intent missing after lock')
  }
  if (!sameHash(intent.requestFingerprintHash, fingerprintHash)) {
    throw createSupplierApiException(
      SUPPLIER_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    )
  }
}

function requireDetail(value: SupplierDto | null): SupplierDto {
  if (value === null) {
    throw new Error('Supplier mutation response invariant violated')
  }
  return value
}

function isRegistrationUniqueViolation(error: unknown): boolean {
  const facts = readPersistenceErrorFacts(error)
  return (
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
  ) && hasPersistenceConstraint(facts, REGISTRATION_UNIQUE_CONSTRAINT)
}

function rethrowCreateError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (isRegistrationUniqueViolation(error)) {
    throw createSupplierApiException(
      SUPPLIER_ERROR_CODES.REGISTRATION_ALREADY_EXISTS,
    )
  }
  throw createSupplierApiException(SUPPLIER_ERROR_CODES.INTERNAL_ERROR)
}

function collectRegionIds(input: NormalizedCreateSupplierInput): string[] {
  return [
    input.registration?.countryRegionId,
    input.primaryAddress?.countryRegionId,
    input.primaryAddress?.provinceStateId,
    input.primaryAddress?.cityId,
  ].filter((value): value is string => value !== null && value !== undefined)
}

async function validateCreateRegions(
  regionLookup: RegionLookupService,
  transaction: Parameters<RegionLookupService['lockReferences']>[0],
  input: NormalizedCreateSupplierInput,
): Promise<void> {
  const regions = await regionLookup.lockReferences(
    transaction,
    collectRegionIds(input),
  )
  const registration = input.registration
  if (registration !== null) {
    const country = regions.get(registration.countryRegionId)
    if (
      country === undefined
      || country.level !== RegionLevel.COUNTRY_REGION
      || country.parentId !== null
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
    if (!country.effectiveEnabled) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_UNAVAILABLE)
    }
  }

  const address = input.primaryAddress
  if (address === null) return
  if (address.countryRegionId === null) {
    if (address.provinceStateId !== null || address.cityId !== null) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
    return
  }
  const country = regions.get(address.countryRegionId)
  if (
    country === undefined
    || country.level !== RegionLevel.COUNTRY_REGION
    || country.parentId !== null
  ) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
  }

  let province: LockedRegionReference | undefined
  if (address.provinceStateId === null) {
    if (address.cityId !== null) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  } else {
    province = regions.get(address.provinceStateId)
    if (
      province === undefined
      || province.level !== RegionLevel.PROVINCE_STATE
      || province.parentId !== country.id
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  }

  let city: LockedRegionReference | undefined
  if (address.cityId !== null) {
    city = regions.get(address.cityId)
    if (
      province === undefined
      || city === undefined
      || city.level !== RegionLevel.CITY
      || city.parentId !== province.id
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_INVALID)
    }
  }
  if (!country.effectiveEnabled
    || (province !== undefined && !province.effectiveEnabled)
    || (city !== undefined && !city.effectiveEnabled)
  ) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.REGION_UNAVAILABLE)
  }
}

function toCreateRecordInput(
  input: NormalizedCreateSupplierInput,
  code: string,
  numberingIssuanceId: string,
): CreateSupplierRecordInput {
  return {
    code,
    numberingIssuanceId,
    legalName: input.legalName,
    normalizedLegalName: input.normalizedLegalName,
    shortName: input.shortName,
    normalizedShortName: input.normalizedShortName,
    entityType: input.entityType,
    registrationCountryRegionId: input.registration?.countryRegionId ?? null,
    registrationNumber: input.registration?.number ?? null,
    normalizedRegistrationNumber: input.registration?.normalizedNumber ?? null,
    contactName: input.primaryContact?.name ?? null,
    normalizedContactName: input.primaryContact?.normalizedName ?? null,
    contactPhone: input.primaryContact?.phone ?? null,
    normalizedContactPhone: input.primaryContact?.normalizedPhone ?? null,
    contactWechatId: input.primaryContact?.wechatId ?? null,
    normalizedContactWechatId:
      input.primaryContact?.normalizedWechatId ?? null,
    addressCountryRegionId: input.primaryAddress?.countryRegionId ?? null,
    addressProvinceStateId: input.primaryAddress?.provinceStateId ?? null,
    addressCityId: input.primaryAddress?.cityId ?? null,
    addressLine: input.primaryAddress?.addressLine ?? null,
    postalCode: input.primaryAddress?.postalCode ?? null,
    remark: input.remark,
    enabled: false,
  }
}

function createChangedFields(input: NormalizedCreateSupplierInput): string {
  return [
    'code',
    'enabled',
    'entityType',
    'legalName',
    ...(input.shortName === null ? [] : ['shortName']),
    ...(input.registration === null ? [] : ['registration']),
    ...(input.primaryContact === null ? [] : ['primaryContact']),
    ...(input.primaryAddress === null ? [] : ['primaryAddress']),
    ...(input.remark === null ? [] : ['remark']),
  ].sort().join(',')
}

/**
 * 创建严格拆为 Tx-A/Tx-B/Tx-C。永久 intent 在发号前提交；发号使用独立事务；
 * Supplier、Audit 和 intent 完成标记只在 Tx-C 原子提交，允许断号但不允许重复主体。
 */
@Injectable()
export class SupplierCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly regionLookup: RegionLookupService,
  ) {}

  async create(
    context: SupplierCommandContext,
    idempotencyKey: unknown,
    input: CreateSupplierRequestDto,
  ): Promise<SupplierDto> {
    const normalized = normalizeCreateSupplierInput(input)
    const key = normalizeSupplierIdempotencyKey(idempotencyKey)
    const scopeHash = calculateSupplierCreateScopeHash(
      context.actorUserId,
      key,
    )
    const fingerprintHash = calculateSupplierCreateFingerprintHash(
      key,
      normalized,
    )

    try {
      const preflight = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const intent = await upsertAndLockSupplierCreateRequest(transaction, {
          idempotencyScopeHash: scopeHash,
          requestFingerprintHash: fingerprintHash,
        })
        assertMatchingIntent(intent, fingerprintHash)
        return {
          intentId: intent.id,
          completed: intent.supplierId === null
            ? null
            : requireDetail(await readSupplierDetailForCommand(
                transaction,
                intent.supplierId,
              )),
        }
      })
      if (preflight.completed !== null) return preflight.completed

      let issuance
      try {
        issuance = await this.numbering.generate({
          ruleCode: 'SUPPLIER',
          consumerCode: 'SUPPLIER.CREATE',
          idempotencyKey: buildSupplierNumberingIdempotencyKey(
            context.actorUserId,
            key,
          ),
        })
      } catch {
        throw createSupplierApiException(
          SUPPLIER_ERROR_CODES.NUMBERING_UNAVAILABLE,
        )
      }

      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const intent = await lockSupplierCreateRequest(
          transaction,
          preflight.intentId,
        )
        assertMatchingIntent(intent, fingerprintHash)
        if (intent.supplierId !== null) {
          return requireDetail(await readSupplierDetailForCommand(
            transaction,
            intent.supplierId,
          ))
        }

        await validateCreateRegions(this.regionLookup, transaction, normalized)
        const source = await lockSupplierNumberingIssuance(
          transaction,
          issuance.issuanceId,
        )
        if (
          source === null
          || source.generatedNumber !== issuance.number
          || source.consumerCode !== 'SUPPLIER.CREATE'
          || source.ruleCode !== 'SUPPLIER'
          || [...issuance.number].length < 1
          || [...issuance.number].length > 64
        ) {
          throw createSupplierApiException(
            SUPPLIER_ERROR_CODES.NUMBERING_UNAVAILABLE,
          )
        }

        if (
          normalized.registration !== null
          && await readSupplierRegistrationDuplicate(
            transaction,
            normalized.registration.countryRegionId,
            normalized.registration.normalizedNumber,
          ) !== null
        ) {
          throw createSupplierApiException(
            SUPPLIER_ERROR_CODES.REGISTRATION_ALREADY_EXISTS,
          )
        }

        const created = await createSupplierRecord(
          transaction,
          toCreateRecordInput(normalized, issuance.number, issuance.issuanceId),
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.SUPPLIER_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'Supplier',
          targetId: created.id,
          requestId: context.requestId,
          metadata: {
            supplierCode: issuance.number,
            changedFields: createChangedFields(normalized),
            version: 1,
          },
        })
        await completeSupplierCreateRequest(
          transaction,
          intent.id,
          created.id,
        )
        return requireDetail(await readSupplierDetailForCommand(
          transaction,
          created.id,
        ))
      })
    } catch (error) {
      rethrowCreateError(error)
    }
  }
}
