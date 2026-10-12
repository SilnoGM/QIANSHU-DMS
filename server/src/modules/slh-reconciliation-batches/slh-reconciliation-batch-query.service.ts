import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { DictionaryLookupService } from '../dictionaries/dictionary-lookup.service'
import type { StoredDictionaryValueResolution } from '../dictionaries/dictionary-lookup.service'
import { buildSlhBillListWhere, withSlhBillIncompleteReconciliation } from '../slh-bills/slh-bill-list-filter'
import { serializeSlhBillListItem, slhBillListInclude } from '../slh-bills/slh-bill.serializer'
import type { SlhBillListRow } from '../slh-bills/slh-bill.serializer'
import type { SlhBillPageDto } from '../slh-bills/slh-bill.dto'
import { matchBillUnreconciledLines } from './slh-reconciliation-batch.matcher'
import { slhReconciliationBatchFailure } from './slh-reconciliation-batch.errors'
import { slhReconciliationBatchUuid } from './slh-reconciliation-batch.normalizer'
import {
  collectMemberPurchaseOrderSuppliers, serializeSlhReconciliationBatchDetail, serializeSlhReconciliationBatchListItem,
  slhReconciliationBatchDetailInclude, slhReconciliationBatchListInclude,
} from './slh-reconciliation-batch.serializer'
import type { SlhReconciliationBatchDetailRow } from './slh-reconciliation-batch.serializer'
import { SlhReconciliationBatchFilterDto, SlhReconciliationBillBlockReasonDto, SlhReconciliationBillGroupDto } from './slh-reconciliation-batch.dto'
import type {
  SlhBillLineUnmatchedReasonCountDto, SlhReconciliationBatchCandidateQueryDto, SlhReconciliationBatchDetailDto,
  SlhReconciliationBatchListQueryDto, SlhReconciliationBatchPageDto, SlhReconciliationBillOptionDto,
  SlhReconciliationBillOptionPageDto, SlhReconciliationBillOptionQueryDto, SlhReconciliationReconcilableCountsDto,
  SlhReconciliationReconcilableCountsRequestDto, SlhReconciliationSettlementListDto,
  SlhReconciliationSettlementListQueryDto, SlhReconciliationSettlementRecordDto,
} from './slh-reconciliation-batch.dto'

const DEFAULT_PAGE_SIZE = 20
/** 核对记录一次性返回的条数上限：单行确认次数很少，超出只可能是异常数据。 */
const SETTLEMENT_RECORD_LIMIT = 50

/** 供应商字典码：与采购域和商品域用的是同一个码（该字面量在各消费方各自声明）。 */
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'

/** 列表筛选取值 → 完成态条件；`all` 表示不加状态条件。 */
function batchStatusWhere(status: SlhReconciliationBatchFilterDto): Prisma.SlhReconciliationBatchWhereInput {
  if (status === SlhReconciliationBatchFilterDto.IN_PROGRESS) {
    return { completedAt: null }
  }
  if (status === SlhReconciliationBatchFilterDto.COMPLETED) {
    return { completedAt: { not: null } }
  }
  return {}
}

/** 一张账单「当前能不能发起对账」的评估结果：匹配明细 + 占用/剩余行情况。 */
interface SlhBillReconciliationOption {
  bill: SlhBillListRow
  inProgressBatch: boolean
  unreconciledLineCount: number
  reconcilableLineIds: string[]
  reasons: SlhBillLineUnmatchedReasonCountDto[]
}

