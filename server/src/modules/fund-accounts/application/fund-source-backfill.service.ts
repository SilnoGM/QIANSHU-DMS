import { Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { FUND_SOURCE_CURRENT_RESOLVER_VERSION } from './fund-source-snapshot'

export interface FundSourceBackfillOptions {
  /** false 时只统计将要处理的行数，不写库。 */
  readonly apply: boolean
  /** 已解析的行是否也要按当前规则重算。 */
  readonly force: boolean
}

export interface FundSourceBackfillKindResult {
  readonly kind: string
  readonly rows: number
}

export interface FundSourceBackfillResult {
  readonly applied: boolean
  readonly kinds: readonly FundSourceBackfillKindResult[]
  /** 只补 subject_name / action_label 的行数，不重写 headline。 */
  readonly labels: readonly FundSourceBackfillKindResult[]
  readonly unresolved: readonly FundSourceBackfillKindResult[]
  readonly skipped: number
}

/**
 * 历史流水来源回填。
 *
 * 只写派生投影 `fund_posting_batch_sources`，全程不修改 `fund_posting_batches` 与
 * `fund_ledger_entries`，因此不会触碰它们的不可变触发器。每条语句都是
 * INSERT ... SELECT ... ON CONFLICT DO UPDATE，可重复执行。
 *
 * 跨域读取只存在于这个运维命令里；运行时资金域不反查业务域。
 */
@Injectable()
export class FundSourceBackfillService {
  constructor(private readonly prisma: PrismaService) {}

  async run(options: FundSourceBackfillOptions): Promise<FundSourceBackfillResult> {
    return this.prisma.$transaction(async (transaction) => {
      // 回填是长任务，事务级 timeout 单独放宽；业务请求仍用固定 5s 边界。
      await transaction.$queryRaw(Prisma.sql`
        SELECT
          set_config('lock_timeout', '5s', true),
          set_config('statement_timeout', '120s', true)
      `)
      const kinds: FundSourceBackfillKindResult[] = []
      for (const statement of BACKFILL_STATEMENTS) {
        kinds.push({
          kind: statement.kind,
          rows: options.apply
            ? await transaction.$executeRaw(statement.build(options.force))
            : await countRows(transaction, statement.select(options.force)),
        })
      }
      const labels: FundSourceBackfillKindResult[] = []
      for (const statement of LABEL_BACKFILL_STATEMENTS) {
        labels.push({
          kind: statement.kind,
          rows: options.apply
            ? await transaction.$executeRaw(statement.update)
            : await countRows(transaction, statement.select),
        })
      }
      const unresolved = await countUnresolved(transaction)
      const skipped = await countWeakRows(transaction)
      return Object.freeze({
        applied: options.apply,
        kinds: Object.freeze(kinds),
        labels: Object.freeze(labels),
        unresolved: Object.freeze(unresolved),
        skipped,
      })
    })
  }
}

async function countRows(
  transaction: Prisma.TransactionClient,
  query: Prisma.Sql,
): Promise<number> {
  const rows = await transaction.$queryRaw<Array<{ readonly total: unknown }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS "total" FROM (${query}) AS candidate`,
  )
  const total = rows[0]?.total
  return typeof total === 'bigint' ? Number(total) : 0
}

async function countUnresolved(
  transaction: Prisma.TransactionClient,
): Promise<readonly FundSourceBackfillKindResult[]> {
  const rows = await transaction.$queryRaw<
    Array<{ readonly kind: unknown, readonly total: unknown }>
  >(Prisma.sql`
    SELECT "source_kind"::text AS "kind", COUNT(*)::bigint AS "total"
    FROM "fund_posting_batch_sources"
    WHERE "source_kind" = 'UNRESOLVED'::"fund_posting_source_kind"
    GROUP BY "source_kind"
  `)
  return rows.map(row => Object.freeze({
    kind: typeof row.kind === 'string' ? row.kind : 'UNKNOWN',
    rows: typeof row.total === 'bigint' ? Number(row.total) : 0,
  }))
}

/** 只有摘要的降级投影；回填后应趋近于 0。 */
async function countWeakRows(
  transaction: Prisma.TransactionClient,
): Promise<number> {
  const rows = await transaction.$queryRaw<Array<{ readonly total: unknown }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "total"
    FROM "fund_posting_batch_sources"
    WHERE "resolver_version" < ${FUND_SOURCE_CURRENT_RESOLVER_VERSION}
  `)
  const total = rows[0]?.total
  return typeof total === 'bigint' ? Number(total) : 0
}

