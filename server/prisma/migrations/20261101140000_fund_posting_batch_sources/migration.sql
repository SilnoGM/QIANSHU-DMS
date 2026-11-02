BEGIN;

-- 资金来源快照投影：与资金批次 1:1，只服务流水列表/详情的展示与检索。
-- 本迁移只新增派生表，不改动 fund_posting_batches / fund_ledger_entries 任何列，
-- 也不触碰它们的不可变触发器；历史批次由独立命令 fund-batches:backfill-sources 回填。
-- 读取层在缺少投影行时回退到批次自身的 summary/business_no，因此回填失败不会让流水空白。

-- CreateEnum
CREATE TYPE "fund_posting_source_kind" AS ENUM (
  'SALES_RECEIPT',
  'PURCHASE_PAYMENT',
  'PACKAGING_COST',
  'INVOICE_REQUEST',
  'SHIPMENT_STORAGE',
  'SLH_SETTLEMENT',
  'SLH_FEE',
  'SLH_COMPANY_ALLOCATION',
  'WITHDRAWAL',
  'MANUAL_ADJUSTMENT',
  'REVERSAL',
  'UNRESOLVED'
);

-- CreateTable
CREATE TABLE "fund_posting_batch_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "source_kind" "fund_posting_source_kind" NOT NULL,
  "headline" VARCHAR(200) NOT NULL,
  "customer_name" VARCHAR(128),
  "supplier_name" VARCHAR(128),
  "document_no" VARCHAR(128),
  "link_kind" VARCHAR(32),
  "link_id" VARCHAR(128),
  "detail" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "resolver_version" SMALLINT NOT NULL DEFAULT 1,
  "resolved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fund_posting_batch_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fund_posting_batch_sources_headline_nonblank_check"
    CHECK ("headline" !~ '^[[:space:]]*$'),
  CONSTRAINT "fund_posting_batch_sources_customer_name_nonblank_check"
    CHECK ("customer_name" IS NULL OR "customer_name" !~ '^[[:space:]]*$'),
  CONSTRAINT "fund_posting_batch_sources_supplier_name_nonblank_check"
    CHECK ("supplier_name" IS NULL OR "supplier_name" !~ '^[[:space:]]*$'),
  CONSTRAINT "fund_posting_batch_sources_document_no_nonblank_check"
    CHECK ("document_no" IS NULL OR "document_no" !~ '^[[:space:]]*$'),
  -- 跳转目标要么完整（类型 + 单据 id），要么整体缺失；只有一半会让前端无法判断。
  CONSTRAINT "fund_posting_batch_sources_link_shape_check"
    CHECK (
      ("link_kind" IS NULL AND "link_id" IS NULL)
      OR (
        "link_kind" IN (
          'SALES_ORDER',
          'PURCHASE_ORDER',
          'SALES_RECEIPT',
          'INVOICE_REQUEST',
          'SLH_RECONCILIATION',
          'PACKAGING_COST',
          'SHIPMENT_STORAGE',
          'FUND_WITHDRAWAL'
        )
        AND "link_id" ~ '^[A-Za-z0-9._:-]{1,128}$'
      )
    ),
  CONSTRAINT "fund_posting_batch_sources_detail_array_check"
    CHECK (jsonb_typeof("detail") = 'array'),
  CONSTRAINT "fund_posting_batch_sources_resolver_version_check"
    CHECK ("resolver_version" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_posting_batch_sources_batch_key"
  ON "fund_posting_batch_sources" ("batch_id");

CREATE INDEX "fund_posting_batch_sources_kind_resolved_batch_idx"
  ON "fund_posting_batch_sources" ("source_kind", "resolved_at" DESC, "batch_id");

-- AddForeignKey
ALTER TABLE "fund_posting_batch_sources"
  ADD CONSTRAINT "fund_posting_batch_sources_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "fund_posting_batches"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- MigrationSelfCheck
-- 迁移在提交前证明新表成型，且原资金事实的不可变边界未被削弱。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "information_schema"."tables"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'fund_posting_batch_sources'
  ) THEN
    RAISE EXCEPTION 'fund_posting_batch_sources table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_type" AS type
    JOIN "pg_namespace" AS namespace ON namespace."oid" = type."typnamespace"
    WHERE namespace."nspname" = current_schema()
      AND type."typname" = 'fund_posting_source_kind'
  ) THEN
    RAISE EXCEPTION 'fund_posting_source_kind enum is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_index" AS index
    JOIN "pg_class" AS relation ON relation."oid" = index."indexrelid"
    WHERE relation."relname" = 'fund_posting_batch_sources_batch_key'
      AND index."indisunique"
  ) THEN
    RAISE EXCEPTION 'fund_posting_batch_sources batch uniqueness is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "pg_trigger"
    WHERE "tgname" = 'fund_posting_batches_immutable_trigger'
      AND NOT "tgisinternal"
  ) THEN
    RAISE EXCEPTION 'fund posting batch immutability trigger is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "information_schema"."columns"
    WHERE "table_schema" = current_schema()
      AND "table_name" = 'fund_posting_batches'
      AND "column_name" IN ('customer_name', 'supplier_name', 'headline')
  ) THEN
    RAISE EXCEPTION 'fund posting batch facts must stay free of derived display columns';
  END IF;
END;
$$;

COMMIT;
