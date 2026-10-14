-- 开票申请与审批：申请单、明细行、状态历史三表与本域的封闭规则。
--
-- 语义：
--   1) 申请单不可删除（触发器拒绝 DELETE）；状态只能按白名单单向流转：
--        PENDING_REVIEW → NOTIFIED | RETURNED | CANCELLED
--        RETURNED       → PENDING_REVIEW（退回重填）| CANCELLED
--        NOTIFIED       → ISSUED | CANCELLED
--        ISSUED         → SETTLED | CANCELLED
--      SETTLED 与 CANCELLED 是终态，终态之后整单不可变。
--   2) 每次 UPDATE 只允许写「该次流转自己的列」：例如 PENDING_REVIEW → NOTIFIED 只能写
--      notified_at / notified_by_user_id，绝不允许借流转改写业务字段；唯一例外是
--      RETURNED → PENDING_REVIEW（退回重填），它才是修改业务字段的通道。
--   3) 明细行的可变性由父单状态决定：只有父单处于 RETURNED 时才能改行；新增行只允许发生在
--      未被通知的状态。重填流程必须先改行、再翻父单状态（同事务内触发器读到父单仍为 RETURNED）。
--   4) 状态历史追加式留痕：UPDATE / DELETE 一律拒绝；取消时所处的状态由 from_status 表达。
--   5) 申请单号必须来自 INVOICE_REQUEST 规则的派发台账，应用不得自行拼装。
--
-- 金额口径：台币金额一律整数元（票面即整数，行内勾稽 amount = quantity × unit_price）；
-- settle_amount_cny 是人民币入账成本，2 位小数；汇率快照取入账时刻的当前值。

-- 1) 状态与动作枚举
CREATE TYPE "invoice_request_status" AS ENUM ('PENDING_REVIEW', 'RETURNED', 'NOTIFIED', 'ISSUED', 'SETTLED', 'CANCELLED');
CREATE TYPE "invoice_request_action" AS ENUM ('SUBMIT', 'RESUBMIT', 'RETURN', 'NOTIFY', 'UPLOAD_DOCUMENT', 'SETTLE', 'CANCEL');

-- 2) 申请单
CREATE TABLE "invoice_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_no" VARCHAR(64) NOT NULL,
    "numbering_issuance_id" UUID NOT NULL,
    "status" "invoice_request_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "buyer_name" VARCHAR(200) NOT NULL,
    "buyer_tax_id" VARCHAR(8) NOT NULL,
    "sales_amount" BIGINT NOT NULL,
    "tax_amount" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "invoice_remark" VARCHAR(500),
    "internal_remark" VARCHAR(500),
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "last_submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "notified_at" TIMESTAMPTZ(6),
    "notified_by_user_id" UUID,
    "returned_at" TIMESTAMPTZ(6),
    "returned_by_user_id" UUID,
    "document_media_asset_id" UUID,
    "document_uploaded_at" TIMESTAMPTZ(6),
    "document_uploaded_by_user_id" UUID,
    "settled_at" TIMESTAMPTZ(6),
    "settled_by_user_id" UUID,
    "settle_amount_cny" DECIMAL(30,2),
    "exchange_rate_id" UUID,
    "exchange_rate_version_snapshot" INTEGER,
    "foreign_units_per_cny_snapshot" DECIMAL(30,12),
    "rate_captured_at" TIMESTAMPTZ(6),
    "fund_posting_batch_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_user_id" UUID,
    "cancel_reason" VARCHAR(500),
    "request_key_hash" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);

-- 3) 明细行
CREATE TABLE "invoice_request_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_request_lines_pkey" PRIMARY KEY ("id")
);

-- 4) 状态历史
CREATE TABLE "invoice_request_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "action" "invoice_request_action" NOT NULL,
    "from_status" "invoice_request_status",
    "to_status" "invoice_request_status" NOT NULL,
    "reason" VARCHAR(500),
    "actor_user_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_request_status_history_pkey" PRIMARY KEY ("id")
);

-- 5) 索引
CREATE UNIQUE INDEX "invoice_requests_number_key" ON "invoice_requests"("invoice_no");
CREATE UNIQUE INDEX "invoice_requests_issuance_key" ON "invoice_requests"("numbering_issuance_id");
CREATE UNIQUE INDEX "invoice_requests_document_asset_key" ON "invoice_requests"("document_media_asset_id");
CREATE UNIQUE INDEX "invoice_requests_posting_batch_key" ON "invoice_requests"("fund_posting_batch_id");
-- 幂等：同一个提交人 + 同一个提交标识只落一条（双击、网络重试都恢复同一条记录）
CREATE UNIQUE INDEX "invoice_requests_actor_request_key" ON "invoice_requests"("created_by_id", "request_key_hash");
CREATE INDEX "invoice_requests_creator_created_idx" ON "invoice_requests"("created_by_id", "created_at" DESC, "id" DESC);
CREATE INDEX "invoice_requests_status_created_idx" ON "invoice_requests"("status", "created_at" DESC, "id" DESC);
-- 提交时的四项比对（抬头 + 统编 + 营业税 + 总计）走这条索引，再按 status 过滤
CREATE INDEX "invoice_requests_duplicate_key_idx" ON "invoice_requests"("buyer_tax_id", "total_amount");
CREATE UNIQUE INDEX "invoice_request_lines_request_line_key" ON "invoice_request_lines"("request_id", "line_no");
CREATE INDEX "invoice_request_status_history_request_occurred_idx" ON "invoice_request_status_history"("request_id", "occurred_at", "id");

