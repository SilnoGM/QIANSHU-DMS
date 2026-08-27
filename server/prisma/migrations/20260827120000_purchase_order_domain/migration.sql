BEGIN;

CREATE TYPE "purchase_order_type" AS ENUM (
  'SALES_LINKED',
  'STOCK'
);

CREATE TYPE "purchase_order_status" AS ENUM (
  'CONFIRMED',
  'CANCELLED'
);

CREATE TYPE "purchase_order_fulfillment_status" AS ENUM (
  'PENDING_ORDER',
  'ORDERED',
  'PREPARING',
  'SHIPPED',
  'SIGNED'
);

CREATE TYPE "purchase_order_payment_status" AS ENUM (
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID'
);

CREATE TYPE "purchase_order_line_type" AS ENUM (
  'CATALOG',
  'CUSTOM'
);

CREATE TYPE "purchase_order_payment_type" AS ENUM (
  'DEPOSIT',
  'BALANCE',
  'OTHER'
);

CREATE TYPE "purchase_order_document_type" AS ENUM (
  'PAYMENT_VOUCHER'
);

CREATE TYPE "purchase_order_status_dimension" AS ENUM (
  'ORDER',
  'FULFILLMENT',
  'PAYMENT'
);

ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_ORDER_STATUS_CHANGED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_FULFILLMENT_STATUS_CHANGED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_PAYMENT_RECORDED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_PAYMENT_VOIDED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_DOCUMENT_ATTACHED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_DOCUMENT_DETACHED';

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_no" VARCHAR(64) NOT NULL,
  "create_idempotency_key_hash" BYTEA NOT NULL,
  "create_request_fingerprint_hash" BYTEA NOT NULL,
  "purchase_type" "purchase_order_type" NOT NULL,
  "sales_order_id" UUID,
  "supplier_value" VARCHAR(64) NOT NULL,
  "order_date" DATE NOT NULL,
  "currency_code" CHAR(3) NOT NULL DEFAULT 'CNY',
  "shipping_mark_text" VARCHAR(2000),
  "line_subtotal_amount" DECIMAL(30,4) NOT NULL,
  "purchase_total_amount" DECIMAL(30,4) NOT NULL,
  "deposit_due_amount" DECIMAL(30,4) NOT NULL,
  "balance_due_amount" DECIMAL(30,4) NOT NULL,
  "order_status" "purchase_order_status" NOT NULL DEFAULT 'CONFIRMED',
  "fulfillment_status" "purchase_order_fulfillment_status" NOT NULL DEFAULT 'PENDING_ORDER',
  "payment_status" "purchase_order_payment_status" NOT NULL DEFAULT 'UNPAID',
  "created_by_user_id" UUID NOT NULL,
  "remark" VARCHAR(1000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_hash_lengths_check"
    CHECK (
      octet_length("create_idempotency_key_hash") = 32
      AND octet_length("create_request_fingerprint_hash") = 32
    ),
  CONSTRAINT "purchase_orders_type_source_shape_check"
    CHECK (
      ("purchase_type" = 'SALES_LINKED' AND "sales_order_id" IS NOT NULL)
      OR
      ("purchase_type" = 'STOCK' AND "sales_order_id" IS NULL)
    ),
  CONSTRAINT "purchase_orders_supplier_nonblank_check"
    CHECK ("supplier_value" !~ '^[[:space:]]*$'),
  CONSTRAINT "purchase_orders_currency_check"
    CHECK ("currency_code" = 'CNY'),
  CONSTRAINT "purchase_orders_optional_text_nonblank_check"
    CHECK (
      ("shipping_mark_text" IS NULL OR "shipping_mark_text" !~ '^[[:space:]]*$')
      AND ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "purchase_orders_amounts_nonnegative_check"
    CHECK (
      "line_subtotal_amount" >= 0
      AND "purchase_total_amount" >= 0
      AND "deposit_due_amount" >= 0
      AND "balance_due_amount" >= 0
    ),
  CONSTRAINT "purchase_orders_amount_scales_check"
    CHECK (
      scale("line_subtotal_amount") <= 4
      AND scale("purchase_total_amount") <= 4
      AND scale("deposit_due_amount") <= 4
      AND scale("balance_due_amount") <= 4
    ),
  CONSTRAINT "purchase_orders_total_matches_lines_check"
    CHECK ("purchase_total_amount" = "line_subtotal_amount"),
  CONSTRAINT "purchase_orders_payment_terms_sum_check"
    CHECK (
      "purchase_total_amount" = "deposit_due_amount" + "balance_due_amount"
    ),
  CONSTRAINT "purchase_orders_version_positive_check"
    CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "purchase_orders_order_no_key"
  ON "purchase_orders" ("order_no");
CREATE UNIQUE INDEX "purchase_orders_create_idempotency_key_hash_key"
  ON "purchase_orders" ("create_idempotency_key_hash");
CREATE INDEX "purchase_orders_order_date_id_idx"
  ON "purchase_orders" ("order_date" DESC, "id" DESC);
CREATE INDEX "purchase_orders_statuses_order_date_id_idx"
  ON "purchase_orders" (
    "order_status",
    "fulfillment_status",
    "payment_status",
    "order_date" DESC,
    "id" DESC
  );
CREATE INDEX "purchase_orders_sales_order_date_id_idx"
  ON "purchase_orders" ("sales_order_id", "order_date" DESC, "id" DESC);
CREATE INDEX "purchase_orders_supplier_date_id_idx"
  ON "purchase_orders" ("supplier_value", "order_date" DESC, "id" DESC);

CREATE TABLE "purchase_order_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "line_number" SMALLINT NOT NULL,
  "line_type" "purchase_order_line_type" NOT NULL,
  "product_id" UUID,
  "source_sales_order_line_id" UUID,
  "product_no_snapshot" VARCHAR(64),
  "product_name_snapshot" VARCHAR(128) NOT NULL,
  "product_attributes_snapshot" JSONB NOT NULL DEFAULT '[]',
  "description_snapshot" VARCHAR(1000),
  "reference_purchase_unit_price_amount" DECIMAL(30,4) NOT NULL,
  "actual_purchase_unit_price_amount" DECIMAL(30,4) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "line_total_amount" DECIMAL(30,4) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_line_number_positive_check"
    CHECK ("line_number" >= 1),
  CONSTRAINT "purchase_order_lines_quantity_positive_check"
    CHECK ("quantity" >= 1),
  CONSTRAINT "purchase_order_lines_name_nonblank_check"
    CHECK ("product_name_snapshot" !~ '^[[:space:]]*$'),
  CONSTRAINT "purchase_order_lines_optional_text_nonblank_check"
    CHECK (
      ("product_no_snapshot" IS NULL OR "product_no_snapshot" !~ '^[[:space:]]*$')
      AND ("description_snapshot" IS NULL OR "description_snapshot" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "purchase_order_lines_attributes_array_check"
    CHECK (jsonb_typeof("product_attributes_snapshot") = 'array'),
  CONSTRAINT "purchase_order_lines_type_shape_check"
    CHECK (
      (
        "line_type" = 'CATALOG'
        AND "product_id" IS NOT NULL
        AND "product_no_snapshot" IS NOT NULL
      )
      OR
      (
        "line_type" = 'CUSTOM'
        AND "product_id" IS NULL
        AND "product_no_snapshot" IS NULL
        AND "product_attributes_snapshot" = '[]'::jsonb
      )
    ),
  CONSTRAINT "purchase_order_lines_custom_prices_equal_check"
    CHECK (
      "line_type" <> 'CUSTOM'
      OR "reference_purchase_unit_price_amount" = "actual_purchase_unit_price_amount"
    ),
  CONSTRAINT "purchase_order_lines_amounts_nonnegative_check"
    CHECK (
      "reference_purchase_unit_price_amount" >= 0
      AND "actual_purchase_unit_price_amount" >= 0
      AND "line_total_amount" >= 0
    ),
  CONSTRAINT "purchase_order_lines_amount_scales_check"
    CHECK (
      scale("reference_purchase_unit_price_amount") <= 4
      AND scale("actual_purchase_unit_price_amount") <= 4
      AND scale("line_total_amount") <= 4
    ),
  CONSTRAINT "purchase_order_lines_total_check"
    CHECK (
      "line_total_amount" = "actual_purchase_unit_price_amount" * "quantity"
    )
);

CREATE UNIQUE INDEX "purchase_order_lines_order_id_line_number_key"
  ON "purchase_order_lines" ("purchase_order_id", "line_number");
CREATE INDEX "purchase_order_lines_product_id_order_id_idx"
  ON "purchase_order_lines" ("product_id", "purchase_order_id");
CREATE INDEX "purchase_order_lines_source_sales_line_order_idx"
  ON "purchase_order_lines" ("source_sales_order_line_id", "purchase_order_id");

CREATE TABLE "purchase_order_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "payment_type" "purchase_order_payment_type" NOT NULL,
  "amount" DECIMAL(30,4) NOT NULL,
  "paid_at" TIMESTAMPTZ(6) NOT NULL,
  "payment_method" VARCHAR(64) NOT NULL,
  "remark" VARCHAR(500),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at" TIMESTAMPTZ(6),
  "voided_by_user_id" UUID,
  "void_reason" VARCHAR(500),

  CONSTRAINT "purchase_order_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_payments_amount_check"
    CHECK ("amount" > 0 AND scale("amount") <= 4),
  CONSTRAINT "purchase_order_payments_text_nonblank_check"
    CHECK (
      "payment_method" !~ '^[[:space:]]*$'
      AND ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$')
      AND ("void_reason" IS NULL OR "void_reason" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "purchase_order_payments_void_shape_check"
    CHECK (
      (
        "voided_at" IS NULL
        AND "voided_by_user_id" IS NULL
        AND "void_reason" IS NULL
      )
      OR
      (
        "voided_at" IS NOT NULL
        AND "voided_by_user_id" IS NOT NULL
        AND "void_reason" IS NOT NULL
      )
    )
);

CREATE INDEX "purchase_order_payments_order_voided_paid_idx"
  ON "purchase_order_payments" (
    "purchase_order_id",
    "voided_at",
    "paid_at" DESC,
    "id" DESC
  );

CREATE TABLE "purchase_order_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "media_asset_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "document_type" "purchase_order_document_type" NOT NULL,
  "title" VARCHAR(128),
  "remark" VARCHAR(500),
  "created_by_user_id" UUID NOT NULL,
  "detached_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "detached_at" TIMESTAMPTZ(6),

  CONSTRAINT "purchase_order_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_documents_payment_shape_check"
    CHECK (
      "document_type" = 'PAYMENT_VOUCHER'
      AND "payment_id" IS NOT NULL
    ),
  CONSTRAINT "purchase_order_documents_text_nonblank_check"
    CHECK (
      ("title" IS NULL OR "title" !~ '^[[:space:]]*$')
      AND ("remark" IS NULL OR "remark" !~ '^[[:space:]]*$')
    ),
  CONSTRAINT "purchase_order_documents_detach_shape_check"
    CHECK (
      ("detached_at" IS NULL AND "detached_by_user_id" IS NULL)
      OR
      ("detached_at" IS NOT NULL AND "detached_by_user_id" IS NOT NULL)
    )
);

CREATE INDEX "purchase_order_documents_order_type_created_idx"
  ON "purchase_order_documents" (
    "purchase_order_id",
    "detached_at",
    "document_type",
    "created_at" DESC,
    "id" DESC
  );
CREATE INDEX "purchase_order_documents_asset_detached_idx"
  ON "purchase_order_documents" ("media_asset_id", "detached_at");
CREATE INDEX "purchase_order_documents_payment_detached_idx"
  ON "purchase_order_documents" ("payment_id", "detached_at");
CREATE UNIQUE INDEX "purchase_order_documents_active_payment_voucher_key"
  ON "purchase_order_documents" ("payment_id")
  WHERE "detached_at" IS NULL;

CREATE TABLE "purchase_order_status_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_order_id" UUID NOT NULL,
  "dimension" "purchase_order_status_dimension" NOT NULL,
  "from_status" VARCHAR(32) NOT NULL,
  "to_status" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(500),
  "changed_by_user_id" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_status_history_status_nonblank_check"
    CHECK (
      "from_status" !~ '^[[:space:]]*$'
      AND "to_status" !~ '^[[:space:]]*$'
      AND "from_status" <> "to_status"
    ),
  CONSTRAINT "purchase_order_status_history_reason_nonblank_check"
    CHECK ("reason" IS NULL OR "reason" !~ '^[[:space:]]*$')
);

CREATE INDEX "purchase_order_status_history_order_changed_idx"
  ON "purchase_order_status_history" (
    "purchase_order_id",
    "changed_at" DESC,
    "id" DESC
  );

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_currency_code_fkey"
  FOREIGN KEY ("currency_code") REFERENCES "currencies" ("code")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_source_sales_order_line_id_fkey"
  FOREIGN KEY ("source_sales_order_line_id") REFERENCES "sales_order_lines" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_order_payments"
  ADD CONSTRAINT "purchase_order_payments_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_payments"
  ADD CONSTRAINT "purchase_order_payments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_payments"
  ADD CONSTRAINT "purchase_order_payments_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_media_asset_id_fkey"
  FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "purchase_order_payments" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_documents"
  ADD CONSTRAINT "purchase_order_documents_detached_by_user_id_fkey"
  FOREIGN KEY ("detached_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "purchase_order_status_history"
  ADD CONSTRAINT "purchase_order_status_history_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "purchase_order_status_history"
  ADD CONSTRAINT "purchase_order_status_history_changed_by_user_id_fkey"
  FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 约束触发器在最终事务提交前统一验证跨表关系，防止绕过服务层写入非法来源。
CREATE FUNCTION "enforce_purchase_order_line_source"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_order_lines" AS line
    JOIN "purchase_orders" AS purchase_order
      ON purchase_order."id" = line."purchase_order_id"
    LEFT JOIN "sales_order_lines" AS sales_line
      ON sales_line."id" = line."source_sales_order_line_id"
    LEFT JOIN "sales_orders" AS sales_order
      ON sales_order."id" = sales_line."sales_order_id"
    WHERE
      (
        purchase_order."purchase_type" = 'STOCK'
        AND line."source_sales_order_line_id" IS NOT NULL
      )
      OR
      (
        purchase_order."purchase_type" = 'SALES_LINKED'
        AND (
          line."source_sales_order_line_id" IS NULL
          OR sales_line."sales_order_id" <> purchase_order."sales_order_id"
          OR sales_order."order_status" <> 'CONFIRMED'
          OR sales_line."line_type"::text <> line."line_type"::text
          OR (
            line."line_type" = 'CATALOG'
            AND sales_line."product_id" IS DISTINCT FROM line."product_id"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_lines_source_shape_check',
      MESSAGE = 'purchase order line source does not match its order and sales line';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_orders_line_source_trigger"
AFTER INSERT OR UPDATE ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_line_source"();

CREATE CONSTRAINT TRIGGER "purchase_order_lines_source_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_line_source"();

CREATE FUNCTION "enforce_purchase_order_line_subtotal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_orders" AS purchase_order
    LEFT JOIN (
      SELECT
        "purchase_order_id",
        COALESCE(SUM("line_total_amount"), 0::numeric) AS subtotal,
        COUNT(*) AS line_count
      FROM "purchase_order_lines"
      GROUP BY "purchase_order_id"
    ) AS line_summary
      ON line_summary."purchase_order_id" = purchase_order."id"
    WHERE
      COALESCE(line_summary.line_count, 0) = 0
      OR purchase_order."line_subtotal_amount" <> COALESCE(line_summary.subtotal, 0)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_lines_subtotal_check',
      MESSAGE = 'purchase order line subtotal does not match its persisted lines';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_orders_line_subtotal_trigger"
AFTER INSERT OR UPDATE OF "line_subtotal_amount" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_line_subtotal"();

CREATE CONSTRAINT TRIGGER "purchase_order_lines_subtotal_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_line_subtotal"();

CREATE FUNCTION "enforce_purchase_order_payment_summary"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_orders" AS purchase_order
    LEFT JOIN (
      SELECT
        "purchase_order_id",
        COALESCE(SUM("amount") FILTER (WHERE "voided_at" IS NULL), 0::numeric) AS paid
      FROM "purchase_order_payments"
      GROUP BY "purchase_order_id"
    ) AS payment_summary
      ON payment_summary."purchase_order_id" = purchase_order."id"
    WHERE
      COALESCE(payment_summary.paid, 0) > purchase_order."purchase_total_amount"
      OR purchase_order."payment_status" IS DISTINCT FROM (
        CASE
          WHEN COALESCE(payment_summary.paid, 0) = purchase_order."purchase_total_amount"
            THEN 'PAID'::"purchase_order_payment_status"
          WHEN COALESCE(payment_summary.paid, 0) = 0
            THEN 'UNPAID'::"purchase_order_payment_status"
          ELSE 'PARTIALLY_PAID'::"purchase_order_payment_status"
        END
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_orders_payment_status_summary_check',
      MESSAGE = 'purchase order payment status does not match active payments';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_orders_payment_summary_trigger"
AFTER INSERT OR UPDATE OF "purchase_total_amount", "payment_status" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_payment_summary"();

CREATE CONSTRAINT TRIGGER "purchase_order_payments_summary_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_payments"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_payment_summary"();

CREATE FUNCTION "enforce_purchase_order_source_quantity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_order_lines" AS sales_line
    JOIN (
      SELECT
        line."source_sales_order_line_id",
        SUM(line."quantity") AS purchased_quantity
      FROM "purchase_order_lines" AS line
      JOIN "purchase_orders" AS purchase_order
        ON purchase_order."id" = line."purchase_order_id"
      WHERE
        line."source_sales_order_line_id" IS NOT NULL
        AND purchase_order."order_status" <> 'CANCELLED'
      GROUP BY line."source_sales_order_line_id"
    ) AS purchased
      ON purchased."source_sales_order_line_id" = sales_line."id"
    WHERE purchased."purchased_quantity" > sales_line."quantity"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_source_quantity_check',
      MESSAGE = 'active purchase quantity exceeds the source sales line quantity';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_orders_source_quantity_trigger"
AFTER INSERT OR UPDATE OF "order_status" ON "purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();

CREATE CONSTRAINT TRIGGER "purchase_order_lines_source_quantity_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_source_quantity"();

CREATE FUNCTION "enforce_purchase_order_document_relation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_order_documents" AS document
    JOIN "purchase_order_payments" AS payment
      ON payment."id" = document."payment_id"
    WHERE payment."purchase_order_id" <> document."purchase_order_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_documents_payment_order_check',
      MESSAGE = 'purchase order payment voucher belongs to another order';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_order_documents_relation_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_documents"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_document_relation"();

CREATE FUNCTION "enforce_purchase_order_document_ready_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "purchase_order_documents" AS document
    JOIN "media_assets" AS asset
      ON asset."id" = document."media_asset_id"
    WHERE
      document."detached_at" IS NULL
      AND (
        asset."status" <> 'READY'
        OR asset."media_type" NOT IN ('IMAGE', 'DOCUMENT')
        OR asset."deleted_at" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_documents_ready_asset_check',
      MESSAGE = 'active purchase order document must reference a ready private asset';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_order_documents_ready_reference_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_documents"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_document_ready_reference"();

INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "system_only"
)
VALUES
  (
    '00000000-0000-4000-8000-000000000159',
    'purchase-orders:read',
    '查看采购订单',
    '查看采购订单列表、详情和私有凭证',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000160',
    'purchase-orders:create',
    '新增采购订单',
    '创建销售关联采购订单',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000161',
    'purchase-orders:create-stock',
    '新增备货采购',
    '仅系统管理员创建不关联销售订单的备货采购',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000162',
    'purchase-orders:update',
    '更新采购订单',
    '更新采购订单状态和履约状态',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000163',
    'purchase-orders:payment',
    '管理采购付款',
    '记录或作废采购订单实际付款',
    false
  ),
  (
    '00000000-0000-4000-8000-000000000164',
    'purchase-orders:document',
    '管理采购凭证',
    '上传、关联或解除采购订单付款凭证',
    false
  );

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" IN (
    '00000000-0000-4000-8000-000000000159',
    '00000000-0000-4000-8000-000000000160',
    '00000000-0000-4000-8000-000000000161',
    '00000000-0000-4000-8000-000000000162',
    '00000000-0000-4000-8000-000000000163',
    '00000000-0000-4000-8000-000000000164'
  );

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "permissions"
    WHERE "code" LIKE 'purchase-orders:%'
  ) <> 6 THEN
    RAISE EXCEPTION 'purchase order migration invariant mismatch: permission catalog';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM "role_permissions" AS role_permission
    JOIN "roles" AS role ON role."id" = role_permission."role_id"
    JOIN "permissions" AS permission
      ON permission."id" = role_permission."permission_id"
    WHERE
      role."code" = 'system_admin'
      AND permission."code" LIKE 'purchase-orders:%'
  ) <> 6 THEN
    RAISE EXCEPTION 'purchase order migration invariant mismatch: system admin grants';
  END IF;
END;
$$;

COMMIT;
