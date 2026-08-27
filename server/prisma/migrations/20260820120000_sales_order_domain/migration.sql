BEGIN;

-- ExtendAuditEventType
-- 新值只由 migration 提交后的运行时使用，避免 PostgreSQL enum 在同一事务内提前引用。
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_ORDER_STATUS_CHANGED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_PAYMENT_TERMS_UPDATED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_PAYMENT_RECORDED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_PAYMENT_VOIDED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_DOCUMENT_ATTACHED';
ALTER TYPE "audit_event_type" ADD VALUE 'SALES_ORDER_DOCUMENT_DETACHED';

-- CreateSalesOrderEnums
CREATE TYPE "sales_order_status" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'CANCELLED'
);
CREATE TYPE "sales_order_fulfillment_status" AS ENUM (
  'PENDING',
  'PREPARING',
  'SHIPPED',
  'SIGNED'
);
CREATE TYPE "sales_order_payment_status" AS ENUM (
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID'
);
CREATE TYPE "sales_order_line_type" AS ENUM ('CATALOG', 'CUSTOM');
CREATE TYPE "sales_order_payment_type" AS ENUM (
  'DEPOSIT',
  'BALANCE',
  'OTHER'
);
CREATE TYPE "sales_order_document_type" AS ENUM (
  'DEPOSIT_VOUCHER',
  'DELIVERY_RECEIPT',
  'OTHER'
);
CREATE TYPE "sales_order_status_dimension" AS ENUM (
  'ORDER',
  'FULFILLMENT',
  'PAYMENT'
);

-- CreateSalesOrders
CREATE TABLE "sales_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_no" VARCHAR(64) NOT NULL,
  "create_idempotency_key_hash" BYTEA NOT NULL,
  "create_request_fingerprint_hash" BYTEA NOT NULL,
  "order_date" DATE NOT NULL,
  "issuer_user_id" UUID NOT NULL,
  "currency_code" VARCHAR(3) NOT NULL,
  "customer_name" VARCHAR(128) NOT NULL,
  "customer_phone" VARCHAR(64) NOT NULL,
  "customer_country_region_id" UUID NOT NULL,
  "customer_province_state_id" UUID NOT NULL,
  "customer_city_id" UUID NOT NULL,
  "customer_country_region_code_snapshot" VARCHAR(64) NOT NULL,
  "customer_province_state_code_snapshot" VARCHAR(64) NOT NULL,
  "customer_city_code_snapshot" VARCHAR(64) NOT NULL,
  "customer_country_region_name_snapshot" VARCHAR(128) NOT NULL,
  "customer_province_state_name_snapshot" VARCHAR(128) NOT NULL,
  "customer_city_name_snapshot" VARCHAR(128) NOT NULL,
  "customer_address_detail" VARCHAR(1000) NOT NULL,
  "customer_full_address_snapshot" VARCHAR(1500) NOT NULL,
  "line_subtotal_amount" NUMERIC(30, 4) NOT NULL,
  "agreed_total_amount" NUMERIC(30, 4) NOT NULL,
  "deposit_due_amount" NUMERIC(30, 4) NOT NULL,
  "balance_due_amount" NUMERIC(30, 4) NOT NULL,
  "order_status" "sales_order_status" NOT NULL DEFAULT 'DRAFT',
  "fulfillment_status" "sales_order_fulfillment_status" NOT NULL DEFAULT 'PENDING',
  "payment_status" "sales_order_payment_status" NOT NULL DEFAULT 'UNPAID',
  "remark" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_orders_create_hash_lengths_check"
    CHECK (
      octet_length("create_idempotency_key_hash") = 32
      AND octet_length("create_request_fingerprint_hash") = 32
    ),
  CONSTRAINT "sales_orders_currency_check"
    CHECK ("currency_code" IN ('TWD', 'MYR')),
  CONSTRAINT "sales_orders_customer_nonblank_check"
    CHECK (
      "customer_name" !~ '^[[:space:]]*$'
      AND "customer_phone" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "sales_orders_region_snapshot_nonblank_check"
    CHECK (
      "customer_country_region_code_snapshot" !~ '^[[:space:]]*$'
      AND "customer_province_state_code_snapshot" !~ '^[[:space:]]*$'
      AND "customer_city_code_snapshot" !~ '^[[:space:]]*$'
      AND "customer_country_region_name_snapshot" !~ '^[[:space:]]*$'
      AND "customer_province_state_name_snapshot" !~ '^[[:space:]]*$'
      AND "customer_city_name_snapshot" !~ '^[[:space:]]*$'
    ),
  CONSTRAINT "sales_orders_address_no_whitespace_check"
    CHECK (
      "customer_address_detail" !~ '^[[:space:]]*$'
      AND "customer_full_address_snapshot" !~ '^[[:space:]]*$'
      AND "customer_address_detail" !~ '[[:space:]]'
      AND "customer_full_address_snapshot" !~ '[[:space:]]'
      AND "customer_address_detail"
        !~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]'
      AND "customer_full_address_snapshot"
        !~ U&'[\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]'
    ),
  CONSTRAINT "sales_orders_amounts_nonnegative_check"
    CHECK (
      "line_subtotal_amount" >= 0
      AND "agreed_total_amount" >= 0
      AND "deposit_due_amount" >= 0
      AND "balance_due_amount" >= 0
    ),
  CONSTRAINT "sales_orders_amount_scales_check"
    CHECK (
      scale("line_subtotal_amount") <= 4
      AND scale("agreed_total_amount") <= 4
      AND scale("deposit_due_amount") <= 4
      AND scale("balance_due_amount") <= 4
    ),
  CONSTRAINT "sales_orders_agreed_total_matches_lines_check"
    CHECK ("agreed_total_amount" = "line_subtotal_amount"),
  CONSTRAINT "sales_orders_payment_terms_sum_check"
    CHECK (
      "agreed_total_amount" = "deposit_due_amount" + "balance_due_amount"
    ),
  CONSTRAINT "sales_orders_remark_nonblank_check"
    CHECK ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$'),
  CONSTRAINT "sales_orders_version_positive_check"
    CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "sales_orders_order_no_key"
  ON "sales_orders" ("order_no");