-- 6) 数据库不变量：统编形状、金额勾稽、寄送必填、状态与列的成对形状
ALTER TABLE "invoice_requests"
  ADD CONSTRAINT "invoice_requests_buyer_check"
    CHECK (btrim(buyer_name) <> '' AND buyer_tax_id ~ '^\d{8}$'),
  ADD CONSTRAINT "invoice_requests_amount_check"
    CHECK (sales_amount > 0 AND tax_amount >= 0 AND total_amount = sales_amount + tax_amount),
  ADD CONSTRAINT "invoice_requests_recipient_check"
    CHECK (btrim(recipient_name) <> '' AND btrim(recipient_phone) <> '' AND btrim(recipient_address) <> ''),
  ADD CONSTRAINT "invoice_requests_status_shape_check"
    CHECK (
      -- 取消：三个取消列成对出现，未取消时必须全空
      (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancelled_by_user_id IS NOT NULL AND cancel_reason IS NOT NULL))
      AND (status = 'CANCELLED' OR (cancelled_at IS NULL AND cancelled_by_user_id IS NULL AND cancel_reason IS NULL))
      -- 退回：退回态必须有退回时刻（重新提交后该时刻保留，表示最近一次退回）
      AND (status <> 'RETURNED' OR returned_at IS NOT NULL)
      -- 通知：通知及之后的状态必须有通知时刻
      AND (status NOT IN ('NOTIFIED', 'ISSUED', 'SETTLED') OR notified_at IS NOT NULL)
      -- 照片：开出邮寄及之后的状态必须有照片。
      -- 只做单向约束：取消可能发生在任何未终态，从「已开出邮寄」取消时照片必须保留，
      -- 因此不能反过来要求非 ISSUED/SETTLED 的照片列全空（那一维由流转触发器封闭）。
      AND (
        status NOT IN ('ISSUED', 'SETTLED')
        OR (document_media_asset_id IS NOT NULL AND document_uploaded_at IS NOT NULL AND document_uploaded_by_user_id IS NOT NULL)
      )
      -- 结算：入账列必须与结算态成对出现（SETTLED 少任一列都是脏数据）
      AND (
        (
          status <> 'SETTLED'
          AND settled_at IS NULL AND settled_by_user_id IS NULL AND settle_amount_cny IS NULL
          AND exchange_rate_id IS NULL AND exchange_rate_version_snapshot IS NULL
          AND foreign_units_per_cny_snapshot IS NULL AND rate_captured_at IS NULL
          AND fund_posting_batch_id IS NULL
        )
        OR (
          status = 'SETTLED'
          AND settled_at IS NOT NULL AND settled_by_user_id IS NOT NULL AND settle_amount_cny IS NOT NULL
          AND exchange_rate_id IS NOT NULL AND exchange_rate_version_snapshot IS NOT NULL
          AND foreign_units_per_cny_snapshot IS NOT NULL AND rate_captured_at IS NOT NULL
          AND fund_posting_batch_id IS NOT NULL
        )
      )
    );

ALTER TABLE "invoice_request_lines"
  ADD CONSTRAINT "invoice_request_lines_line_no_check"
    CHECK (line_no BETWEEN 1 AND 5),
  ADD CONSTRAINT "invoice_request_lines_product_name_check"
    CHECK (btrim(product_name) <> ''),
  ADD CONSTRAINT "invoice_request_lines_amount_check"
    CHECK (quantity > 0 AND unit_price > 0 AND amount > 0 AND amount = quantity * unit_price);

