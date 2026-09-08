import { Prisma } from '../../generated/prisma/client'
import type { ShippingMarkBindingQueryDto, ShippingMarkRuleSummaryDto, ShippingMarkAvailability } from './shipping-mark-binding.dto'

export const SHIPPING_MARK_RULE_SELECT = {
  id: true, ruleCode: true, name: true, purpose: true, status: true,
  versions: { where: { status: 'ACTIVE' }, select: { revision: true }, take: 1 },
} as const satisfies Prisma.NumberingRuleSelect

export function summarizeRule(rule: Prisma.NumberingRuleGetPayload<{ select: typeof SHIPPING_MARK_RULE_SELECT }> | null): ShippingMarkRuleSummaryDto | null {
  if (rule === null) return null
  return { id: rule.id, ruleCode: rule.ruleCode, name: rule.name, purpose: rule.purpose, status: rule.status, activeRevision: rule.versions[0]?.revision ?? null }
}

/** 可用仅指用途、启用与版本；此处不预览、不预留容量、更不调用派发器。 */
export function ruleAvailability(rule: ShippingMarkRuleSummaryDto | null): ShippingMarkAvailability {
  if (!rule) return 'RULE_MISSING'
  if (rule.purpose !== 'SHIPPING_MARK') return 'WRONG_PURPOSE'
  if (rule.status !== 'ENABLED') return 'RULE_DISABLED'
  if (rule.activeRevision === null) return 'NO_ACTIVE_VERSION'
  return 'AVAILABLE'
}

interface BindingRow {
  supplierValue: string
  supplierLabel: string
  supplierEnabled: boolean
  version: number
  updatedAt: Date | null
  rule: ShippingMarkRuleSummaryDto | null
}

export async function readBindingPage(transaction: Prisma.TransactionClient, query: ShippingMarkBindingQueryDto) {
  const keyword = query.keyword?.trim()
  const pattern = `%${(keyword ?? '').replace(/[\\%_]/gu, '\\$&')}%`
  // 从字典全集出发，而非从绑定表出发；供应商/规则停用后仍保留原配置可见性。
  const source = Prisma.sql`
    FROM dictionary_items i
    JOIN dictionary_types t ON t.id = i.dictionary_type_id
    LEFT JOIN supplier_shipping_mark_rule_bindings b ON b.supplier_value = i.value
    LEFT JOIN numbering_rules r ON r.id = b.rule_id
    LEFT JOIN numbering_rule_versions v ON v.rule_id = r.id AND v.status = 'ACTIVE'
    WHERE t.code = 'service_provider.supplier'
    ${keyword ? Prisma.sql`AND (i.value ILIKE ${pattern} OR i.label ILIKE ${pattern})` : Prisma.empty}
    ${query.bindingStatus === 'BOUND' ? Prisma.sql`AND b.supplier_value IS NOT NULL` : Prisma.empty}
    ${query.bindingStatus === 'UNBOUND' ? Prisma.sql`AND b.supplier_value IS NULL` : Prisma.empty}
  `
  const counts = await transaction.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total ${source}`)
  const rows = await transaction.$queryRaw<BindingRow[]>(Prisma.sql`
    SELECT i.value AS "supplierValue", i.label AS "supplierLabel",
      (t.enabled AND i.enabled) AS "supplierEnabled",
      COALESCE(b.version, 0) AS version, b.updated_at AS "updatedAt",
      CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', r.id, 'ruleCode', r.rule_code, 'name', r.name,
        'purpose', r.purpose, 'status', r.status, 'activeRevision', v.revision
      ) END AS rule
    ${source}
    ORDER BY i.sort_order, i.value
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `)
  return {
    total: counts[0]?.total ?? 0,
    items: rows.map(row => ({
      ...row,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      availability: !row.supplierEnabled ? 'SUPPLIER_UNAVAILABLE' as const
        : row.version === 0 ? 'UNBOUND' as const : ruleAvailability(row.rule),
    })),
  }
}
