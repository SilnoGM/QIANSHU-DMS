import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { DataScopeService, dataScopeFallback, resolveDataScopeActor } from '../access-control/data-scope.service'
import { fundWithdrawalScopeWhere } from './fund-withdrawal-access'
import {
  FUND_WITHDRAWAL_ERROR_CODES,
  fundWithdrawalFailure,
} from './fund-withdrawal.errors'
import type {
  FundWithdrawalDto,
  FundWithdrawalListQueryDto,
  FundWithdrawalPageDto,
} from './fund-withdrawal.dto'

const ROW_INCLUDE = {
  user: { select: { displayName: true, username: true, profile: { select: { avatarUrl: true } } } },
  account: { select: { balance: true } },
  reviewedBy: { select: { displayName: true, profile: { select: { avatarUrl: true } } } },
  paymentProofMediaAsset: { select: { id: true, originalFilename: true, createdAt: true } },
  fundPostingBatch: { select: { batchNo: true } },
} satisfies Prisma.FundWithdrawalRequestInclude

type Row = Prisma.FundWithdrawalRequestGetPayload<{ include: typeof ROW_INCLUDE }>

export interface FundWithdrawalProofAsset {
  readonly checksumSha256: string | null
  readonly mimeType: string | null
  readonly objectKey: string | null
  readonly originalFilename: string
  readonly sizeBytes: bigint | null
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

function toDto(row: Row): FundWithdrawalDto {
  return {
    id: row.id,
    version: row.version,
    withdrawalNo: row.withdrawalNo,
    userId: row.userId,
    applicantName: row.user.displayName,
    applicantUsername: row.user.username,
    applicantAvatarUrl: row.user.profile?.avatarUrl ?? null,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    status: row.status,
    accountBalance: row.account.balance.toFixed(2),
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: toIso(row.reviewedAt),
    reviewerName: row.reviewedBy?.displayName ?? null,
    reviewerAvatarUrl: row.reviewedBy?.profile?.avatarUrl ?? null,
    rejectReason: row.rejectReason,
    paymentProof: row.paymentProofMediaAsset === null
      ? null
      : {
          mediaAssetId: row.paymentProofMediaAsset.id,
          fileName: row.paymentProofMediaAsset.originalFilename,
          uploadedAt: row.paymentProofMediaAsset.createdAt.toISOString(),
        },
    fundPostingBatchNo: row.fundPostingBatch?.batchNo ?? null,
  }
}

function statusWhere(
  status: FundWithdrawalListQueryDto['status'],
): Prisma.FundWithdrawalRequestWhereInput {
  return status === undefined || status === 'ALL'
    ? {}
    : { status }
}

/** 本人与财务共用同一张表的读模型；归属由查询条件强制，不在客户端传入。 */
@Injectable()
export class FundWithdrawalQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService = dataScopeFallback(),
  ) {}

  async listOwn(userId: string, query: FundWithdrawalListQueryDto): Promise<FundWithdrawalPageDto> {
    return this.list({ userId }, query)
  }

  async getOwn(userId: string, id: string): Promise<FundWithdrawalDto> {
    return this.get({ id, userId })
  }

  async listReview(
    query: FundWithdrawalListQueryDto,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<FundWithdrawalPageDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.list(fundWithdrawalScopeWhere(scope, actorUserId), query)
  }

  async getReview(id: string, actorUserId: string = resolveDataScopeActor()): Promise<FundWithdrawalDto> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.get({ id, ...fundWithdrawalScopeWhere(scope, actorUserId) })
  }

  async proofAssetOwn(userId: string, id: string): Promise<FundWithdrawalProofAsset> {
    return this.proofAsset({ id, userId })
  }

  async proofAssetReview(
    id: string,
    actorUserId: string = resolveDataScopeActor(),
  ): Promise<FundWithdrawalProofAsset> {
    const scope = await this.dataScope.resolve(actorUserId)
    return this.proofAsset(scope === 'SELF' ? { id, userId: actorUserId } : { id })
  }

  private async list(
    baseWhere: Prisma.FundWithdrawalRequestWhereInput,
    query: FundWithdrawalListQueryDto,
  ): Promise<FundWithdrawalPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const pageWhere: Prisma.FundWithdrawalRequestWhereInput = {
      ...baseWhere,
      ...statusWhere(query.status),
    }
    // 计数按基础范围分组，不能被当前状态筛选或分页截断；前端因此无需为每个状态再发一次列表。
    const [rows, total, statusRows] = await this.prisma.$transaction([
      this.prisma.fundWithdrawalRequest.findMany({
        where: pageWhere,
        include: ROW_INCLUDE,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fundWithdrawalRequest.count({ where: pageWhere }),
      this.prisma.fundWithdrawalRequest.groupBy({
        by: ['status'],
        where: baseWhere,
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
        count: typeof row._count === 'object' && row._count !== null
          ? row._count._all ?? 0
          : 0,
      })),
    }
  }

  private async get(where: Prisma.FundWithdrawalRequestWhereInput): Promise<FundWithdrawalDto> {
    const row = await this.prisma.fundWithdrawalRequest.findFirst({
      where,
      include: ROW_INCLUDE,
    })
    if (row === null) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.NOT_FOUND,
        '提款申请不存在',
        404,
      )
    }
    return toDto(row)
  }

  private async proofAsset(where: {
    readonly id: string
    readonly userId?: string
  }): Promise<FundWithdrawalProofAsset> {
    const row = await this.prisma.fundWithdrawalRequest.findFirst({
      where,
      select: {
        paymentProofMediaAsset: {
          select: {
            checksumSha256: true,
            mimeType: true,
            objectKey: true,
            originalFilename: true,
            sizeBytes: true,
          },
        },
      },
    })
    if (row === null || row.paymentProofMediaAsset === null) {
      fundWithdrawalFailure(
        FUND_WITHDRAWAL_ERROR_CODES.PROOF_UNAVAILABLE,
        '这条提款申请还没有付款截图',
        404,
      )
    }
    return row.paymentProofMediaAsset
  }
}
