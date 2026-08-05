import { Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
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
import { RegionLookupService } from '../regions/region-lookup.service'
import type { SupplierCommandContext } from './supplier-command.service'
import {
  readSupplierDetailForCommand,
  readSupplierForMutation,
  readSupplierRegistrationDuplicate,
  updateSupplierRecord,
  type SupplierMutationRecord,
  type UpdateSupplierRecordInput,
} from './supplier-command.persistence'
import type {
  ChangeSupplierStatusRequestDto,
  UpdateSupplierRequestDto,
} from './dto/supplier-command.dto'
import type { SupplierDto } from './dto/supplier-response.dto'
import {
  createSupplierApiException,
  SUPPLIER_ERROR_CODES,
} from './supplier.errors'
import {
  normalizeUpdateSupplierInput,
  type NormalizedSupplierPrimaryAddress,
  type NormalizedSupplierPrimaryContact,
  type NormalizedSupplierRegistration,
} from './supplier.normalizer'
import { validateSupplierRegionReferences } from './supplier-region-validation'

const REGISTRATION_UNIQUE_CONSTRAINT =
  'suppliers_registration_country_number_key'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

interface SupplierPrimaryContactState {
  readonly name: string | null
  readonly normalizedName: string | null
  readonly phone: string | null
  readonly normalizedPhone: string | null
  readonly wechatId: string | null
  readonly normalizedWechatId: string | null
}

function normalizeSupplierId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.VALIDATION_FAILED)
  }
  return value.toLowerCase()
}

function assertExpectedVersion(
  currentVersion: number,
  expectedVersion: number,
): void {
  if (currentVersion !== expectedVersion) {
    throw createSupplierApiException(SUPPLIER_ERROR_CODES.STATE_CHANGED)
  }
}

function requireDetail(value: SupplierDto | null): SupplierDto {
  if (value === null) {
    throw new Error('Supplier mutation response invariant violated')
  }
  return value
}

function rethrowLifecycleError(error: unknown): never {
  if (error instanceof ApiException) throw error
  const facts = readPersistenceErrorFacts(error)
  if ((
    hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
  ) && hasPersistenceConstraint(facts, REGISTRATION_UNIQUE_CONSTRAINT)) {
    throw createSupplierApiException(
      SUPPLIER_ERROR_CODES.REGISTRATION_ALREADY_EXISTS,
    )
  }
  throw createSupplierApiException(SUPPLIER_ERROR_CODES.INTERNAL_ERROR)
}

function isContactReady(contact: SupplierPrimaryContactState): boolean {
  return contact.name !== null
    && (contact.phone !== null || contact.wechatId !== null)
}

function currentContact(
  current: SupplierMutationRecord,
): SupplierPrimaryContactState {
  return {
    name: current.contactName,
    normalizedName: current.normalizedContactName,
    phone: current.contactPhone,
    normalizedPhone: current.normalizedContactPhone,
    wechatId: current.contactWechatId,
    normalizedWechatId: current.normalizedContactWechatId,
  }
}

function normalizedContactState(
  contact: NormalizedSupplierPrimaryContact | null,
): SupplierPrimaryContactState {
  return {
    name: contact?.name ?? null,
    normalizedName: contact?.normalizedName ?? null,
    phone: contact?.phone ?? null,
    normalizedPhone: contact?.normalizedPhone ?? null,
    wechatId: contact?.wechatId ?? null,
    normalizedWechatId: contact?.normalizedWechatId ?? null,
  }
}

function currentRegistration(
  current: SupplierMutationRecord,
): NormalizedSupplierRegistration | null {
  if (
    current.registrationCountryRegionId === null
    || current.registrationNumber === null
    || current.normalizedRegistrationNumber === null
  ) return null
  return {
    countryRegionId: current.registrationCountryRegionId,
    number: current.registrationNumber,
    normalizedNumber: current.normalizedRegistrationNumber,
  }
}

function currentAddress(
  current: SupplierMutationRecord,
): NormalizedSupplierPrimaryAddress | null {
  if (
    current.addressCountryRegionId === null
    && current.addressProvinceStateId === null
    && current.addressCityId === null
    && current.addressLine === null
    && current.postalCode === null
  ) return null
  return {
    countryRegionId: current.addressCountryRegionId,
    provinceStateId: current.addressProvinceStateId,
    cityId: current.addressCityId,
    addressLine: current.addressLine,
    postalCode: current.postalCode,
  }
}

function sameRegistration(
  left: NormalizedSupplierRegistration | null,
  right: NormalizedSupplierRegistration | null,
): boolean {
  return left?.countryRegionId === right?.countryRegionId
    && left?.number === right?.number
    && left?.normalizedNumber === right?.normalizedNumber
}