CREATE UNIQUE INDEX "sales_orders_create_idempotency_key_hash_key"
  ON "sales_orders" ("create_idempotency_key_hash");
CREATE INDEX "sales_orders_order_date_id_idx"
  ON "sales_orders" ("order_date" DESC, "id" DESC);
CREATE INDEX "sales_orders_statuses_order_date_id_idx"
  ON "sales_orders" (
    "order_status",
    "fulfillment_status",
    "payment_status",
    "order_date" DESC,
    "id" DESC
  );
CREATE INDEX "sales_orders_currency_country_date_idx"
  ON "sales_orders" (
    "currency_code",
    "order_status",
    "customer_country_region_id",
    "order_date" DESC,
    "id" DESC
  );
CREATE INDEX "sales_orders_currency_province_date_idx"
  ON "sales_orders" (
    "currency_code",
    "order_status",
    "customer_province_state_id",
    "order_date" DESC,
    "id" DESC
  );
CREATE INDEX "sales_orders_currency_city_date_idx"
  ON "sales_orders" (
    "currency_code",
    "order_status",
    "customer_city_id",
    "order_date" DESC,
    "id" DESC
  );
CREATE INDEX "sales_orders_issuer_order_date_id_idx"
  ON "sales_orders" ("issuer_user_id", "order_date" DESC, "id" DESC);