interface BackfillStatement {
  readonly kind: string
  /** 预览与写入共用同一条 SELECT，保证 dry-run 计数与实际写入一致。 */
  readonly select: (force: boolean) => Prisma.Sql
  readonly build: (force: boolean) => Prisma.Sql
}

const TARGET_COLUMNS = Prisma.sql`
  "batch_id",
  "source_kind",
  "headline",
  "customer_name",
  "supplier_name",
  "document_no",
  "link_kind",
  "link_id",
  "detail",
  "resolver_version"
`

const ON_CONFLICT = Prisma.sql`
  ON CONFLICT ("batch_id") DO UPDATE SET
    "source_kind" = EXCLUDED."source_kind",
    "headline" = EXCLUDED."headline",
    "customer_name" = EXCLUDED."customer_name",
    "supplier_name" = EXCLUDED."supplier_name",
    "document_no" = EXCLUDED."document_no",
    "link_kind" = EXCLUDED."link_kind",
    "link_id" = EXCLUDED."link_id",
    "detail" = EXCLUDED."detail",
    "resolver_version" = EXCLUDED."resolver_version",
    "resolved_at" = CURRENT_TIMESTAMP
`

/**
 * 只处理“还没有解析内容”的批次；force 时连已解析行一起重算。
 * 所有回填语句都把批次表固定别名为 batch，这里不拼接任何外部文本，
 * 只有 force 作为参数占位符进入 SQL。
 */
function needsBackfill(force: boolean): Prisma.Sql {
  return Prisma.sql`
    (${force} OR NOT EXISTS (
      SELECT 1 FROM "fund_posting_batch_sources" AS existing
      WHERE existing."batch_id" = batch."id"
        AND existing."resolver_version" >= ${FUND_SOURCE_CURRENT_RESOLVER_VERSION}
    ))
  `
}

function statement(
  kind: string,
  select: (force: boolean) => Prisma.Sql,
): BackfillStatement {
  return {
    kind,
    select,
    build: force => Prisma.sql`INSERT INTO "fund_posting_batch_sources" (${TARGET_COLUMNS}) ${select(force)} ${ON_CONFLICT}`,
  }
}

