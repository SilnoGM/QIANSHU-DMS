/**
 * 收货人信息回填：把已入库明细的 `recipient_info_raw` 解析结果写进三个结构化列。
 *
 * 约束（按规则确认稿）：
 * - **不修改** `recipient_info_raw` 与 `source_data`：原文是回填的真相源，也是回滚依据；
 * - **幂等**：只处理"原文非空且三个结构化列都为空"的行，重复执行不会覆盖人工修正过的值；
 * - 默认 dry-run，只有显式 `--apply` 才写库；解析不出就保持为空（不猜、不阻断）。
 */
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/database/prisma.service'
import { parseSlhBillRecipient } from './slh-bill-recipient-parser'

export interface SlhBillRecipientBackfillOptions {
  /** 是否真正写库；缺省为 dry-run。 */
  readonly apply?: boolean
  /** 单次处理上限，避免一次拉全表。 */
  readonly limit?: number
}

export interface SlhBillRecipientBackfillResult {
  readonly mode: 'APPLY' | 'DRY_RUN'
  readonly selected: number
  readonly updated: number
  readonly addressOnly: number
  readonly withPhones: number
  readonly namedWithoutPhone: number
  readonly remaining: number
}

const DEFAULT_LIMIT = 1000

@Injectable()
export class SlhBillRecipientBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async run(options: SlhBillRecipientBackfillOptions = {}): Promise<SlhBillRecipientBackfillResult> {
    const limit = options.limit ?? DEFAULT_LIMIT
    const where = {
      AND: [
        { recipientInfoRaw: { not: null } },
        { recipientName: null },
        { recipientPhones: null },
        { recipientAddress: null },
      ],
    }
    const [rows, remaining] = await Promise.all([
      this.prisma.slhBillLine.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, recipientInfoRaw: true },
        take: limit,
        where,
      }),
      this.prisma.slhBillLine.count({ where }),
    ])

    const result = {
      addressOnly: 0,
      mode: options.apply === true ? 'APPLY' as const : 'DRY_RUN' as const,
      namedWithoutPhone: 0,
      remaining,
      selected: rows.length,
      updated: 0,
      withPhones: 0,
    }
    const candidates = rows.flatMap((row) => {
      const parsed = parseSlhBillRecipient(row.recipientInfoRaw)
      if (parsed.recipientAddress === null && parsed.recipientName === null && parsed.recipientPhones === null) {
        return []
      }
      return [{ id: row.id, parsed }]
    })

    for (const candidate of candidates) {
      if (candidate.parsed.recipientPhones === null) {
        if (candidate.parsed.recipientName === null) {
          result.addressOnly += 1
        }
        else {
          result.namedWithoutPhone += 1
        }
      }
      else {
        result.withPhones += 1
      }
    }

    if (options.apply !== true) {
      return result
    }

    for (const candidate of candidates) {
      await this.prisma.slhBillLine.update({
        data: {
          recipientAddress: candidate.parsed.recipientAddress,
          recipientName: candidate.parsed.recipientName,
          recipientPhones: candidate.parsed.recipientPhones,
        },
        where: { id: candidate.id },
      })
      result.updated += 1
    }
    return result
  }
}