ALTER TABLE "invoice_request_status_history"
  ADD CONSTRAINT "invoice_request_status_history_reason_check"
    CHECK (
      (action IN ('RETURN', 'CANCEL') AND reason IS NOT NULL AND btrim(reason) <> '')
      OR (action NOT IN ('RETURN', 'CANCEL') AND reason IS NULL)
    ),
  ADD CONSTRAINT "invoice_request_status_history_transition_shape_check"
    CHECK (
      (action = 'SUBMIT' AND from_status IS NULL AND to_status = 'PENDING_REVIEW')
      OR (action = 'RESUBMIT' AND from_status = 'RETURNED' AND to_status = 'PENDING_REVIEW')
      OR (action = 'RETURN' AND from_status = 'PENDING_REVIEW' AND to_status = 'RETURNED')
      OR (action = 'NOTIFY' AND from_status = 'PENDING_REVIEW' AND to_status = 'NOTIFIED')
      OR (action = 'UPLOAD_DOCUMENT' AND from_status = 'NOTIFIED' AND to_status = 'ISSUED')
      OR (action = 'SETTLE' AND from_status = 'ISSUED' AND to_status = 'SETTLED')
      OR (action = 'CANCEL' AND to_status = 'CANCELLED')
    );

-- 7) 生命周期：不可删；写入即 PENDING_REVIEW；每次流转只允许写各自的列
CREATE FUNCTION enforce_invoice_request_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed_columns TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoice request is immutable evidence' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_no_delete_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_REVIEW' THEN
      RAISE EXCEPTION 'Invoice request must begin PENDING_REVIEW' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_initial_status_check';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('SETTLED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Invoice request is immutable after terminal status' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_terminal_immutable_check';
  END IF;

  allowed_columns := CASE
    WHEN OLD.status = 'PENDING_REVIEW' AND NEW.status = 'RETURNED'
      THEN ARRAY['status', 'version', 'updated_at', 'returned_at', 'returned_by_user_id']
    WHEN OLD.status = 'PENDING_REVIEW' AND NEW.status = 'NOTIFIED'
      THEN ARRAY['status', 'version', 'updated_at', 'notified_at', 'notified_by_user_id']
    WHEN OLD.status = 'PENDING_REVIEW' AND NEW.status = 'CANCELLED'
      THEN ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by_user_id', 'cancel_reason']
    -- 退回重填：唯一允许修改业务字段的流转
    WHEN OLD.status = 'RETURNED' AND NEW.status = 'PENDING_REVIEW'
      THEN ARRAY[
        'status', 'version', 'updated_at', 'last_submitted_at',
        'buyer_name', 'buyer_tax_id', 'sales_amount', 'tax_amount', 'total_amount',
        'invoice_remark', 'internal_remark', 'recipient_name', 'recipient_phone', 'recipient_address'
      ]
    WHEN OLD.status = 'RETURNED' AND NEW.status = 'CANCELLED'
      THEN ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by_user_id', 'cancel_reason']
    WHEN OLD.status = 'NOTIFIED' AND NEW.status = 'ISSUED'
      THEN ARRAY['status', 'version', 'updated_at', 'document_media_asset_id', 'document_uploaded_at', 'document_uploaded_by_user_id']
    WHEN OLD.status = 'NOTIFIED' AND NEW.status = 'CANCELLED'
      THEN ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by_user_id', 'cancel_reason']
    WHEN OLD.status = 'ISSUED' AND NEW.status = 'SETTLED'
      THEN ARRAY[
        'status', 'version', 'updated_at', 'settled_at', 'settled_by_user_id', 'settle_amount_cny',
        'exchange_rate_id', 'exchange_rate_version_snapshot', 'foreign_units_per_cny_snapshot',
        'rate_captured_at', 'fund_posting_batch_id'
      ]
    WHEN OLD.status = 'ISSUED' AND NEW.status = 'CANCELLED'
      THEN ARRAY['status', 'version', 'updated_at', 'cancelled_at', 'cancelled_by_user_id', 'cancel_reason']
    ELSE NULL
  END;

  IF allowed_columns IS NULL THEN
    RAISE EXCEPTION 'Invoice request status transition is not allowed' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_transition_check';
  END IF;

  IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM (to_jsonb(OLD) - allowed_columns) THEN
    RAISE EXCEPTION 'Invoice request columns are not editable in this transition' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_immutable_columns_check';
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER invoice_requests_lifecycle_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "invoice_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_lifecycle();

-- 明细行的可变性由父单状态决定：新增只发生在未通知的状态，改动只发生在退回重填
CREATE FUNCTION enforce_invoice_request_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status "invoice_request_status";
  target_request_id UUID;
BEGIN
  target_request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;

  IF TG_OP = 'UPDATE' AND NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'Invoice request line cannot move to another request' USING ERRCODE = '23514', CONSTRAINT = 'invoice_request_lines_request_immutable_check';
  END IF;

  SELECT request.status INTO parent_status FROM invoice_requests request WHERE request.id = target_request_id;
  -- 父单行必须已存在（外键兜底）；同事务内先插父单再插明细，这里总能读到。
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF parent_status NOT IN ('PENDING_REVIEW', 'RETURNED') THEN
      RAISE EXCEPTION 'Invoice request line can only be added before notification' USING ERRCODE = '23514', CONSTRAINT = 'invoice_request_lines_insert_status_check';
    END IF;
  ELSIF parent_status <> 'RETURNED' THEN
    RAISE EXCEPTION 'Invoice request line is editable only while the request is returned' USING ERRCODE = '23514', CONSTRAINT = 'invoice_request_lines_edit_status_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER invoice_request_lines_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON "invoice_request_lines"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_line_guard();

