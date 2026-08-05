import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  SupplierEntityType,
  type SupplierEntityType as SupplierEntityTypeValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  type SupplierListQueryDto,
  SupplierSortBy,
  SupplierSortOrder,
  SupplierStatusFilter,
} from './dto/supplier-management.dto'
import type {
  SupplierDto,
  SupplierListItemDto,
  SupplierPageDto,
  SupplierRegionReferenceDto,
} from './dto/supplier-response.dto'
import {
  createSupplierApiException,
  SUPPLIER_ERROR_CODES,
} from './supplier.errors'
import { normalizeSupplierSearchQuery } from './supplier.normalizer'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const REGION_REFERENCE_SELECT = { id: true, name: true } as const

const SUPPLIER_LIST_SELECT = {
  id: true,
  code: true,
  legalName: true,
  shortName: true,
  entityType: true,
  contactName: true,
  contactPhone: true,
  contactWechatId: true,
  enabled: true,
  version: true,
  updatedAt: true,
  registrationCountryRegion: { select: REGION_REFERENCE_SELECT },
  addressCountryRegion: { select: REGION_REFERENCE_SELECT },
  addressProvinceState: { select: REGION_REFERENCE_SELECT },
  addressCity: { select: REGION_REFERENCE_SELECT },
} as const satisfies Prisma.SupplierSelect

const SUPPLIER_DETAIL_SELECT = {
  id: true,
  code: true,
  legalName: true,
  shortName: true,
  entityType: true,
  registrationCountryRegionId: true,
  registrationNumber: true,
  contactName: true,
  contactPhone: true,
  contactWechatId: true,
  addressCountryRegionId: true,
  addressProvinceStateId: true,
  addressCityId: true,
  addressLine: true,
  postalCode: true,
  remark: true,
  enabled: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  registrationCountryRegion: { select: REGION_REFERENCE_SELECT },
  addressCountryRegion: { select: REGION_REFERENCE_SELECT },
  addressProvinceState: { select: REGION_REFERENCE_SELECT },
  addressCity: { select: REGION_REFERENCE_SELECT },
} as const satisfies Prisma.SupplierSelect

type SupplierListRecord = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_LIST_SELECT
}>
type SupplierDetailRecord = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_DETAIL_SELECT
}>

interface NormalizedSupplierListQuery {
  readonly where: Prisma.SupplierWhereInput
  readonly orderBy: Prisma.SupplierOrderByWithRelationInput[]
  readonly page: number
  readonly pageSize: number
  readonly skip: number
}

function validationFailure(): never {
  throw createSupplierApiException(SUPPLIER_ERROR_CODES.VALIDATION_FAILED)
}

function rethrowSupplierQueryError(error: unknown): never {
  if (error instanceof ApiException) throw error
  throw createSupplierApiException(SUPPLIER_ERROR_CODES.INTERNAL_ERROR)
}

function normalizeListQuery(
  input: Readonly<Partial<SupplierListQueryDto>>,
): NormalizedSupplierListQuery {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return validationFailure()
  }
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const skip = (page - 1) * pageSize
  const statusValues = new Set(Object.values(SupplierStatusFilter))
  const entityValues = new Set<SupplierEntityTypeValue>(
    Object.values(SupplierEntityType),
  )
  const sortValues = new Set(Object.values(SupplierSortBy))
  const orderValues = new Set(Object.values(SupplierSortOrder))
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 100
    || !Number.isSafeInteger(skip)
    || (input.status !== undefined && !statusValues.has(input.status))
    || (
      input.entityType !== undefined
      && !entityValues.has(input.entityType)
    )
    || (input.sortBy !== undefined && !sortValues.has(input.sortBy))
    || (
      input.sortOrder !== undefined
      && !orderValues.has(input.sortOrder)
    )
  ) return validationFailure()

  const where: Prisma.SupplierWhereInput = {}
  if (input.status !== undefined) {
    where.enabled = input.status === SupplierStatusFilter.ENABLED
  }
  if (input.entityType !== undefined) where.entityType = input.entityType
  if (input.query !== undefined) {
    const query = normalizeSupplierSearchQuery(input.query)
    where.OR = [
      { code: { contains: query.code } },
      { normalizedLegalName: { contains: query.name } },
      { normalizedShortName: { contains: query.name } },
      { normalizedRegistrationNumber: { contains: query.registrationNumber } },
      { normalizedContactName: { contains: query.name } },
      { normalizedContactPhone: { contains: query.contactPhone } },
      { normalizedContactWechatId: { contains: query.contactWechatId } },
    ]
  }

  const direction = input.sortOrder ?? SupplierSortOrder.DESC
  let sortField: Prisma.SupplierOrderByWithRelationInput
  switch (input.sortBy ?? SupplierSortBy.UPDATED_AT) {
    case SupplierSortBy.CODE:
      sortField = { code: direction }
      break
    case SupplierSortBy.LEGAL_NAME:
      sortField = { normalizedLegalName: direction }
      break
    case SupplierSortBy.UPDATED_AT:
      sortField = { updatedAt: direction }
      break
  }
  return {
    where,
    orderBy: [sortField, { id: direction }],
    page,
    pageSize,
    skip,
  }
}

