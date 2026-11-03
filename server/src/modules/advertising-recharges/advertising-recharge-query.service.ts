import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import {
  PERSON_REFERENCE_SELECT,
  toPersonReference,
  type PersonReferenceRow,
} from '../../infrastructure/database/person-reference'
import type { AdvertisingRechargeMediaAsset } from './advertising-recharge-document.service'
import {
  ADVERTISING_RECHARGE_ERROR_CODES,
  advertisingRechargeFailure,
} from './advertising-recharge.errors'
import type {
  AdvertisingRechargeDto,
  AdvertisingRechargeListQueryDto,
  AdvertisingRechargePageDto,
} from './advertising-recharge.dto'

const person = { select: PERSON_REFERENCE_SELECT }
const image = { select: { id: true, originalFilename: true, createdAt: true, checksumSha256: true, mimeType: true, objectKey: true, sizeBytes: true } }

const ROW_INCLUDE = {
  applicant: person,
  reviewedBy: person,
  paidBy: person,
  voidedBy: person,
  paymentQrMediaAsset: { select: { id: true, originalFilename: true, createdAt: true } },
  paymentProofMediaAsset: { select: { id: true, originalFilename: true, createdAt: true } },
  fundPostingBatch: { select: { batchNo: true } },
  fundReversalBatch: { select: { batchNo: true } },
} satisfies Prisma.AdvertisingRechargeRequestInclude

type Row = Prisma.AdvertisingRechargeRequestGetPayload<{ include: typeof ROW_INCLUDE }>

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function media(value: { id: string, originalFilename: string, createdAt: Date } | null) {
  return value === null
    ? null
    : { mediaAssetId: value.id, fileName: value.originalFilename, uploadedAt: value.createdAt.toISOString() }
}

/** 业务 DTO 的人员引用统一带头像；字段名用 name，与其它工作台页面一致。 */
function toAdvertisingPerson(row: PersonReferenceRow) {
  const reference = toPersonReference(row)
  return { id: reference.id, name: reference.displayName, avatarUrl: reference.avatarUrl }
}

function toDto(row: Row): AdvertisingRechargeDto {
  const paid = row.paymentAmountCny !== null
    && row.paymentProofMediaAsset !== null
    && row.paidAt !== null
    && row.paidBy !== null
  const rejected = row.status === 'REJECTED'
    && row.reviewedAt !== null
    && row.reviewedBy !== null
    && row.rejectReason !== null
  const voided = row.status === 'VOIDED'
    && row.voidedAt !== null
    && row.voidedBy !== null
    && row.voidReason !== null
  return {
    id: row.id,
    version: row.version,
    rechargeNo: row.rechargeNo,
    status: row.status,
    accountType: row.accountType,
    adAccountName: row.adAccountName,
    adAccountNo: row.adAccountNo,
    rechargeAmount: row.rechargeAmount.toFixed(2),
    rechargeCurrency: row.rechargeCurrency as AdvertisingRechargeDto['rechargeCurrency'],
    remark: row.remark,
    applicant: toAdvertisingPerson(row.applicant),
    submittedAt: row.submittedAt.toISOString(),
    paymentQr: media(row.paymentQrMediaAsset),
    payment: paid
      ? {
          amountCny: row.paymentAmountCny!.toFixed(2),
          proof: media(row.paymentProofMediaAsset)!,
          paidAt: row.paidAt!.toISOString(),
          paidBy: toAdvertisingPerson(row.paidBy as PersonReferenceRow),
          fundPostingBatchNo: row.fundPostingBatch?.batchNo ?? null,
        }
      : null,
    reject: rejected
      ? {
          reviewedAt: row.reviewedAt!.toISOString(),
          reviewedBy: toAdvertisingPerson(row.reviewedBy as PersonReferenceRow),
          reason: row.rejectReason!,
        }
      : null,
    withdrawnAt: toIso(row.withdrawnAt),
    void: voided
      ? {
          voidedAt: row.voidedAt!.toISOString(),
          voidedBy: toAdvertisingPerson(row.voidedBy as PersonReferenceRow),
          reason: row.voidReason!,
          reversalBatchNo: row.fundReversalBatch?.batchNo ?? null,
        }
      : null,
  }
}

function statusWhere(status: AdvertisingRechargeListQueryDto['status']): Prisma.AdvertisingRechargeRequestWhereInput {
  return status === undefined || status === 'ALL' ? {} : { status }
}