-- 编号身份兜底：申请单号必须来自 INVOICE_REQUEST 的派发台账
CREATE FUNCTION enforce_invoice_request_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM numbering_issuances issuance
    JOIN numbering_rules rule ON rule.id = issuance.rule_id
    WHERE issuance.id = NEW.numbering_issuance_id
      AND issuance.generated_number = NEW.invoice_no
      AND issuance.consumer_code = 'INVOICE_REQUEST.CREATE'
      AND rule.rule_code = 'INVOICE_REQUEST'
      AND rule.purpose = 'BUSINESS'
  ) THEN
    RAISE EXCEPTION 'Invoice request number must match its scoped issuance' USING ERRCODE = '23514', CONSTRAINT = 'invoice_requests_number_identity_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_requests_identity_trigger BEFORE INSERT ON "invoice_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_identity();

-- 状态历史全不可变
CREATE FUNCTION enforce_invoice_request_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Invoice request status history rows are immutable' USING ERRCODE = '23514', CONSTRAINT = 'invoice_request_history_immutable_check';
END $$;
CREATE TRIGGER invoice_request_status_history_immutable_trigger
BEFORE UPDATE OR DELETE ON "invoice_request_status_history"
FOR EACH ROW EXECUTE FUNCTION enforce_invoice_request_history_immutable();

-- 8) 外键：全部 Restrict（单据与留痕都不得被级联删除）
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_numbering_issuance_id_fkey" FOREIGN KEY ("numbering_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_document_media_asset_id_fkey" FOREIGN KEY ("document_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_fund_posting_batch_id_fkey" FOREIGN KEY ("fund_posting_batch_id") REFERENCES "fund_posting_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_notified_by_user_id_fkey" FOREIGN KEY ("notified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_returned_by_user_id_fkey" FOREIGN KEY ("returned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_document_uploaded_by_user_id_fkey" FOREIGN KEY ("document_uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_settled_by_user_id_fkey" FOREIGN KEY ("settled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_request_lines" ADD CONSTRAINT "invoice_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "invoice_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_request_status_history" ADD CONSTRAINT "invoice_request_status_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "invoice_requests"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_request_status_history" ADD CONSTRAINT "invoice_request_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 9) 结构自校验：表、枚举与不变量缺失即整单回滚
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES ('invoice_requests'), ('invoice_request_lines'), ('invoice_request_status_history')) AS expected(name)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = expected.name)
  ) THEN
    RAISE EXCEPTION 'invoice request tables missing' USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel::text ORDER BY enum_value.enumsortorder)
    FROM pg_type enum_type
    JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
    JOIN pg_namespace enum_namespace ON enum_namespace.oid = enum_type.typnamespace
    WHERE enum_type.typname = 'invoice_request_status' AND enum_namespace.nspname = current_schema()
  ) IS DISTINCT FROM ARRAY['PENDING_REVIEW', 'RETURNED', 'NOTIFIED', 'ISSUED', 'SETTLED', 'CANCELLED']::text[] THEN
    RAISE EXCEPTION 'invoice request status enum mismatch' USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT array_agg(enum_value.enumlabel::text ORDER BY enum_value.enumsortorder)
    FROM pg_type enum_type
    JOIN pg_enum enum_value ON enum_value.enumtypid = enum_type.oid
    JOIN pg_namespace enum_namespace ON enum_namespace.oid = enum_type.typnamespace
    WHERE enum_type.typname = 'invoice_request_action' AND enum_namespace.nspname = current_schema()
  ) IS DISTINCT FROM ARRAY['SUBMIT', 'RESUBMIT', 'RETURN', 'NOTIFY', 'UPLOAD_DOCUMENT', 'SETTLE', 'CANCEL']::text[] THEN
    RAISE EXCEPTION 'invoice request action enum mismatch' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('invoice_requests_lifecycle_trigger', 'invoice_requests'),
      ('invoice_request_lines_guard_trigger', 'invoice_request_lines'),
      ('invoice_requests_identity_trigger', 'invoice_requests'),
      ('invoice_request_status_history_immutable_trigger', 'invoice_request_status_history')
    ) AS expected(trigger_name, table_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.triggers trigger
      WHERE trigger.trigger_schema = current_schema()
        AND trigger.trigger_name = expected.trigger_name
        AND trigger.event_object_table = expected.table_name
    )
  ) THEN
    RAISE EXCEPTION 'invoice request triggers missing' USING ERRCODE = '23514';
  END IF;
END $$;