function buildRegionPath(
  ...regions: Array<SupplierRegionReferenceDto | null>
): SupplierRegionReferenceDto[] {
  return regions.filter(
    (region): region is SupplierRegionReferenceDto => region !== null,
  )
}

function mapListItem(record: SupplierListRecord): SupplierListItemDto {
  return {
    id: record.id,
    code: record.code,
    legalName: record.legalName,
    shortName: record.shortName,
    entityType: record.entityType,
    registrationCountryRegion: record.registrationCountryRegion,
    primaryContactName: record.contactName,
    hasPrimaryContactPhone: record.contactPhone !== null,
    hasPrimaryContactWechatId: record.contactWechatId !== null,
    primaryAddressRegionPath: buildRegionPath(
      record.addressCountryRegion,
      record.addressProvinceState,
      record.addressCity,
    ),
    enabled: record.enabled,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  }
}

function mapDetail(record: SupplierDetailRecord): SupplierDto {
  const missingFields: SupplierDto['enableReadiness']['missingFields'] = []
  if (record.contactName === null) missingFields.push('primaryContact.name')
  if (record.contactPhone === null && record.contactWechatId === null) {
    missingFields.push('primaryContact.channel')
  }
  const hasContact = record.contactName !== null
    || record.contactPhone !== null
    || record.contactWechatId !== null
  const hasAddress = record.addressCountryRegionId !== null
    || record.addressProvinceStateId !== null
    || record.addressCityId !== null
    || record.addressLine !== null
    || record.postalCode !== null

  return {
    id: record.id,
    code: record.code,
    legalName: record.legalName,
    shortName: record.shortName,
    entityType: record.entityType,
    registration: record.registrationCountryRegion === null
      || record.registrationNumber === null
      ? null
      : {
          countryRegion: record.registrationCountryRegion,
          number: record.registrationNumber,
        },
    primaryContact: hasContact
      ? {
          name: record.contactName,
          phone: record.contactPhone,
          wechatId: record.contactWechatId,
        }
      : null,
    primaryAddress: hasAddress
      ? {
          countryRegionId: record.addressCountryRegionId,
          provinceStateId: record.addressProvinceStateId,
          cityId: record.addressCityId,
          regionPath: buildRegionPath(
            record.addressCountryRegion,
            record.addressProvinceState,
            record.addressCity,
          ),
          addressLine: record.addressLine,
          postalCode: record.postalCode,
        }
      : null,
    remark: record.remark,
    enabled: record.enabled,
    enableReadiness: {
      ready: missingFields.length === 0,
      missingFields,
    },
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

@Injectable()
export class SupplierQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    input: Readonly<Partial<SupplierListQueryDto>>,
  ): Promise<SupplierPageDto> {
    try {
      const query = normalizeListQuery(input)
      const result = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const total = await transaction.supplier.count({ where: query.where })
        const items = await transaction.supplier.findMany({
          where: query.where,
          select: SUPPLIER_LIST_SELECT,
          orderBy: query.orderBy,
          skip: query.skip,
          take: query.pageSize,
        })
        return { items, total }
      })
      return {
        items: result.items.map(mapListItem),
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
      }
    } catch (error) {
      rethrowSupplierQueryError(error)
    }
  }

  async getById(supplierId: string): Promise<SupplierDto> {
    try {
      if (!UUID_PATTERN.test(supplierId)) return validationFailure()
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId.toLowerCase() },
        select: SUPPLIER_DETAIL_SELECT,
      })
      if (supplier === null) {
        throw createSupplierApiException(SUPPLIER_ERROR_CODES.NOT_FOUND)
      }
      return mapDetail(supplier)
    } catch (error) {
      rethrowSupplierQueryError(error)
    }
  }
}