-- CreateSalesOrderLines
CREATE TABLE "sales_order_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "line_number" SMALLINT NOT NULL,
  "line_type" "sales_order_line_type" NOT NULL,
  "product_id" UUID,
  "product_no_snapshot" VARCHAR(64),
  "product_name_snapshot" VARCHAR(128) NOT NULL,
  "product_attributes_snapshot" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "description_snapshot" VARCHAR(1000),
  "standard_unit_price_amount" NUMERIC(30, 4),
  "actual_unit_price_amount" NUMERIC(30, 4) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "line_total_amount" NUMERIC(30, 4) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_lines_line_number_positive_check"
    CHECK ("line_number" >= 1),
  CONSTRAINT "sales_order_lines_quantity_positive_check"
    CHECK ("quantity" >= 1),
  CONSTRAINT "sales_order_lines_name_nonblank_check"
    CHECK ("product_name_snapshot" !~ '^[[:space:]]*$'),
  CONSTRAINT "sales_order_lines_optional_text_nonblank_check"
    CHECK (
      ("product_no_snapshot" IS NULL OR "product_no_snapshot" !~ '^[[:space:]]*$')
      AND (
        "description_snapshot" IS NULL
        OR "description_snapshot" !~ '^[[:space:]]*$'
      )
    ),
  CONSTRAINT "sales_order_lines_attributes_array_check"
    CHECK (jsonb_typeof("product_attributes_snapshot") = 'array'),
  CONSTRAINT "sales_order_lines_type_shape_check"
    CHECK (
      (
        "line_type" = 'CATALOG'
        AND "product_id" IS NOT NULL
        AND "product_no_snapshot" IS NOT NULL
        AND "standard_unit_price_amount" IS NOT NULL
      )
      OR (
        "line_type" = 'CUSTOM'
        AND "product_id" IS NULL
        AND "product_no_snapshot" IS NULL
        AND "standard_unit_price_amount" IS NULL
      )
    ),
  CONSTRAINT "sales_order_lines_amounts_nonnegative_check"
    CHECK (
      ("standard_unit_price_amount" IS NULL OR "standard_unit_price_amount" >= 0)
      AND "actual_unit_price_amount" >= 0
      AND "line_total_amount" >= 0
    ),
  CONSTRAINT "sales_order_lines_amount_scales_check"
    CHECK (
      (
        "standard_unit_price_amount" IS NULL
        OR scale("standard_unit_price_amount") <= 4
      )
      AND scale("actual_unit_price_amount") <= 4
      AND scale("line_total_amount") <= 4
    ),
  CONSTRAINT "sales_order_lines_total_check"
    CHECK (
      "line_total_amount" = "actual_unit_price_amount" * "quantity"
    )
);

CREATE UNIQUE INDEX "sales_order_lines_order_id_line_number_key"
  ON "sales_order_lines" ("sales_order_id", "line_number");
CREATE INDEX "sales_order_lines_product_id_order_id_idx"
  ON "sales_order_lines" ("product_id", "sales_order_id");

-- CreateSalesOrderPayments
CREATE TABLE "sales_order_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "payment_type" "sales_order_payment_type" NOT NULL,
  "amount" NUMERIC(30, 4) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "payment_method" VARCHAR(64),
  "reference_no" VARCHAR(128),
  "remark" VARCHAR(500),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" UUID,
  "void_reason" VARCHAR(500),

  CONSTRAINT "sales_order_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_payments_amount_positive_check"
    CHECK ("amount" > 0 AND scale("amount") <= 4),
  CONSTRAINT "sales_order_payments_optional_text_nonblank_check"
    CHECK (
      ("payment_method" IS NULL OR "payment_method" !~ '^[[:space:]]*$')
      AND ("reference_no" IS NULL OR "reference_no" !~ '^[[:space:]]*$')
      AND ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "sales_order_payments_void_shape_check"
    CHECK (
      (
        "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
      )
      OR (
        "voided_at" IS NOT NULL
        AND "voided_by_user_id" IS NOT NULL
        AND "void_reason" IS NOT NULL
        AND "void_reason" !~ '^[[:space:]]*$'
      )
    )
);

CREATE INDEX "sales_order_payments_order_voided_received_idx"
  ON "sales_order_payments" (
    "sales_order_id",
    "voided_at",
    "received_at" DESC,
    "id" DESC
  );

