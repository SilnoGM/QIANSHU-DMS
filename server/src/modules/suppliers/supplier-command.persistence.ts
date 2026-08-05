import { Prisma } from '../../generated/prisma/client'
import type { SupplierEntityType } from '../../generated/prisma/enums'
import type { SupplierDto } from './dto/supplier-response.dto'
import {
  mapSupplierDetail,
  SUPPLIER_DETAIL_SELECT,
} from './supplier-query.service'

export interface SupplierCreateIntentRecord {
  readonly id: string
  readonly requestFingerprintHash: Buffer
  readonly supplierId: string | null
}

export interface SupplierNumberingIssuanceRecord {
  readonly id: string
  readonly generatedNumber: string
  readonly consumerCode: string
  readonly ruleCode: string
}

export interface CreateSupplierRecordInput {
  readonly code: string
  readonly numberingIssuanceId: string
  readonly legalName: string
  readonly normalizedLegalName: string
  readonly shortName: string | null
  readonly normalizedShortName: string | null
  readonly entityType: SupplierEntityType
  readonly registrationCountryRegionId: string | null
  readonly registrationNumber: string | null
  readonly normalizedRegistrationNumber: string | null
  readonly contactName: string | null
  readonly normalizedContactName: string | null
  readonly contactPhone: string | null
  readonly normalizedContactPhone: string | null
  readonly contactWechatId: string | null
  readonly normalizedContactWechatId: string | null
  readonly addressCountryRegionId: string | null
  readonly addressProvinceStateId: string | null
  readonly addressCityId: string | null
  readonly addressLine: string | null
  readonly postalCode: string | null
  readonly remark: string | null
  readonly enabled: false
}

interface SupplierCreateIntentRow {
  id: string
  requestFingerprintHash: Uint8Array
  supplierId: string | null
}

function mapCreateIntentRow(
  row: SupplierCreateIntentRow | undefined,
): SupplierCreateIntentRecord {
  if (
    row === undefined
    || typeof row.id !== 'string'
    || !(row.requestFingerprintHash instanceof Uint8Array)
    || row.requestFingerprintHash.byteLength !== 32
    || (row.supplierId !== null && typeof row.supplierId !== 'string')
  ) {
    throw new Error('Supplier create intent invariant violated')
  }
  return {
    id: row.id,
    requestFingerprintHash: Buffer.from(row.requestFingerprintHash),
    supplierId: row.supplierId,
  }
}

/** INSERT 冲突会等待并发 Tx-A 提交，随后同一事务再锁定唯一 scope 行。 */
export async function upsertAndLockSupplierCreateRequest(
  transaction: Prisma.TransactionClient,
  input: {
    readonly idempotencyScopeHash: Buffer
    readonly requestFingerprintHash: Buffer
  },
): Promise<SupplierCreateIntentRecord> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "supplier_create_requests" (
      "id",
      "idempotency_scope_hash",
      "request_fingerprint_hash",
      "created_at"
    )
    VALUES (
      gen_random_uuid(),
      ${input.idempotencyScopeHash},
      ${input.requestFingerprintHash},
      now()
    )
    ON CONFLICT ("idempotency_scope_hash") DO NOTHING
  `)
  const rows = await transaction.$queryRaw<SupplierCreateIntentRow[]>(
    Prisma.sql`
      SELECT
        "id",
        "request_fingerprint_hash" AS "requestFingerprintHash",
        "supplier_id" AS "supplierId"
      FROM "supplier_create_requests"
      WHERE "idempotency_scope_hash" = ${input.idempotencyScopeHash}
      FOR UPDATE
    `,
  )
  return mapCreateIntentRow(rows[0])
}

export async function lockSupplierCreateRequest(
  transaction: Prisma.TransactionClient,
  requestId: string,
): Promise<SupplierCreateIntentRecord | null> {
  const rows = await transaction.$queryRaw<SupplierCreateIntentRow[]>(
    Prisma.sql`
      SELECT
        "id",
        "request_fingerprint_hash" AS "requestFingerprintHash",
        "supplier_id" AS "supplierId"
      FROM "supplier_create_requests"
      WHERE "id" = CAST(${requestId} AS uuid)
      FOR UPDATE
    `,
  )
  return rows[0] === undefined ? null : mapCreateIntentRow(rows[0])
}

export async function lockSupplierNumberingIssuance(
  transaction: Prisma.TransactionClient,
  issuanceId: string,
): Promise<SupplierNumberingIssuanceRecord | null> {
  const rows = await transaction.$queryRaw<SupplierNumberingIssuanceRecord[]>(
    Prisma.sql`
      SELECT
        issuance."id",
        issuance."generated_number" AS "generatedNumber",
        issuance."consumer_code" AS "consumerCode",
        rule."rule_code" AS "ruleCode"
      FROM "numbering_issuances" AS issuance
      INNER JOIN "numbering_rules" AS rule
        ON rule."id" = issuance."rule_id"
      WHERE issuance."id" = CAST(${issuanceId} AS uuid)
      FOR KEY SHARE OF issuance
    `,
  )
  return rows[0] ?? null
}

export async function readSupplierRegistrationDuplicate(
  transaction: Prisma.TransactionClient,
  countryRegionId: string,
  normalizedRegistrationNumber: string,
): Promise<string | null> {
  const duplicate = await transaction.supplier.findFirst({
    where: {
      registrationCountryRegionId: countryRegionId,
      normalizedRegistrationNumber,
    },
    select: { id: true },
  })
  return duplicate?.id ?? null
}

export async function createSupplierRecord(
  transaction: Prisma.TransactionClient,
  data: CreateSupplierRecordInput,
): Promise<{ readonly id: string }> {
  return transaction.supplier.create({ data, select: { id: true } })
}

export async function completeSupplierCreateRequest(
  transaction: Prisma.TransactionClient,
  requestId: string,
  supplierId: string,
): Promise<void> {
  const result = await transaction.supplierCreateRequest.updateMany({
    where: { id: requestId, supplierId: null },
    data: { supplierId },
  })
  if (result.count !== 1) {
    throw new Error('Supplier create intent completion invariant violated')
  }
}

export async function readSupplierDetailForCommand(
  transaction: Prisma.TransactionClient,
  supplierId: string,
): Promise<SupplierDto | null> {
  const supplier = await transaction.supplier.findUnique({
    where: { id: supplierId },
    select: SUPPLIER_DETAIL_SELECT,
  })
  return supplier === null ? null : mapSupplierDetail(supplier)
}
