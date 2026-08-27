BEGIN;

-- 迁移前先验证历史关系是否可被确定性映射。若存在多份有效必备凭证，
-- 必须由业务人员先处理，迁移不得猜测、合并或删除任何历史文件。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_order_documents"
    WHERE "detached_at" IS NULL
      AND "payment_id" IS NULL
      AND "document_type" <> 'DELIVERY_RECEIPT'
    GROUP BY "sales_order_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple active issuance vouchers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_order_documents"
    WHERE "detached_at" IS NULL
      AND "payment_id" IS NOT NULL
    GROUP BY "payment_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple active payment vouchers';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "sales_order_documents"
    WHERE "document_type" = 'DELIVERY_RECEIPT'
      AND "payment_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid payment relation shape';
  END IF;
END;
$$;

-- 使用新枚举替换旧枚举，完整移除废弃值，避免在 Prisma 与数据库之间留下漂移。
ALTER TYPE "sales_order_payment_type"
  RENAME TO "sales_order_payment_type_old";
CREATE TYPE "sales_order_payment_type" AS ENUM (
  'DEPOSIT',
  'PROGRESS',
  'INVOICE_TAX',
  'BALANCE',
  'OTHER'
);
ALTER TABLE "sales_order_payments"
  ALTER COLUMN "payment_type" TYPE "sales_order_payment_type"
  USING ("payment_type"::text::"sales_order_payment_type");
DROP TYPE "sales_order_payment_type_old";

ALTER TYPE "sales_order_document_type"
  RENAME TO "sales_order_document_type_old";
CREATE TYPE "sales_order_document_type" AS ENUM (
  'ORDER_ISSUANCE_VOUCHER',
  'PAYMENT_VOUCHER',
  'DELIVERY_RECEIPT'
);
ALTER TABLE "sales_order_documents"
  ALTER COLUMN "document_type" TYPE "sales_order_document_type"
  USING (
    CASE
      WHEN "document_type"::text = 'DELIVERY_RECEIPT'
        THEN 'DELIVERY_RECEIPT'
      WHEN "payment_id" IS NOT NULL
        THEN 'PAYMENT_VOUCHER'
      ELSE 'ORDER_ISSUANCE_VOUCHER'
    END::"sales_order_document_type"
  );
DROP TYPE "sales_order_document_type_old";

ALTER TABLE "sales_order_payments"
  DROP COLUMN "reference_no";

-- 收款事实仍然不可修改；删除流水号后同步收紧触发器比较字段。
CREATE OR REPLACE FUNCTION "enforce_sales_order_payment_invariants"()
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

ALTER TABLE "sales_order_documents"
  ADD CONSTRAINT "sales_order_documents_payment_shape_check"
  CHECK (
    ("document_type" = 'PAYMENT_VOUCHER' AND "payment_id" IS NOT NULL)
    OR (
      "document_type" IN ('ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT')
      AND "payment_id" IS NULL
    )
  );

CREATE UNIQUE INDEX "sales_order_documents_active_issuance_voucher_key"
  ON "sales_order_documents" ("sales_order_id")
  WHERE "detached_at" IS NULL
    AND "document_type" = 'ORDER_ISSUANCE_VOUCHER';

CREATE UNIQUE INDEX "sales_order_documents_active_payment_voucher_key"
  ON "sales_order_documents" ("payment_id")
  WHERE "detached_at" IS NULL
    AND "document_type" = 'PAYMENT_VOUCHER';

-- 转换后再次断言最终形状，保证约束和索引确实覆盖了全部历史行。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_order_documents"
    WHERE NOT (
      ("document_type" = 'PAYMENT_VOUCHER' AND "payment_id" IS NOT NULL)
      OR (
        "document_type" IN ('ORDER_ISSUANCE_VOUCHER', 'DELIVERY_RECEIPT')
        AND "payment_id" IS NULL
      )
    )
  ) THEN
    RAISE EXCEPTION 'invalid payment relation shape';
  END IF;
END;
$$;

COMMIT;
