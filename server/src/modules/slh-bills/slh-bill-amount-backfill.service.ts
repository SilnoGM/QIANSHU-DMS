/**
 * 账单金额空值回填：把旧口径下被写成 0.00 的空单元格改回 NULL。
 *
 * 背景：解析器过去把空单元格写成 0.00，与来源里的显式 0 合并；空值口径改成「NULL = 本行不涉及」
 * （迁移 20260930190000）后新导入的账单正确，但已入库的旧账单仍是 0.00，需要一次性校正。
 *
 * 为什么靠重新解析原件而不是纯 SQL：`source_data` 只按单元格引用保留行内单元格，没有
 * 「字段 → 列」映射，库里已经分不出「空」与「显式 0」；统一置 NULL 会毁掉真实零值
 * （例如 8 月账单里运费与合计应付各有一个来源写明的 0）。因此这里重新解析原件、
 * 逐格比对后再只改「库里 0.00 且重解析为空」的单元格。
 *
 * 约束：
 * - 只处理原件可用、sha256 与入库一致、行身份与其余数值全部对得上的账单；任何一处不符就整张跳过；
 * - 默认 dry-run，只有 `--apply` 才写库，且写库前先把六列原值落成回滚文件；
 * - 金额列受「凭证不可改」触发器保护，写入在同一事务内临时关闭触发器，事务结束即恢复；
 * - 幂等：已是 NULL 的单元格重解析仍为空 → 不再产生更新。
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import { requireMediaObjectKeyNamespace } from '../media/media-storage'
import { parseSlhBillWorkbook } from './slh-bill-parser'
import {
  planSlhBillAmountBackfill, SLH_BILL_AMOUNT_COLUMNS,
  type SlhBillAmountPlan, type SlhBillAmountSkipReason, type SlhBillAmountStoredLine,
} from './slh-bill-amount-plan'

export interface SlhBillAmountBackfillOptions {
  /** 是否真正写库；缺省为 dry-run。 */
  readonly apply?: boolean
  /** 单次处理的账单数上限。 */
  readonly limit?: number
}

export type SlhBillAmountBackfillSkipReason =
  | SlhBillAmountSkipReason
  | 'SOURCE_FILE_UNAVAILABLE'
  | 'SOURCE_FILE_CHANGED'
  | 'BILL_PARSE_FAILED'

export interface SlhBillAmountBackfillBillResult {
  readonly billNo: string
  readonly lines: number
  readonly blankToNull: number
  readonly explicitZeroKept: number
  readonly unchanged: number
  readonly status: 'APPLIED' | 'DRY_RUN' | 'UNCHANGED' | 'SKIPPED'
  readonly reason: SlhBillAmountBackfillSkipReason | null
}

export interface SlhBillAmountBackfillResult {
  readonly mode: 'APPLY' | 'DRY_RUN'
  readonly bills: readonly SlhBillAmountBackfillBillResult[]
  readonly blankToNull: number
  readonly explicitZeroKept: number
  readonly skipped: number
  readonly rollbackPath: string | null
}

const DEFAULT_LIMIT = 1000
/** 与账单原件上传上限一致；回填只读原件，不引入新的体量边界。 */
const SOURCE_MAX_BYTES = 50 * 1024 * 1024
/** 证据列的守护触发器；写入前后各执行一次 ALTER TABLE，事务回滚同样会恢复。 */
const DISABLE_IMMUTABLE_TRIGGER = Prisma.sql`ALTER TABLE "slh_bill_lines" DISABLE TRIGGER "slh_bill_lines_immutable_trigger"`
const ENABLE_IMMUTABLE_TRIGGER = Prisma.sql`ALTER TABLE "slh_bill_lines" ENABLE TRIGGER "slh_bill_lines_immutable_trigger"`

interface RollbackLine { readonly id: string, readonly lineNumber: number, readonly values: Record<string, string | null> }
interface RollbackBill { readonly billNo: string, readonly lines: readonly RollbackLine[] }