-- CreateSalesOrderDocuments
CREATE TABLE "sales_order_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "payment_id" UUID,
  "document_type" "sales_order_document_type" NOT NULL,
  "title" VARCHAR(128),
  "remark" VARCHAR(500),
  "created_by_user_id" UUID NOT NULL,
  "detached_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detached_at" TIMESTAMPTZ(6),

  CONSTRAINT "sales_order_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_documents_optional_text_nonblank_check"
    CHECK (
      ("title" IS NULL OR "title" !~ '^[[:space:]]*$')
      AND ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "sales_order_documents_detach_shape_check"
    CHECK (
      (
        "detached_at" IS NULL
        AND "detached_by_user_id" IS NULL
      )
      OR (
        "detached_at" IS NOT NULL
        AND "detached_by_user_id" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "sales_order_documents_active_order_asset_key"
  ON "sales_order_documents" ("sales_order_id", "media_asset_id")
  WHERE "detached_at" IS NULL;
CREATE UNIQUE INDEX "sales_order_documents_active_asset_key"
  ON "sales_order_documents" ("media_asset_id")
  WHERE "detached_at" IS NULL;
CREATE INDEX "sales_order_documents_order_type_created_idx"
  ON "sales_order_documents" (
    "sales_order_id",
    "detached_at",
    "document_type",
    "created_at" DESC,
    "id" DESC
  );
CREATE INDEX "sales_order_documents_asset_detached_idx"
  ON "sales_order_documents" ("media_asset_id", "detached_at");
CREATE INDEX "sales_order_documents_payment_detached_idx"
  ON "sales_order_documents" ("payment_id", "detached_at");

-- CreateSalesOrderStatusHistory
CREATE TABLE "sales_order_status_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "dimension" "sales_order_status_dimension" NOT NULL,
  "from_status" VARCHAR(32) NOT NULL,
  "to_status" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(500),
  "changed_by_user_id" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sales_order_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_status_history_transition_check"
    CHECK (
      "from_status" !~ '^[[:space:]]*$'
      AND "to_status" !~ '^[[:space:]]*$'
      AND "from_status" <> "to_status"
    ),
  CONSTRAINT "sales_order_status_history_reason_nonblank_check"
    CHECK ("reason" IS NULL OR "reason" !~ '^[[:space:]]*$')
);

CREATE INDEX "sales_order_status_history_order_changed_idx"
  ON "sales_order_status_history" (
    "sales_order_id",
    "changed_at" DESC,
    "id" DESC
  );

-- CreateSalesOrderAmountRevisions
CREATE TABLE "sales_order_amount_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "old_line_subtotal_amount" NUMERIC(30, 4) NOT NULL,
  "old_agreed_total_amount" NUMERIC(30, 4) NOT NULL,
  "old_deposit_due_amount" NUMERIC(30, 4) NOT NULL,
  "old_balance_due_amount" NUMERIC(30, 4) NOT NULL,
  "new_line_subtotal_amount" NUMERIC(30, 4) NOT NULL,
  "new_agreed_total_amount" NUMERIC(30, 4) NOT NULL,
  "new_deposit_due_amount" NUMERIC(30, 4) NOT NULL,
  "new_balance_due_amount" NUMERIC(30, 4) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "changed_by_user_id" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sales_order_amount_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_amount_revisions_nonnegative_check"
    CHECK (
      "old_line_subtotal_amount" >= 0
      AND "old_agreed_total_amount" >= 0
      AND "old_deposit_due_amount" >= 0
      AND "old_balance_due_amount" >= 0
      AND "new_line_subtotal_amount" >= 0
      AND "new_agreed_total_amount" >= 0
      AND "new_deposit_due_amount" >= 0
      AND "new_balance_due_amount" >= 0
    ),
  CONSTRAINT "sales_order_amount_revisions_old_sum_check"
    CHECK (
      "old_line_subtotal_amount" = "old_agreed_total_amount"
      AND "old_agreed_total_amount"
        = "old_deposit_due_amount" + "old_balance_due_amount"
    ),
  CONSTRAINT "sales_order_amount_revisions_new_sum_check"
    CHECK (
      "new_line_subtotal_amount" = "new_agreed_total_amount"
      AND "new_agreed_total_amount"
        = "new_deposit_due_amount" + "new_balance_due_amount"
    ),
  CONSTRAINT "sales_order_amount_revisions_changed_check"
    CHECK (
      ROW(
        "old_line_subtotal_amount",
        "old_agreed_total_amount",
        "old_deposit_due_amount",
        "old_balance_due_amount"
      ) IS DISTINCT FROM ROW(
        "new_line_subtotal_amount",
        "new_agreed_total_amount",
        "new_deposit_due_amount",
        "new_balance_due_amount"
      )
    ),
  CONSTRAINT "sales_order_amount_revisions_reason_nonblank_check"
    CHECK ("reason" !~ '^[[:space:]]*$')
);

CREATE INDEX "sales_order_amount_revisions_order_changed_idx"
  ON "sales_order_amount_revisions" (
    "sales_order_id",
    "changed_at" DESC,
    "id" DESC
  );

-- AddSalesOrderForeignKeys
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_issuer_user_id_fkey"
  FOREIGN KEY ("issuer_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_currency_code_fkey"
  FOREIGN KEY ("currency_code") REFERENCES "currencies" ("code")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_country_region_id_fkey"
  FOREIGN KEY ("customer_country_region_id") REFERENCES "regions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_province_state_id_fkey"
  FOREIGN KEY ("customer_province_state_id") REFERENCES "regions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_city_id_fkey"
  FOREIGN KEY ("customer_city_id") REFERENCES "regions" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_order_lines"
  ADD CONSTRAINT "sales_order_lines_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_lines"
  ADD CONSTRAINT "sales_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_order_payments"
  ADD CONSTRAINT "sales_order_payments_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_payments"
  ADD CONSTRAINT "sales_order_payments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_payments"
  ADD CONSTRAINT "sales_order_payments_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "sales_order_payments" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_detached_by_user_id_fkey"
  FOREIGN KEY ("detached_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_order_status_history"
  ADD CONSTRAINT "sales_order_status_history_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_status_history"
  ADD CONSTRAINT "sales_order_status_history_changed_by_user_id_fkey"
  FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "sales_order_amount_revisions"
  ADD CONSTRAINT "sales_order_amount_revisions_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "sales_order_amount_revisions"
  ADD CONSTRAINT "sales_order_amount_revisions_changed_by_user_id_fkey"
  FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- EnforceSalesOrderRegionPath
CREATE FUNCTION "enforce_sales_order_region_path"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "regions" AS country
    JOIN "regions" AS province
      ON province."id" = NEW."customer_province_state_id"
      AND province."parent_id" = country."id"
      AND province."level" = 'PROVINCE_STATE'
    JOIN "regions" AS city
      ON city."id" = NEW."customer_city_id"
      AND city."parent_id" = province."id"
      AND city."level" = 'CITY'
    WHERE country."id" = NEW."customer_country_region_id"
      AND country."level" = 'COUNTRY_REGION'
      AND country."parent_id" IS NULL
  )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order region path is invalid',
      CONSTRAINT = 'sales_orders_region_path_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_orders_region_path_trigger"
BEFORE INSERT OR UPDATE OF
  "customer_country_region_id",
  "customer_province_state_id",
  "customer_city_id"
ON "sales_orders"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_region_path"();

-- EnforceSalesOrderLineSubtotal
-- Header 与明细分步写入，因此使用 deferred constraint trigger 在提交前验证最终快照。
CREATE FUNCTION "enforce_sales_order_line_subtotal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id UUID;
  expected_subtotal NUMERIC(30, 4);
  actual_subtotal NUMERIC(30, 4);
  line_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'sales_orders' THEN
    target_order_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    target_order_id := OLD."sales_order_id";
  ELSE
    target_order_id := NEW."sales_order_id";
  END IF;

  SELECT "line_subtotal_amount"
  INTO expected_subtotal
  FROM "sales_orders"
  WHERE "id" = target_order_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*)::integer, COALESCE(sum("line_total_amount"), 0)
  INTO line_count, actual_subtotal
  FROM "sales_order_lines"
  WHERE "sales_order_id" = target_order_id;

  IF line_count < 1 OR expected_subtotal <> actual_subtotal THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order line subtotal does not match lines',
      CONSTRAINT = 'sales_order_lines_subtotal_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_orders_line_subtotal_trigger"
AFTER INSERT OR UPDATE OF "line_subtotal_amount" ON "sales_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_line_subtotal"();

CREATE CONSTRAINT TRIGGER "sales_order_lines_subtotal_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "sales_order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_line_subtotal"();

-- EnforceSalesOrderPaymentSummary
-- 付款状态是收款事实的派生快照；Service 与数据库提交边界必须得到同一结果。
CREATE FUNCTION "enforce_sales_order_payment_summary"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_order_id UUID;
  agreed_total NUMERIC(30, 4);
  received_total NUMERIC(30, 4);
  current_status "sales_order_payment_status";
  expected_status "sales_order_payment_status";
BEGIN
  IF TG_TABLE_NAME = 'sales_orders' THEN
    target_order_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    target_order_id := OLD."sales_order_id";
  ELSE
    target_order_id := NEW."sales_order_id";
  END IF;

  SELECT "agreed_total_amount", "payment_status"
  INTO agreed_total, current_status
  FROM "sales_orders"
  WHERE "id" = target_order_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(sum("amount"), 0)
  INTO received_total
  FROM "sales_order_payments"
  WHERE "sales_order_id" = target_order_id
    AND "voided_at" IS NULL;

  IF received_total > agreed_total THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order received amount exceeds agreed total',
      CONSTRAINT = 'sales_order_payments_total_check';
  END IF;

  expected_status := CASE
    WHEN received_total = 0 THEN 'UNPAID'::"sales_order_payment_status"
    WHEN received_total < agreed_total
      THEN 'PARTIALLY_PAID'::"sales_order_payment_status"
    ELSE 'PAID'::"sales_order_payment_status"
  END;

  IF current_status <> expected_status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order payment status does not match payments',
      CONSTRAINT = 'sales_orders_payment_status_summary_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_orders_payment_summary_trigger"
AFTER INSERT OR UPDATE OF "agreed_total_amount", "payment_status"
ON "sales_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_payment_summary"();

CREATE CONSTRAINT TRIGGER "sales_order_payments_summary_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "sales_order_payments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_payment_summary"();

-- EnforceImmutableSalesOrderFacts
CREATE FUNCTION "enforce_sales_order_history_immutable"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'sales order history rows are immutable',
    CONSTRAINT = 'sales_order_history_immutable_check';
END;
$$;

CREATE TRIGGER "sales_order_status_history_immutable_trigger"
BEFORE UPDATE OR DELETE ON "sales_order_status_history"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_history_immutable"();

CREATE TRIGGER "sales_order_amount_revisions_immutable_trigger"
BEFORE UPDATE OR DELETE ON "sales_order_amount_revisions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_history_immutable"();

CREATE FUNCTION "enforce_sales_order_payment_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order payments must be voided instead of deleted',
      CONSTRAINT = 'sales_order_payments_soft_void_check';
  END IF;

  IF ROW(
    OLD."id",
    OLD."sales_order_id",
    OLD."payment_type",
    OLD."amount",
    OLD."received_at",
    OLD."payment_method",
    OLD."reference_no",
    OLD."remark",
    OLD."created_by_user_id",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."sales_order_id",
    NEW."payment_type",
    NEW."amount",
    NEW."received_at",
    NEW."payment_method",
    NEW."reference_no",
    NEW."remark",
    NEW."created_by_user_id",
    NEW."created_at"
  ) OR OLD."voided_at" IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order payment facts are immutable',
      CONSTRAINT = 'sales_order_payments_immutable_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_order_payments_invariants_trigger"
BEFORE UPDATE OR DELETE ON "sales_order_payments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_payment_invariants"();

CREATE FUNCTION "enforce_sales_order_document_invariants"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order documents must be detached instead of deleted',
      CONSTRAINT = 'sales_order_documents_soft_detach_check';
  END IF;

  IF ROW(
    OLD."id",
    OLD."sales_order_id",
    OLD."media_asset_id",
    OLD."payment_id",
    OLD."document_type",
    OLD."title",
    OLD."remark",
    OLD."created_by_user_id",
    OLD."created_at"
  ) IS DISTINCT FROM ROW(
    NEW."id",
    NEW."sales_order_id",
    NEW."media_asset_id",
    NEW."payment_id",
    NEW."document_type",
    NEW."title",
    NEW."remark",
    NEW."created_by_user_id",
    NEW."created_at"
  ) OR OLD."detached_at" IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order document facts are immutable',
      CONSTRAINT = 'sales_order_documents_immutable_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_order_documents_invariants_trigger"
BEFORE UPDATE OR DELETE ON "sales_order_documents"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_document_invariants"();

-- EnforceSalesOrderDocumentAssetReference
CREATE FUNCTION "enforce_sales_order_document_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  asset_status "media_asset_status";
  asset_media_type "media_type";
  payment_order_id UUID;
BEGIN
  IF NEW."detached_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT asset."status", asset."media_type"
  INTO asset_status, asset_media_type
  FROM "media_assets" AS asset
  WHERE asset."id" = NEW."media_asset_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'sales order document media asset does not exist',
      CONSTRAINT = 'sales_order_documents_media_asset_id_fkey';
  END IF;

  IF asset_status <> 'READY' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order document media asset is not READY',
      CONSTRAINT = 'sales_order_documents_asset_ready_check';
  END IF;

  IF asset_media_type NOT IN ('IMAGE', 'DOCUMENT') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'sales order document media type is not allowed',
      CONSTRAINT = 'sales_order_documents_asset_type_check';
  END IF;

  IF NEW."payment_id" IS NOT NULL THEN
    SELECT payment."sales_order_id"
    INTO payment_order_id
    FROM "sales_order_payments" AS payment
    WHERE payment."id" = NEW."payment_id";

    IF payment_order_id IS DISTINCT FROM NEW."sales_order_id" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'sales order document payment belongs to another order',
        CONSTRAINT = 'sales_order_documents_payment_order_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_order_documents_asset_reference_trigger"
AFTER INSERT OR UPDATE ON "sales_order_documents"
NOT DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION "enforce_sales_order_document_asset_reference"();

-- ExtendReadyMediaAssetReference
-- READY 资产必须由明确领域表持有；不得通过动态 owner 或遗漏新表绕过回收保护。
CREATE OR REPLACE FUNCTION "enforce_ready_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_TABLE_NAME = 'media_assets' THEN
    reference_asset_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status = 'READY'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'READY media asset requires an active domain reference',
      CONSTRAINT = 'media_assets_ready_reference_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_order_documents_ready_reference_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "sales_order_documents"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

-- SeedSalesOrderPermissions
INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000154',
    'sales-orders:read',
    '查看销售订单',
    '查看销售订单列表、详情和私有凭证',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000155',
    'sales-orders:create',
    '新增销售订单',
    '创建包含客户和产品快照的销售订单',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000156',
    'sales-orders:update',
    '更新销售订单',
    '更新销售订单状态、履约状态和约定金额',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000157',
    'sales-orders:payment',
    '管理销售订单收款',
    '记录或作废销售订单实际收款',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000158',
    'sales-orders:document',
    '管理销售订单凭证',
    '上传、关联或解除销售订单凭证',
    false
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000154',
    '00000000-0000-4000-8000-000000000155',
    '00000000-0000-4000-8000-000000000156',
    '00000000-0000-4000-8000-000000000157',
    '00000000-0000-4000-8000-000000000158'
  );

COMMIT;