const BACKFILL_STATEMENTS: readonly BackfillStatement[] = Object.freeze([
  // 销售收款：批次 ← 收款记录 → 销售单。
  statement('SALES_RECEIPT', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'SALES_RECEIPT'::"fund_posting_source_kind" AS "source_kind",
      order_row."customer_name" || ' · 销售'
        || CASE payment."payment_type" WHEN 'DEPOSIT' THEN '定金' ELSE '尾款' END || '收款' AS "headline",
      order_row."customer_name" AS "customer_name",
      NULL::varchar AS "supplier_name",
      order_row."order_no" AS "document_no",
      'SALES_ORDER' AS "link_kind",
      order_row."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '收款类型', 'value',
          CASE payment."payment_type" WHEN 'DEPOSIT' THEN '定金' ELSE '尾款' END),
        jsonb_build_object('label', '收款方式', 'value', payment."payment_method")
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "sales_order_payments" AS payment ON payment."fund_posting_batch_id" = batch."id"
    JOIN "sales_orders" AS order_row ON order_row."id" = payment."sales_order_id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'SALES_RECEIPT'
      AND ${needsBackfill(force)}
  `),

  // 采购付款：批次 ← 付款记录 → 采购单；供应商名优先自定义名称，其次字典标签。
  statement('PURCHASE_PAYMENT', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'PURCHASE_PAYMENT'::"fund_posting_source_kind" AS "source_kind",
      COALESCE(order_row."custom_supplier_name", supplier_item."label", '未命名供应商') || ' · 采购'
        || CASE payment."payment_type" WHEN 'DEPOSIT' THEN '定金' ELSE '尾款' END || '付款' AS "headline",
      NULL::varchar AS "customer_name",
      COALESCE(order_row."custom_supplier_name", supplier_item."label") AS "supplier_name",
      order_row."order_no" AS "document_no",
      'PURCHASE_ORDER' AS "link_kind",
      order_row."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '付款阶段', 'value',
          CASE payment."payment_type" WHEN 'DEPOSIT' THEN '定金' ELSE '尾款' END)
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "purchase_order_payments" AS payment ON payment."fund_posting_batch_id" = batch."id"
    JOIN "purchase_orders" AS order_row ON order_row."id" = payment."purchase_order_id"
    LEFT JOIN "dictionary_items" AS supplier_item
      ON supplier_item."value" = order_row."supplier_value"
      AND supplier_item."dictionary_type_id" = (
        SELECT "id" FROM "dictionary_types" WHERE "code" = 'service_provider.supplier'
      )
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'PURCHASE_PAYMENT'
      AND ${needsBackfill(force)}
  `),

  // 打木架：business_id 就是打木架提报 id，提报行自带单号与唛头。
  statement('PACKAGING_COST', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'PACKAGING_COST'::"fund_posting_source_kind" AS "source_kind",
      request."shipment_no" || ' · 打木架费用' AS "headline",
      order_row."customer_name" AS "customer_name",
      NULL::varchar AS "supplier_name",
      request."shipment_no" AS "document_no",
      'PACKAGING_COST' AS "link_kind",
      request."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '包装类型', 'value', request."packaging_type_name"),
        jsonb_build_object('label', '销售单', 'value', request."sales_order_no"),
        jsonb_build_object('label', '采购单', 'value', request."purchase_order_no")
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "packaging_cost_requests" AS request
      ON request."id"::text = batch."business_id"
    LEFT JOIN "sales_orders" AS order_row ON order_row."id" = request."sales_order_id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'PACKAGING_COST'
      AND ${needsBackfill(force)}
  `),

  // 开票：批次 ← 开票申请（有 fund_posting_batch_id 外键）。
  statement('INVOICE_REQUEST', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'INVOICE_REQUEST'::"fund_posting_source_kind" AS "source_kind",
      request."buyer_name" || ' · 开票服务费及邮寄费' AS "headline",
      request."buyer_name" AS "customer_name",
      NULL::varchar AS "supplier_name",
      request."invoice_no" AS "document_no",
      'INVOICE_REQUEST' AS "link_kind",
      request."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '发票金额', 'value', request."total_amount"::text)
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "invoice_requests" AS request ON request."fund_posting_batch_id" = batch."id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'INVOICE_REQUEST'
      AND ${needsBackfill(force)}
  `),

  // 寄仓成本：business_id 是寄仓记录 id，记录上冻结了来源客户与单号。
  statement('SHIPMENT_STORAGE', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'SHIPMENT_STORAGE'::"fund_posting_source_kind" AS "source_kind",
      COALESCE(record."shipment_no_snapshot", '寄仓记录') || ' · '
        || CASE batch."posting_type_code_snapshot"
             -- 与写入文案保持一致：退还在原客户侧，转入在调入销售单客户侧。
             WHEN 'SHIPMENT_STORAGE_RELEASE' THEN '寄仓货物成本退还'
             ELSE '调寄仓货物成本转入' END AS "headline",
      -- 退还主体是原客户；转入主体是认领后的销售单客户，记录未被认领时才回退原客户。
      CASE batch."posting_type_code_snapshot"
        WHEN 'SHIPMENT_STORAGE_RELEASE' THEN record."origin_customer_name_snapshot"
        ELSE COALESCE(claimed_order."customer_name", record."origin_customer_name_snapshot")
      END AS "customer_name",
      NULL::varchar AS "supplier_name",
      record."shipment_no_snapshot" AS "document_no",
      'SHIPMENT_STORAGE' AS "link_kind",
      record."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '原销售单', 'value', record."origin_sales_order_no_snapshot")
      )
      || CASE
           WHEN batch."posting_type_code_snapshot" <> 'SHIPMENT_STORAGE_RELEASE'
             AND claimed_order."order_no" IS NOT NULL
           THEN jsonb_build_array(
             jsonb_build_object('label', '调入销售单', 'value', claimed_order."order_no")
           )
           ELSE '[]'::jsonb
         END
      || jsonb_build_array(
        jsonb_build_object('label', '原采购单', 'value', record."origin_purchase_order_no_snapshot")
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "shipment_storage_records" AS record ON record."id"::text = batch."business_id"
    LEFT JOIN "sales_orders" AS claimed_order ON claimed_order."id" = record."claimed_sales_order_id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'SHIPMENT_STORAGE'
      AND ${needsBackfill(force)}
  `),

  // 顺联航：结算 id 可能来自 business_id（结算）或 metadata.settlementId（金流费）。
  statement('SLH', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      CASE
        WHEN batch."posting_type_code_snapshot" = 'FULL_FLOW_PAYMENT_FEE' THEN 'SLH_FEE'
        WHEN batch."posting_type_code_snapshot" LIKE 'SLH_BILL_COMPANY%' THEN 'SLH_COMPANY_ALLOCATION'
        ELSE 'SLH_SETTLEMENT'
      END::"fund_posting_source_kind" AS "source_kind",
      CASE
        WHEN batch."posting_type_code_snapshot" = 'FULL_FLOW_PAYMENT_FEE' THEN '顺联航账单全流程金流费用'
        WHEN batch."posting_type_code_snapshot" LIKE 'SLH_BILL_COMPANY%' THEN '顺联航账单公司分摊'
        ELSE '顺联航账单对账结算'
      END || ' · ' || settlement."slh_bill_no" AS "headline",
      order_row."customer_name" AS "customer_name",
      NULL::varchar AS "supplier_name",
      settlement."slh_bill_no" AS "document_no",
      'SLH_RECONCILIATION' AS "link_kind",
      -- 新批次把对账批次 id 写进 metadata；旧批次只能回落到结算行上的 batch_id。
      COALESCE(
        batch."metadata" ->> 'slhReconciliationBatchId',
        settlement."batch_id"::text
      ) AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '柜次', 'value', settlement."container_batch_no"),
        jsonb_build_object('label', '销售单', 'value', settlement."sales_order_no"),
        jsonb_build_object('label', '采购单', 'value', settlement."purchase_order_no")
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "slh_reconciliation_settlements" AS settlement
      ON settlement."id"::text = batch."business_id"
      -- 历史批次两种元数据键都用过：旧版 settlementId、新版 slhReconciliationSettlementId。
      OR settlement."id"::text = COALESCE(
        batch."metadata" ->> 'settlementId',
        batch."metadata" ->> 'slhReconciliationSettlementId'
      )
    LEFT JOIN "sales_orders" AS order_row ON order_row."id" = settlement."sales_order_id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" LIKE 'SLH_BILL%'
      AND ${needsBackfill(force)}
  `),

  // 提款：批次 ← 提款申请（有外键）。
  statement('WITHDRAWAL', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'WITHDRAWAL'::"fund_posting_source_kind" AS "source_kind",
      request."withdrawal_no" || ' · 用户提款' AS "headline",
      NULL::varchar AS "customer_name",
      NULL::varchar AS "supplier_name",
      request."withdrawal_no" AS "document_no",
      'FUND_WITHDRAWAL' AS "link_kind",
      request."id"::text AS "link_id",
      jsonb_build_array(
        jsonb_build_object('label', '提款金额', 'value', request."amount"::text)
      ) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "fund_withdrawal_requests" AS request ON request."fund_posting_batch_id" = batch."id"
    WHERE batch."kind" = 'BUSINESS'::"fund_posting_batch_kind"
      AND batch."business_source_code_snapshot" = 'FUND_WITHDRAWAL'
      AND ${needsBackfill(force)}
  `),

  // 管理员调账：原因就是唯一的说明。
  statement('MANUAL_ADJUSTMENT', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'MANUAL_ADJUSTMENT'::"fund_posting_source_kind" AS "source_kind",
      left(batch."summary", 200) AS "headline",
      NULL::varchar AS "customer_name",
      NULL::varchar AS "supplier_name",
      NULL::varchar AS "document_no",
      NULL::varchar AS "link_kind",
      NULL::varchar AS "link_id",
      '[]'::jsonb AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    WHERE batch."kind" = 'MANUAL_ADJUSTMENT'::"fund_posting_batch_kind"
      AND ${needsBackfill(force)}
  `),

  // 冲账：复制原批次投影，标题改为冲正口径。
  statement('REVERSAL', force => Prisma.sql`
    SELECT
      batch."id" AS "batch_id",
      'REVERSAL'::"fund_posting_source_kind" AS "source_kind",
      left('冲正 ' || COALESCE(original_source."headline", original."summary"), 200) AS "headline",
      original_source."customer_name" AS "customer_name",
      original_source."supplier_name" AS "supplier_name",
      original_source."document_no" AS "document_no",
      original_source."link_kind" AS "link_kind",
      original_source."link_id" AS "link_id",
      COALESCE(original_source."detail", '[]'::jsonb) AS "detail",
      2 AS "resolver_version"
    FROM "fund_posting_batches" AS batch
    JOIN "fund_posting_batches" AS original ON original."id" = batch."reversal_of_batch_id"
    LEFT JOIN "fund_posting_batch_sources" AS original_source
      ON original_source."batch_id" = original."id"
    WHERE batch."kind" = 'REVERSAL'::"fund_posting_batch_kind"
      AND ${needsBackfill(force)}
  `),
])