@Injectable()
export class SlhBillAmountBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: MediaContentDeliveryService,
  ) {}

  async run(options: SlhBillAmountBackfillOptions = {}): Promise<SlhBillAmountBackfillResult> {
    const apply = options.apply === true
    const limit = options.limit ?? DEFAULT_LIMIT
    const bills = await this.prisma.slhBill.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, slhBillNo: true, sourceFileSha256: true,
        sourceFile: { select: { objectKey: true, sizeBytes: true, status: true } },
      },
      take: limit,
    })

    const billsResults: SlhBillAmountBackfillBillResult[] = []
    const planned: { readonly billNo: string, readonly plan: SlhBillAmountPlan }[] = []

    for (const bill of bills) {
      const storedLines = await this.storedLines(bill.id)
      if (!storedLines.some(line => SLH_BILL_AMOUNT_COLUMNS.some(column => line.values[column] === '0.00'))) {
        billsResults.push({ billNo: bill.slhBillNo, blankToNull: 0, explicitZeroKept: 0, lines: storedLines.length, reason: null, status: 'UNCHANGED', unchanged: 0 })
        continue
      }
      const outcome = await this.plan(bill, storedLines)
      if ('reason' in outcome) {
        billsResults.push({ billNo: bill.slhBillNo, blankToNull: 0, explicitZeroKept: 0, lines: storedLines.length, reason: outcome.reason, status: 'SKIPPED', unchanged: 0 })
        continue
      }
      if (outcome.plan.updates.length === 0) {
        billsResults.push({ billNo: bill.slhBillNo, blankToNull: 0, explicitZeroKept: outcome.plan.explicitZeroKept, lines: storedLines.length, reason: null, status: 'UNCHANGED', unchanged: outcome.plan.unchanged })
        continue
      }
      planned.push({ billNo: bill.slhBillNo, plan: outcome.plan })
      billsResults.push({
        billNo: bill.slhBillNo, blankToNull: outcome.plan.blankToNull, explicitZeroKept: outcome.plan.explicitZeroKept,
        lines: storedLines.length, reason: null, status: apply ? 'APPLIED' : 'DRY_RUN', unchanged: outcome.plan.unchanged,
      })
    }

    let rollbackPath: string | null = null
    if (apply && planned.length > 0) {
      rollbackPath = await this.writeRollbackFile(planned)
      for (const item of planned) await this.applyBill(item.plan)
    }

    return {
      bills: billsResults,
      blankToNull: billsResults.reduce((sum, bill) => sum + bill.blankToNull, 0),
      explicitZeroKept: billsResults.reduce((sum, bill) => sum + bill.explicitZeroKept, 0),
      mode: apply ? 'APPLY' : 'DRY_RUN',
      rollbackPath,
      skipped: billsResults.filter(bill => bill.status === 'SKIPPED').length,
    }
  }

  private async storedLines(billId: string): Promise<SlhBillAmountStoredLine[]> {
    const rows = await this.prisma.slhBillLine.findMany({
      orderBy: { lineNumber: 'asc' },
      select: {
        id: true, lineNumber: true, sourceRowNumber: true,
        codAmountTwd: true, codHandlingAmountCny: true, freightAmountCny: true,
        ntdSurchargeAmountTwd: true, payableAmountCny: true, surchargeAmountCny: true,
      },
      where: { billId },
    })
    return rows.map(row => ({
      id: row.id, lineNumber: row.lineNumber, sourceRowNumber: row.sourceRowNumber,
      values: {
        codAmountTwd: row.codAmountTwd?.toFixed(2) ?? null,
        codHandlingAmountCny: row.codHandlingAmountCny?.toFixed(2) ?? null,
        freightAmountCny: row.freightAmountCny?.toFixed(2) ?? null,
        ntdSurchargeAmountTwd: row.ntdSurchargeAmountTwd?.toFixed(2) ?? null,
        payableAmountCny: row.payableAmountCny?.toFixed(2) ?? null,
        surchargeAmountCny: row.surchargeAmountCny?.toFixed(2) ?? null,
      },
    }))
  }

  private async plan(
    bill: { sourceFileSha256: string, sourceFile: { objectKey: string | null, sizeBytes: bigint | null, status: string } | null },
    storedLines: readonly SlhBillAmountStoredLine[],
  ): Promise<{ plan: SlhBillAmountPlan } | { reason: SlhBillAmountBackfillSkipReason }> {
    const asset = bill.sourceFile
    if (!asset || asset.status !== 'READY' || !asset.objectKey || asset.sizeBytes === null || asset.sizeBytes <= 0n) {
      return { reason: 'SOURCE_FILE_UNAVAILABLE' }
    }
    let buffer: Buffer
    try {
      const key = requireMediaObjectKeyNamespace(asset.objectKey, 'assets')
      const stat = await this.delivery.stat(key)
      if (!stat || BigInt(stat.sizeBytes) !== asset.sizeBytes) return { reason: 'SOURCE_FILE_UNAVAILABLE' }
      buffer = await this.read(key, Number(asset.sizeBytes))
    }
    catch {
      return { reason: 'SOURCE_FILE_UNAVAILABLE' }
    }
    // 原件是本次判定的唯一依据：哈希必须与入库时记录的一致，否则宁可跳过。
    if (createHash('sha256').update(buffer).digest('hex') !== bill.sourceFileSha256) return { reason: 'SOURCE_FILE_CHANGED' }

    let parsed: Awaited<ReturnType<typeof parseSlhBillWorkbook>>
    try {
      parsed = await parseSlhBillWorkbook(buffer)
    }
    catch {
      return { reason: 'BILL_PARSE_FAILED' }
    }

    const plan = planSlhBillAmountBackfill({
      parsed: parsed.lines.map(line => ({
        lineNumber: line.lineNumber,
        sourceRowNumber: line.sourceRowNumber,
        values: {
          codAmountTwd: line.codAmountTwd, codHandlingAmountCny: line.codHandlingAmountCny,
          freightAmountCny: line.freightAmountCny, ntdSurchargeAmountTwd: line.ntdSurchargeAmountTwd,
          payableAmountCny: line.payableAmountCny, surchargeAmountCny: line.surchargeAmountCny,
        },
      })),
      stored: storedLines,
    })
    return { plan }
  }

  private async read(objectKey: string, expectedBytes: number): Promise<Buffer> {
    const stored = await this.delivery.open(objectKey)
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of stored.stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        size += bytes.length
        if (size > expectedBytes || size > SOURCE_MAX_BYTES) throw new Error('SLH_BILL_SOURCE_SIZE_MISMATCH')
        chunks.push(bytes)
      }
    }
    finally {
      stored.stream.destroy()
    }
    if (size !== expectedBytes) throw new Error('SLH_BILL_SOURCE_SIZE_MISMATCH')
    return Buffer.concat(chunks)
  }

  private async applyBill(plan: SlhBillAmountPlan): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      await transaction.$executeRaw(DISABLE_IMMUTABLE_TRIGGER)
      try {
        for (const update of plan.updates) {
          const data = Object.fromEntries(update.columns.map(column => [column, null]))
          await transaction.slhBillLine.update({ data, where: { id: update.lineId } })
        }
      }
      finally {
        await transaction.$executeRaw(ENABLE_IMMUTABLE_TRIGGER)
      }
    }, { timeout: 60_000 })
  }

  /** 回滚文件写在仓库外的备份目录：只含行 ID、行号与六列原值，不含任何客户信息。 */
  private async writeRollbackFile(planned: readonly { readonly billNo: string, readonly plan: SlhBillAmountPlan }[]): Promise<string> {
    const bills: RollbackBill[] = planned.map(item => ({
      billNo: item.billNo,
      lines: item.plan.updates.map(update => ({ id: update.lineId, lineNumber: update.lineNumber, values: update.previous })),
    }))
    const directory = join(homedir(), 'qianshu-db-backups')
    await mkdir(directory, { mode: 0o700, recursive: true })
    const path = join(directory, `slh-bill-amount-backfill-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`)
    await writeFile(path, JSON.stringify({ bills, createdAt: new Date().toISOString(), kind: 'slh_bill_amount_backfill_rollback' }, null, 2), { encoding: 'utf8', mode: 0o600 })
    return path
  }
}
