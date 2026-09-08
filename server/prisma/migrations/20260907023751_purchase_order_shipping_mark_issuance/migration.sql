BEGIN;

-- 历史采购唛头原样保留；关联只约束迁移后的新 INSERT，不回填、不重算或派发编号。
ALTER TABLE "purchase_orders" ADD COLUMN     "shipping_mark_issuance_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_shipping_mark_issuance_id_key" ON "purchase_orders"("shipping_mark_issuance_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shipping_mark_issuance_id_fkey" FOREIGN KEY ("shipping_mark_issuance_id") REFERENCES "numbering_issuances"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "enforce_purchase_order_shipping_mark_issuance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.shipping_mark_text IS DISTINCT FROM OLD.shipping_mark_text
    OR NEW.shipping_mark_issuance_id IS DISTINCT FROM OLD.shipping_mark_issuance_id
  ) THEN
    RAISE EXCEPTION 'Purchase order shipping mark is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_immutable_check';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.shipping_mark_issuance_id IS NULL THEN
    RAISE EXCEPTION 'New purchase order requires a shipping mark issuance'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_required_check';
  END IF;

  -- 旧订单只能沿用空关联；已有自动关联在后续更新中仍需保持请求身份一致。
  IF NEW.shipping_mark_issuance_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 编号规则用途和 ledger 都已有不可变守卫；不按当前启停/生效状态否定历史派发。
  PERFORM 1
  FROM "numbering_issuances" issuance
  JOIN "numbering_rules" rule ON rule.id = issuance.rule_id
  WHERE issuance.id = NEW.shipping_mark_issuance_id
    AND rule.purpose = 'SHIPPING_MARK'
    AND issuance.consumer_code = 'PURCHASE_ORDER.SHIPPING_MARK'
    AND issuance.idempotency_key_hash = NEW.create_idempotency_key_hash
    AND issuance.request_fingerprint_hash = NEW.create_request_fingerprint_hash
    AND issuance.generated_number = NEW.shipping_mark_text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order shipping mark issuance does not match'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_orders_shipping_mark_issuance_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "purchase_orders_shipping_mark_issuance_trigger"
  BEFORE INSERT OR UPDATE ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "enforce_purchase_order_shipping_mark_issuance"();

COMMIT;