function keywordWhere(keyword: string | undefined, includeApplicant: boolean): Prisma.AdvertisingRechargeRequestWhereInput {
  const normalized = keyword?.trim()
  if (normalized === undefined || normalized === '') return {}
  const conditions: Prisma.AdvertisingRechargeRequestWhereInput[] = [
    { rechargeNo: { contains: normalized, mode: 'insensitive' } },
    { adAccountName: { contains: normalized, mode: 'insensitive' } },
    { adAccountNo: { contains: normalized, mode: 'insensitive' } },
  ]
  if (includeApplicant) {
    conditions.push({ applicant: { is: { displayName: { contains: normalized, mode: 'insensitive' } } } })
  }
  return { OR: conditions }
}

/**
 * 运营与财务共用同一张表的读模型：本人列表固定按申请人过滤，财务列表不加归属条件。
 * 归属条件由服务端从 session 生成，客户端不能通过查询参数扩大可见范围。
 */
@Injectable()
export class AdvertisingRechargeQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listOwn(userId: string, query: AdvertisingRechargeListQueryDto): Promise<AdvertisingRechargePageDto> {
    return this.queryPage({ applicantUserId: userId }, query, false)
  }

  async getOwn(userId: string, id: string): Promise<AdvertisingRechargeDto> {
    return this.get({ id, applicantUserId: userId })
  }

  async list(query: AdvertisingRechargeListQueryDto): Promise<AdvertisingRechargePageDto> {
    return this.queryPage({}, query, true)
  }

  async getAll(id: string): Promise<AdvertisingRechargeDto> {
    return this.get({ id })
  }

  async qrAssetOwn(userId: string, id: string): Promise<AdvertisingRechargeMediaAsset> {
    return this.readQrAsset({ id, applicantUserId: userId })
  }

  async qrAsset(id: string): Promise<AdvertisingRechargeMediaAsset> {
    return this.readQrAsset({ id })
  }

  async proofAssetOwn(userId: string, id: string): Promise<AdvertisingRechargeMediaAsset> {
    return this.readProofAsset({ id, applicantUserId: userId })
  }

  async proofAsset(id: string): Promise<AdvertisingRechargeMediaAsset> {
    return this.readProofAsset({ id })
  }

  private async queryPage(
    baseWhere: Prisma.AdvertisingRechargeRequestWhereInput,
    query: AdvertisingRechargeListQueryDto,
    includeApplicantKeyword: boolean,
  ): Promise<AdvertisingRechargePageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const keyword = keywordWhere(query.keyword, includeApplicantKeyword)
    const pageWhere: Prisma.AdvertisingRechargeRequestWhereInput = {
      AND: [baseWhere, statusWhere(query.status), keyword],
    }
    const [rows, total, statusRows] = await this.prisma.$transaction([
      this.prisma.advertisingRechargeRequest.findMany({
        where: pageWhere,
        include: ROW_INCLUDE,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.advertisingRechargeRequest.count({ where: pageWhere }),
      this.prisma.advertisingRechargeRequest.groupBy({
        by: ['status'],
        where: { AND: [baseWhere, keyword] },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ])
    return {
      items: rows.map(toDto),
      total,
      page,
      pageSize,
      statusCounts: statusRows.map(row => ({
        status: row.status,
        count: typeof row._count === 'object' && row._count !== null ? row._count._all ?? 0 : 0,
      })),
    }
  }

  private async get(where: Prisma.AdvertisingRechargeRequestWhereInput): Promise<AdvertisingRechargeDto> {
    const row = await this.prisma.advertisingRechargeRequest.findFirst({ where, include: ROW_INCLUDE })
    if (row === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.NOT_FOUND, '广告充值申请不存在', 404)
    }
    return toDto(row)
  }

  private async readQrAsset(where: { readonly id: string, readonly applicantUserId?: string }): Promise<AdvertisingRechargeMediaAsset> {
    const row = await this.prisma.advertisingRechargeRequest.findFirst({
      where,
      select: { paymentQrMediaAsset: image },
    })
    if (row === null || row.paymentQrMediaAsset === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.QR_UNAVAILABLE, '这条申请没有收款二维码', 404)
    }
    return row.paymentQrMediaAsset
  }

  private async readProofAsset(where: { readonly id: string, readonly applicantUserId?: string }): Promise<AdvertisingRechargeMediaAsset> {
    const row = await this.prisma.advertisingRechargeRequest.findFirst({
      where,
      select: { paymentProofMediaAsset: image },
    })
    if (row === null || row.paymentProofMediaAsset === null) {
      advertisingRechargeFailure(ADVERTISING_RECHARGE_ERROR_CODES.PROOF_UNAVAILABLE, '这条申请还没有付款截图', 404)
    }
    return row.paymentProofMediaAsset
  }
}