function sameContact(
  left: SupplierPrimaryContactState,
  right: SupplierPrimaryContactState,
): boolean {
  return left.name === right.name
    && left.normalizedName === right.normalizedName
    && left.phone === right.phone
    && left.normalizedPhone === right.normalizedPhone
    && left.wechatId === right.wechatId
    && left.normalizedWechatId === right.normalizedWechatId
}

function sameAddress(
  left: NormalizedSupplierPrimaryAddress | null,
  right: NormalizedSupplierPrimaryAddress | null,
): boolean {
  return left?.countryRegionId === right?.countryRegionId
    && left?.provinceStateId === right?.provinceStateId
    && left?.cityId === right?.cityId
    && left?.addressLine === right?.addressLine
    && left?.postalCode === right?.postalCode
}

function addressRegionsChanged(
  left: NormalizedSupplierPrimaryAddress | null,
  right: NormalizedSupplierPrimaryAddress | null,
): boolean {
  return left?.countryRegionId !== right?.countryRegionId
    || left?.provinceStateId !== right?.provinceStateId
    || left?.cityId !== right?.cityId
}

function setRegistrationUpdate(
  data: UpdateSupplierRecordInput,
  registration: NormalizedSupplierRegistration | null,
): void {
  data.registrationCountryRegionId = registration?.countryRegionId ?? null
  data.registrationNumber = registration?.number ?? null
  data.normalizedRegistrationNumber = registration?.normalizedNumber ?? null
}

function setContactUpdate(
  data: UpdateSupplierRecordInput,
  contact: SupplierPrimaryContactState,
): void {
  data.contactName = contact.name
  data.normalizedContactName = contact.normalizedName
  data.contactPhone = contact.phone
  data.normalizedContactPhone = contact.normalizedPhone
  data.contactWechatId = contact.wechatId
  data.normalizedContactWechatId = contact.normalizedWechatId
}

function setAddressUpdate(
  data: UpdateSupplierRecordInput,
  address: NormalizedSupplierPrimaryAddress | null,
): void {
  data.addressCountryRegionId = address?.countryRegionId ?? null
  data.addressProvinceStateId = address?.provinceStateId ?? null
  data.addressCityId = address?.cityId ?? null
  data.addressLine = address?.addressLine ?? null
  data.postalCode = address?.postalCode ?? null
}