interface LabelStatement {
  readonly kind: string
  readonly select: Prisma.Sql
  readonly update: Prisma.Sql
}

/**
 * 只补 subject_name / action_label，不重写 headline。
 *
 * 拆解的是**已存在**的 headline，所以历史文案原样保留（例如认领行仍是
 * 「调货成本转入」），不会因为当前代码里的新叫法把旧流水刷成新名。
 * 条件只挑两列都为空的投影行，重复执行不会覆盖后续写入的内容。
 */
function labelStatement(
  kind: string,
  condition: Prisma.Sql,
  subject: Prisma.Sql,
  action: Prisma.Sql,
): LabelStatement {
  return {
    kind,
    select: Prisma.sql`
      SELECT s."batch_id"
      FROM "fund_posting_batch_sources" AS s
      WHERE ${condition}
    `,
    update: Prisma.sql`
      UPDATE "fund_posting_batch_sources" AS s
      SET "subject_name" = ${subject}, "action_label" = ${action}
      WHERE ${condition}
    `,
  }
}

const LABEL_PENDING = Prisma.sql`
  s."subject_name" IS NULL AND s."action_label" IS NULL
`

const LABEL_BACKFILL_STATEMENTS: readonly LabelStatement[] = Object.freeze([
  // 「主体 · 动作」：headline 本身就是这个形状。
  labelStatement(
    'SUBJECT_ACTION',
    Prisma.sql`
      ${LABEL_PENDING}
      AND s."source_kind" IN (
        'SALES_RECEIPT'::"fund_posting_source_kind",
        'PURCHASE_PAYMENT'::"fund_posting_source_kind",
        'PACKAGING_COST'::"fund_posting_source_kind",
        'INVOICE_REQUEST'::"fund_posting_source_kind"
      )
      AND position(' · ' in s."headline") > 0
    `,
    Prisma.sql`NULLIF(trim(split_part(s."headline", ' · ', 1)), '')`,
    Prisma.sql`NULLIF(trim(substr(s."headline", position(' · ' in s."headline") + 3)), '')`,
  ),
  // 「单号 · 动作」：主体只能取寄仓记录上的客户，提款没有客户。
  labelStatement(
    'DOCUMENT_ACTION',
    Prisma.sql`
      ${LABEL_PENDING}
      AND s."source_kind" IN (
        'SHIPMENT_STORAGE'::"fund_posting_source_kind",
        'WITHDRAWAL'::"fund_posting_source_kind"
      )
      AND position(' · ' in s."headline") > 0
    `,
    Prisma.sql`s."customer_name"`,
    Prisma.sql`NULLIF(trim(substr(s."headline", position(' · ' in s."headline") + 3)), '')`,
  ),
  // 「动作 · 账单号」：顺联航的 headline 是动作在前，主体取客户。
  labelStatement(
    'ACTION_DOCUMENT',
    Prisma.sql`
      ${LABEL_PENDING}
      AND s."source_kind" IN (
        'SLH_SETTLEMENT'::"fund_posting_source_kind",
        'SLH_FEE'::"fund_posting_source_kind",
        'SLH_COMPANY_ALLOCATION'::"fund_posting_source_kind"
      )
      AND position(' · ' in s."headline") > 0
    `,
    Prisma.sql`s."customer_name"`,
    Prisma.sql`NULLIF(trim(split_part(s."headline", ' · ', 1)), '')`,
  ),
  // 调账、冲账与未识别来源：整句就是动作，主体留空由前端回退。
  labelStatement(
    'WHOLE_HEADLINE',
    Prisma.sql`
      ${LABEL_PENDING}
      AND s."source_kind" IN (
        'MANUAL_ADJUSTMENT'::"fund_posting_source_kind",
        'REVERSAL'::"fund_posting_source_kind",
        'UNRESOLVED'::"fund_posting_source_kind"
      )
    `,
    Prisma.sql`NULL::varchar`,
    Prisma.sql`left(s."headline", 120)`,
  ),
])
