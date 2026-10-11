-- 对账结算结果：把「确认结算」的结果按行留痕。
--
-- 语义（与本域既有做法一致）：
--   1) 追加式留痕：每次确认写入一条完整快照，永不删除（触发器拒绝 DELETE）。
--   2) 同一批次成员行最多一条有效：后续结果若与原结果不同，就把原结果置为 SUPERSEDED 再写新的 ACTIVE；
--      若完全相同则由服务端直接拒绝，不写库。部分唯一索引是这条不变量的数据库级保证。
--   3) UPDATE 只允许 status 与 updated_at 两列，且只允许 ACTIVE → SUPERSEDED 单向流转。
--
-- 金额一律「金额 + 币种代码」成对存储（与 slh_bill_line_charges 同一惯例）。

-- 1) 状态枚举
CREATE TYPE "slh_reconciliation_settlement_status" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- 2) 对账结算结果表
CREATE TABLE "slh_reconciliation_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "batch_line_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_line_id" UUID NOT NULL,
    "loading_item_id" UUID NOT NULL,
    "container_batch_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "status" "slh_reconciliation_settlement_status" NOT NULL DEFAULT 'ACTIVE',
    "rate_source" "slh_bill_rate_source" NOT NULL,
    "foreign_units_per_cny" DECIMAL(30,12) NOT NULL,
    "payment_fee_rate" DECIMAL(30,12) NOT NULL,
    "sales_order_no" VARCHAR(64) NOT NULL,
    "purchase_order_no" VARCHAR(64) NOT NULL,
    "container_batch_no" VARCHAR(128) NOT NULL,
    "shipment_no" VARCHAR(64),
    "slh_bill_no" VARCHAR(64) NOT NULL,
    "warehouse_receipt_reference" VARCHAR(1000),
    "shipping_mark_text" VARCHAR(500),
    "cod_amount_twd" DECIMAL(30,2),
    "cod_amount_currency" CHAR(3) NOT NULL,
    "ntd_surcharge_amount_twd" DECIMAL(30,2),
    "ntd_surcharge_currency" CHAR(3) NOT NULL,
    "payable_amount_cny" DECIMAL(30,2),
    "payable_currency" CHAR(3) NOT NULL,
    "settlement_amount_cny" DECIMAL(30,2),
    "settlement_currency" CHAR(3) NOT NULL,
    "sales_amount" DECIMAL(30,4),
    "sales_currency" CHAR(3) NOT NULL,
    "payment_fee_amount_cny" DECIMAL(30,2),
    "payment_fee_currency" CHAR(3) NOT NULL,
    "request_key_hash" BYTEA NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slh_reconciliation_settlements_pkey" PRIMARY KEY ("id")
);

-- 3) 索引：按账单 / 成员行 / 柜次 / 装柜行 / 订单 / 核对人各留一条查询路径
CREATE INDEX "slh_reconciliation_settlements_batch_created_idx" ON "slh_reconciliation_settlements"("batch_id", "created_at" DESC);
CREATE INDEX "slh_reconciliation_settlements_line_created_idx" ON "slh_reconciliation_settlements"("batch_line_id", "created_at" DESC);
CREATE INDEX "slh_reconciliation_settlements_bill_created_idx" ON "slh_reconciliation_settlements"("bill_id", "created_at" DESC);
CREATE INDEX "slh_reconciliation_settlements_container_batch_idx" ON "slh_reconciliation_settlements"("container_batch_id");
CREATE INDEX "slh_reconciliation_settlements_loading_item_idx" ON "slh_reconciliation_settlements"("loading_item_id");
CREATE INDEX "slh_reconciliation_settlements_sales_order_idx" ON "slh_reconciliation_settlements"("sales_order_id");
CREATE INDEX "slh_reconciliation_settlements_purchase_order_idx" ON "slh_reconciliation_settlements"("purchase_order_id");
CREATE INDEX "slh_reconciliation_settlements_actor_created_idx" ON "slh_reconciliation_settlements"("created_by_id", "created_at" DESC);
-- 幂等：同一个核对人 + 同一个提交标识只落一条（双击、网络重试都恢复同一条记录）
CREATE UNIQUE INDEX "slh_reconciliation_settlements_actor_request_key" ON "slh_reconciliation_settlements"("created_by_id", "request_key_hash");
-- 同一成员行最多一条有效（部分唯一索引，Prisma schema 不表达；先例见 slh_bills_active_name_key）
CREATE UNIQUE INDEX "slh_reconciliation_settlements_active_line_key" ON "slh_reconciliation_settlements"("batch_line_id") WHERE status = 'ACTIVE';

-- 4) 数据库不变量：汇率与费率同号，币种按列语义固定（销售金额币种跟随订单币种，只校验形状）
ALTER TABLE "slh_reconciliation_settlements"
  ADD CONSTRAINT "slh_reconciliation_settlements_rate_check"
    CHECK (foreign_units_per_cny > 0 AND payment_fee_rate >= 0),
  ADD CONSTRAINT "slh_reconciliation_settlements_currency_check"
    CHECK (
      cod_amount_currency = 'TWD'
      AND ntd_surcharge_currency = 'TWD'
      AND payable_currency = 'CNY'
      AND settlement_currency = 'CNY'
      AND payment_fee_currency = 'CNY'
      AND char_length(sales_currency) = 3
    );

-- 5) 生命周期：不可删；写入即有效；只允许从有效变为失效，且除 status / updated_at 外不得改写。
--    与 slh_bills 的 enforce_slh_bill_identity() 同一写法（去掉白名单列后比较整行快照）。
CREATE FUNCTION enforce_slh_reconciliation_settlement_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SLH reconciliation settlement evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_reconciliation_settlements_no_delete_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'SLH reconciliation settlement must begin ACTIVE' USING ERRCODE = '23514', CONSTRAINT = 'slh_reconciliation_settlements_status_check';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'SUPERSEDED'
    OR (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
    RAISE EXCEPTION 'SLH reconciliation settlement evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'slh_reconciliation_settlements_immutable_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER slh_reconciliation_settlements_lifecycle_trigger
BEFORE INSERT OR UPDATE OR DELETE ON slh_reconciliation_settlements
FOR EACH ROW EXECUTE FUNCTION enforce_slh_reconciliation_settlement_lifecycle();

-- 6) 外键：全部 Restrict（外部凭证与批次留痕都不得被级联删除）
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "slh_reconciliation_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_batch_line_id_fkey" FOREIGN KEY ("batch_line_id") REFERENCES "slh_reconciliation_batch_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "slh_bills"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_bill_line_id_fkey" FOREIGN KEY ("bill_line_id") REFERENCES "slh_bill_lines"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_loading_item_id_fkey" FOREIGN KEY ("loading_item_id") REFERENCES "container_loading_items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_container_batch_id_fkey" FOREIGN KEY ("container_batch_id") REFERENCES "container_batches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "slh_reconciliation_settlements" ADD CONSTRAINT "slh_reconciliation_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