/** 更新与启停共享 Supplier 行锁、版本、no-op、Audit 和安全错误边界。 */
@Injectable()
export class SupplierLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly regionLookup: RegionLookupService,
  ) {}

  async update(
    context: SupplierCommandContext,
    supplierId: unknown,
    input: UpdateSupplierRequestDto,
  ): Promise<SupplierDto> {
    const normalizedId = normalizeSupplierId(supplierId)
    const normalized = normalizeUpdateSupplierInput(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await readSupplierForMutation(transaction, normalizedId)
        if (current === null) {
          throw createSupplierApiException(SUPPLIER_ERROR_CODES.NOT_FOUND)
        }
        assertExpectedVersion(current.version, normalized.expectedVersion)

        const data: UpdateSupplierRecordInput = {}
        const changedFields: string[] = []
        if (normalized.legalName !== undefined && (
          normalized.legalName !== current.legalName
          || normalized.normalizedLegalName !== current.normalizedLegalName
        )) {
          data.legalName = normalized.legalName
          data.normalizedLegalName = normalized.normalizedLegalName
          changedFields.push('legalName')
        }
        if (Object.hasOwn(normalized, 'shortName') && (
          normalized.shortName !== current.shortName
          || normalized.normalizedShortName !== current.normalizedShortName
        )) {
          data.shortName = normalized.shortName
          data.normalizedShortName = normalized.normalizedShortName
          changedFields.push('shortName')
        }
        if (
          normalized.entityType !== undefined
          && normalized.entityType !== current.entityType
        ) {
          data.entityType = normalized.entityType
          changedFields.push('entityType')
        }

        const previousRegistration = currentRegistration(current)
        const nextRegistration = Object.hasOwn(normalized, 'registration')
          ? normalized.registration ?? null
          : previousRegistration
        const registrationChanged = !sameRegistration(
          previousRegistration,
          nextRegistration,
        )
        if (registrationChanged) {
          setRegistrationUpdate(data, nextRegistration)
          changedFields.push('registration')
        }

        const previousContact = currentContact(current)
        const nextContact = Object.hasOwn(normalized, 'primaryContact')
          ? normalizedContactState(normalized.primaryContact ?? null)
          : previousContact
        if (!sameContact(previousContact, nextContact)) {
          setContactUpdate(data, nextContact)
          changedFields.push('primaryContact')
        }

        const previousAddress = currentAddress(current)
        const nextAddress = Object.hasOwn(normalized, 'primaryAddress')
          ? normalized.primaryAddress ?? null
          : previousAddress
        if (!sameAddress(previousAddress, nextAddress)) {
          setAddressUpdate(data, nextAddress)
          changedFields.push('primaryAddress')
        }
        if (
          Object.hasOwn(normalized, 'remark')
          && normalized.remark !== current.remark
        ) {
          data.remark = normalized.remark
          changedFields.push('remark')
        }

        if (current.enabled && !isContactReady(nextContact)) {
          throw createSupplierApiException(
            SUPPLIER_ERROR_CODES.ENABLE_REQUIREMENTS_NOT_MET,
          )
        }
        if (changedFields.length === 0) {
          return requireDetail(await readSupplierDetailForCommand(
            transaction,
            normalizedId,
          ))
        }

        const registrationRegionChanged =
          previousRegistration?.countryRegionId
          !== nextRegistration?.countryRegionId
        const changedAddressRegions = addressRegionsChanged(
          previousAddress,
          nextAddress,
        )
        if (registrationRegionChanged || changedAddressRegions) {
          await validateSupplierRegionReferences(
            this.regionLookup,
            transaction,
            {
              registration: registrationRegionChanged
                ? nextRegistration
                : null,
              primaryAddress: changedAddressRegions ? nextAddress : null,
            },
          )
        }
        if (
          registrationChanged
          && nextRegistration !== null
          && await readSupplierRegistrationDuplicate(
            transaction,
            nextRegistration.countryRegionId,
            nextRegistration.normalizedNumber,
          ) !== null
        ) {
          throw createSupplierApiException(
            SUPPLIER_ERROR_CODES.REGISTRATION_ALREADY_EXISTS,
          )
        }

        await updateSupplierRecord(
          transaction,
          normalizedId,
          data,
          current.version,
        )
        changedFields.sort()
        await this.audit.record(transaction, {
          eventType: AuditEventType.SUPPLIER_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'Supplier',
          targetId: normalizedId,
          requestId: context.requestId,
          metadata: {
            supplierCode: current.code,
            changedFields: changedFields.join(','),
            previousVersion: current.version,
            version: current.version + 1,
          },
        })
        return requireDetail(await readSupplierDetailForCommand(
          transaction,
          normalizedId,
        ))
      })
    } catch (error) {
      rethrowLifecycleError(error)
    }
  }

  enable(
    context: SupplierCommandContext,
    supplierId: unknown,
    input: ChangeSupplierStatusRequestDto,
  ): Promise<SupplierDto> {
    return this.changeStatus(context, supplierId, input, true)
  }

  disable(
    context: SupplierCommandContext,
    supplierId: unknown,
    input: ChangeSupplierStatusRequestDto,
  ): Promise<SupplierDto> {
    return this.changeStatus(context, supplierId, input, false)
  }

  private async changeStatus(
    context: SupplierCommandContext,
    supplierId: unknown,
    input: ChangeSupplierStatusRequestDto,
    enabled: boolean,
  ): Promise<SupplierDto> {
    const normalizedId = normalizeSupplierId(supplierId)
    if (
      !Number.isInteger(input.expectedVersion)
      || input.expectedVersion < 1
      || input.expectedVersion > 2_147_483_647
    ) {
      throw createSupplierApiException(SUPPLIER_ERROR_CODES.VALIDATION_FAILED)
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await readSupplierForMutation(transaction, normalizedId)
        if (current === null) {
          throw createSupplierApiException(SUPPLIER_ERROR_CODES.NOT_FOUND)
        }
        assertExpectedVersion(current.version, input.expectedVersion)
        if (current.enabled === enabled) {
          return requireDetail(await readSupplierDetailForCommand(
            transaction,
            normalizedId,
          ))
        }
        if (enabled && !isContactReady(currentContact(current))) {
          throw createSupplierApiException(
            SUPPLIER_ERROR_CODES.ENABLE_REQUIREMENTS_NOT_MET,
          )
        }

        await updateSupplierRecord(
          transaction,
          normalizedId,
          { enabled },
          current.version,
        )
        await this.audit.record(transaction, {
          eventType: enabled
            ? AuditEventType.SUPPLIER_ENABLED
            : AuditEventType.SUPPLIER_DISABLED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'Supplier',
          targetId: normalizedId,
          requestId: context.requestId,
          metadata: {
            supplierCode: current.code,
            changedFields: 'enabled',
            previousVersion: current.version,
            version: current.version + 1,
          },
        })
        return requireDetail(await readSupplierDetailForCommand(
          transaction,
          normalizedId,
        ))
      })
    } catch (error) {
      rethrowLifecycleError(error)
    }
  }
}
