-- 金额修改与旧金额同时留痕；新增枚举不改变任何历史审计。
ALTER TYPE "audit_event_type" ADD VALUE 'PACKAGING_COST_AMOUNT_UPDATED';

-- 待付款允许累计改价版本；identity 触发器继续强制每次只递增一版，付款信息仍随状态成组出现。
ALTER TABLE packaging_cost_requests
  DROP CONSTRAINT packaging_cost_requests_state_check,
  ADD CONSTRAINT packaging_cost_requests_state_check CHECK (
    (status = 'PENDING_PAYMENT' AND paid_by_user_id IS NULL AND paid_at IS NULL AND version >= 1)
    OR (status = 'PAID' AND paid_by_user_id IS NOT NULL AND paid_at IS NOT NULL AND version >= 2)
  );

CREATE OR REPLACE FUNCTION enforce_packaging_cost_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Packaging cost evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING_PAYMENT' OR NEW.version <> 1 OR NEW.paid_at IS NOT NULL OR NEW.paid_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Packaging cost must begin pending payment' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_state_check';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM purchase_order_parts part
      JOIN purchase_orders purchase ON purchase.id = part.purchase_order_id
      JOIN sales_orders sale ON sale.id = purchase.sales_order_id
      WHERE part.id = NEW.shipment_id AND part.status = 'ACTIVE'
        AND part.shipped_at IS NOT NULL AND part.warehouse_received_at IS NOT NULL
        AND purchase.order_status IN ('CONFIRMED', 'COMPLETED')
        AND part.shipment_no = NEW.shipment_no AND part.shipping_mark_text = NEW.shipping_mark_text
        AND purchase.id = NEW.purchase_order_id AND purchase.order_no = NEW.purchase_order_no
        AND sale.id = NEW.sales_order_id AND sale.order_no = NEW.sales_order_no AND sale.issuer_user_id = NEW.owner_user_id
    ) THEN
      RAISE EXCEPTION 'Packaging cost requires an arrived shipment and its sales identity' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_source_check';
    END IF;
  ELSIF OLD.status = 'PENDING_PAYMENT' AND NEW.status = 'PENDING_PAYMENT' THEN
    -- 待付款只允许改金额并递增一次版本；来源、凭证、归属人及提交幂等指纹仍全部锁定。
    IF NEW.version <> OLD.version + 1 OR NEW.amount IS NOT DISTINCT FROM OLD.amount
      OR (to_jsonb(NEW) - ARRAY['amount','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['amount','version','updated_at']) THEN
      RAISE EXCEPTION 'Only pending packaging amount may be corrected' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
    END IF;
    RETURN NEW;
  ELSIF OLD.status <> 'PENDING_PAYMENT' OR NEW.status <> 'PAID' OR NEW.version <> OLD.version + 1
    OR (to_jsonb(NEW) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at','recipient_snapshot','recipient_qr_media_asset_id','payment_voucher_media_asset_id','payment_remark','payment_fingerprint_hash']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','paid_by_user_id','paid_at','version','updated_at','recipient_snapshot','recipient_qr_media_asset_id','payment_voucher_media_asset_id','payment_remark','payment_fingerprint_hash']) THEN
    RAISE EXCEPTION 'Packaging cost evidence is immutable' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_requests_immutable_check';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.recipient_snapshot IS NULL OR NEW.recipient_qr_media_asset_id IS NULL OR NEW.payment_voucher_media_asset_id IS NULL OR NEW.payment_fingerprint_hash IS NULL) THEN
    RAISE EXCEPTION 'Packaging payment requires recipient and voucher evidence' USING ERRCODE = '23514', CONSTRAINT = 'packaging_cost_payment_required_check';
  END IF;
  RETURN NEW;
END $$;