/** 不合格原因按条数汇总（多的在前，同数按原因码稳定排序）。 */
function summarizeUnmatchedReasons(matches: Awaited<ReturnType<typeof matchBillUnreconciledLines>>): SlhBillLineUnmatchedReasonCountDto[] {
  const counts = new Map<string, number>()
  for (const match of matches) {
    if (match.status !== 'UNMATCHED' || match.reason === null) {
      continue
    }
    counts.set(match.reason, (counts.get(match.reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code: code as SlhBillLineUnmatchedReasonCountDto['code'], count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

/**
 * 对账批次的读查询。
 *
 * 已解冻的读路径：候选账单（新建批次弹窗的数据来源）、批次列表与批次详情
 * （详情页头部与创建/结束的响应体）；匹配预览仍是空壳。
 */
@Injectable()
export class SlhReconciliationBatchQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
  ) {}

  /**
   * 批次列表：状态筛选（默认只看进行中）+ 关键词（批次编号 / 账单编号 / 账单名称）+ 分页。
   * 列表与总数共用同一份条件，否则筛选后会出现「有数据但总数为 0」。
   */
  async list(query: SlhReconciliationBatchListQueryDto): Promise<SlhReconciliationBatchPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const keyword = query.keyword?.trim()
    const where: Prisma.SlhReconciliationBatchWhereInput = {
      ...batchStatusWhere(query.status ?? SlhReconciliationBatchFilterDto.IN_PROGRESS),
      ...(keyword === undefined || keyword === '' ? {} : {
        OR: [
          { batchNo: { contains: keyword, mode: 'insensitive' } },
          { bill: { slhBillNo: { contains: keyword, mode: 'insensitive' } } },
          { bill: { billName: { contains: keyword, mode: 'insensitive' } } },
        ],
      }),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhReconciliationBatch.findMany({
        where, include: slhReconciliationBatchListInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.slhReconciliationBatch.count({ where }),
    ])
    return { items: items.map(serializeSlhReconciliationBatchListItem), total, page, pageSize }
  }

  /**
   * 弹窗第一步的候选账单：生效中、至少一行未对账、且没有进行中的批次。
   * 「正在对账中」的账单直接过滤掉而不是展示为不可选：它此刻根本不能开第二次核对，
   * 用户需要的是去看那个批次，而不是一个点不动的禁用行。
   */
  async candidates(query: SlhReconciliationBatchCandidateQueryDto): Promise<SlhBillPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const where: Prisma.SlhBillWhereInput = {
      ...withSlhBillIncompleteReconciliation(buildSlhBillListWhere({ keyword: query.keyword })),
      reconciliationBatches: { none: { completedAt: null } },
    }
    // 列表与总数共用同一份条件，否则搜索后会出现"有结果但总数为 0"。
    const [items, total] = await this.prisma.$transaction([
      this.prisma.slhBill.findMany({
        where, include: slhBillListInclude,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.slhBill.count({ where }),
    ])
    return { items: items.map(serializeSlhBillListItem), total, page, pageSize }
  }

  /** 批次详情：详情页头部与创建/结束的响应体共用这一处读取。 */
  async detail(id: string): Promise<SlhReconciliationBatchDetailDto> {
    const row = await this.prisma.slhReconciliationBatch.findUnique({
      where: { id: slhReconciliationBatchUuid(id) },
      include: slhReconciliationBatchDetailInclude,
    })
    if (!row) {
      slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '对账批次不存在', 404)
    }
    return serializeSlhReconciliationBatchDetail(row, await this.resolveMemberSuppliers(row))
  }

  /**
   * 核对记录：按批次成员行取历史，最新的在最前。
   *
   * 只认「该批次下的这个成员行」——与「同一成员行最多一条有效」的部分唯一索引同范围；
   * 记录量随确认次数增长，因此带一个防御性上限（单行确认次数很少，不做分页）。
   */
  async settlements(id: string, query: SlhReconciliationSettlementListQueryDto): Promise<SlhReconciliationSettlementListDto> {
    const batchId = slhReconciliationBatchUuid(id)
    const batch = await this.prisma.slhReconciliationBatch.findUnique({
      where: { id: batchId },
      select: {
        members: { where: { id: slhReconciliationBatchUuid(query.batchLineId) }, select: { id: true } },
      },
    })
    if (batch === null || batch.members.length === 0) {
      slhReconciliationBatchFailure('SLH_RECON_BATCH_NOT_FOUND', '批次成员行不存在', 404)
    }
    const batchLineId = batch.members[0].id
    const rows = await this.prisma.slhReconciliationSettlement.findMany({
      where: { batchId, batchLineId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SETTLEMENT_RECORD_LIMIT,
      select: {
        id: true, status: true, rateSource: true, foreignUnitsPerCny: true, paymentFeeRate: true,
        codAmountTwd: true, codAmountCurrency: true,
        ntdSurchargeAmountTwd: true, ntdSurchargeCurrency: true,
        payableAmountCny: true, payableCurrency: true,
        settlementAmountCny: true, settlementCurrency: true,
        salesAmount: true, salesCurrency: true,
        paymentFeeAmountCny: true, paymentFeeCurrency: true,
        slhBillNo: true, salesOrderNo: true, purchaseOrderNo: true, containerBatchNo: true,
        shipmentNo: true, warehouseReceiptReference: true, shippingMarkText: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
      },
    })
    return {
      items: rows.map(row => ({
        id: row.id,
        status: row.status as SlhReconciliationSettlementRecordDto['status'],
        rateSource: row.rateSource as SlhReconciliationSettlementRecordDto['rateSource'],
        foreignUnitsPerCny: row.foreignUnitsPerCny.toFixed(12),
        paymentFeeRate: row.paymentFeeRate.toFixed(12),
        codAmountTwd: row.codAmountTwd?.toFixed(2) ?? null,
        codAmountCurrency: row.codAmountCurrency,
        ntdSurchargeAmountTwd: row.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
        ntdSurchargeCurrency: row.ntdSurchargeCurrency,
        payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null,
        payableCurrency: row.payableCurrency,
        settlementAmountCny: row.settlementAmountCny?.toFixed(2) ?? null,
        settlementCurrency: row.settlementCurrency,
        salesAmount: row.salesAmount?.toFixed(4) ?? null,
        salesCurrency: row.salesCurrency,
        paymentFeeAmountCny: row.paymentFeeAmountCny?.toFixed(2) ?? null,
        paymentFeeCurrency: row.paymentFeeCurrency,
        slhBillNo: row.slhBillNo,
        salesOrderNo: row.salesOrderNo,
        purchaseOrderNo: row.purchaseOrderNo,
        containerBatchNo: row.containerBatchNo,
        shipmentNo: row.shipmentNo,
        warehouseReceiptReference: row.warehouseReceiptReference,
        shippingMarkText: row.shippingMarkText,
        createdByDisplayName: row.createdBy.displayName,
        createdAt: row.createdAt.toISOString(),
      })),
    }
  }

  /**
   * 成员采购单的供应商标签：与采购域共用同一个字典码与解析服务，
   * 保证同一供应商在对账页与采购页显示一致（未命中字典时由采购域的兜底逻辑处理）。
   */
  private async resolveMemberSuppliers(
    row: SlhReconciliationBatchDetailRow,
  ): Promise<ReadonlyMap<string, StoredDictionaryValueResolution>> {
    const dictionaryOrders = collectMemberPurchaseOrderSuppliers(row).filter(
      (order): order is typeof order & { readonly supplierValue: string } => order.supplierValue !== null,
    )
    if (dictionaryOrders.length === 0) {
      return new Map()
    }
    const resolutions = await this.dictionaryLookup.resolveStoredValues({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      values: dictionaryOrders.map(order => order.supplierValue),
    })
    return new Map(dictionaryOrders.map((order, index) => [order.id, resolutions[index]]))
  }

  /**
   * 评估一张账单当前能不能发起对账：跑一次匹配，再叠加占用与剩余行判断。
   * 「可核对」是即时值：不落库、不缓存，柜次数据变化后重算即得新结果。
   */
  private async evaluateBill(bill: SlhBillListRow): Promise<SlhBillReconciliationOption> {
    const [inProgressBatch, matches] = await Promise.all([
      this.prisma.slhReconciliationBatch.count({ where: { billId: bill.id, completedAt: null } }),
      matchBillUnreconciledLines(this.prisma, bill.id),
    ])
    return {
      bill,
      inProgressBatch: inProgressBatch > 0,
      unreconciledLineCount: matches.length,
      reconcilableLineIds: matches.filter(match => match.status === 'MATCHED').map(match => match.line.id),
      reasons: summarizeUnmatchedReasons(matches),
    }
  }

  /** 分组判定：占用中 → 无未对账行 → 无可核对行 → 可选（顺序即优先级）。 */
  private resolveBlockReason(option: SlhBillReconciliationOption): SlhReconciliationBillBlockReasonDto | null {
    if (option.inProgressBatch) {
      return SlhReconciliationBillBlockReasonDto.IN_PROGRESS_BATCH
    }
    if (option.unreconciledLineCount === 0) {
      return SlhReconciliationBillBlockReasonDto.NO_UNRECONCILED_LINES
    }
    if (option.reconcilableLineIds.length === 0) {
      return SlhReconciliationBillBlockReasonDto.NO_RECONCILABLE_LINES
    }
    return null
  }

  private serializeBillOption(option: SlhBillReconciliationOption): SlhReconciliationBillOptionDto {
    const blockReason = this.resolveBlockReason(option)
    return {
      ...serializeSlhBillListItem(option.bill),
      selectable: blockReason === null,
      reconcilableLineCount: option.reconcilableLineIds.length,
      reconcilableLineIds: option.reconcilableLineIds,
      blockReason,
      // 只有「没有可核对的行」这一档需要原因汇总；其余档位的原因已在 blockReason 上。
      reasons: blockReason === SlhReconciliationBillBlockReasonDto.NO_RECONCILABLE_LINES ? option.reasons : [],
    }
  }

  /**
   * 弹窗的「可选 / 不可选」两组账单：以关键词筛出生效中账单，逐单评估后分组。
   *
   * 分组取决于匹配结果（SQL 谓词表达不了），因此每次请求都会评估当前生效中的全部账单；
   * 顺联航账单按月度产出、量级很小，这样换来的「计数与分组同源」比省几次查询更重要。
   * 计数与分组共用同一份评估结果，避免两个请求之间的数字漂移。
   */
  async selectableBills(query: SlhReconciliationBillOptionQueryDto): Promise<SlhReconciliationBillOptionPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const bills = await this.prisma.slhBill.findMany({
      where: buildSlhBillListWhere({ keyword: query.keyword }),
      include: slhBillListInclude,
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
    })
    const options = await Promise.all(bills.map(async bill => this.serializeBillOption(await this.evaluateBill(bill))))
    const selectable = options.filter(option => option.selectable)
    const blocked = options.filter(option => !option.selectable)
    const group = query.group === SlhReconciliationBillGroupDto.SELECTABLE ? selectable : blocked
    return {
      items: group.slice((page - 1) * pageSize, page * pageSize),
      counts: { selectable: selectable.length, blocked: blocked.length },
      total: group.length,
      page,
      pageSize,
    }
  }

  /**
   * 静默算：按账单主键批量算「当前可核对行数」（账单列表的「当前可核对」列用）。
   *
   * 每单给两个数：`reconcilableLineCount`（匹配得上且尚未对账的行）与 `unfrozenLineCount`
   * （其中没有被进行中批次冻结、即「当前可核对」列显示的行）；**两者之差就是进行中批次
   * 已经冻结的明细行数**，所以账单被批次占用后前者不变、后者归零。同时带出占用该账单的
   * 进行中批次 id 与编号：账单列表据此把入口显示成「继续对账」而不是「开始对账」。
   * 未知账单按 0 行返回（调用方拿的是刚列出来的主键），全程只读。
   */
  async reconcilableCounts(input: SlhReconciliationReconcilableCountsRequestDto): Promise<SlhReconciliationReconcilableCountsDto> {
    const billIds = [...new Set(input.billIds)]
    // 进行中批次冻结了哪些行：一次查完再逐单做差集，避免每单再查一次批次与成员。
    // 「一张账单同时只有一个进行中批次」由创建路径的账单行锁与占用复检保证，因此这里按账单存一条。
    const activeBatches = await this.prisma.slhReconciliationBatch.findMany({
      where: { billId: { in: billIds }, completedAt: null },
      select: { id: true, batchNo: true, billId: true, members: { select: { lineId: true } } },
    })
    const frozenLineIdsByBill = new Map<string, Set<string>>()
    const inProgressBatchByBill = new Map<string, { id: string, batchNo: string }>()
    for (const batch of activeBatches) {
      const frozen = frozenLineIdsByBill.get(batch.billId) ?? new Set<string>()
      for (const member of batch.members) {
        frozen.add(member.lineId)
      }
      frozenLineIdsByBill.set(batch.billId, frozen)
      inProgressBatchByBill.set(batch.billId, { id: batch.id, batchNo: batch.batchNo })
    }
    const items = await Promise.all(billIds.map(async (billId) => {
      const matches = await matchBillUnreconciledLines(this.prisma, billId)
      const reconcilableLineIds = matches.filter(match => match.status === 'MATCHED').map(match => match.line.id)
      const frozenLineIds = frozenLineIdsByBill.get(billId)
      const inProgressBatch = inProgressBatchByBill.get(billId)
      return {
        billId,
        reconcilableLineCount: reconcilableLineIds.length,
        unfrozenLineCount: frozenLineIds === undefined
          ? reconcilableLineIds.length
          : reconcilableLineIds.filter(lineId => !frozenLineIds.has(lineId)).length,
        reconcilableLineIds,
        inProgressBatchId: inProgressBatch?.id ?? null,
        inProgressBatchNo: inProgressBatch?.batchNo ?? null,
        reasons: summarizeUnmatchedReasons(matches),
      }
    }))
    return { items }
  }
}
