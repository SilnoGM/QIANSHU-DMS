BEGIN;

-- 批量付款只需上传一张截图，同一资产按批归档到多笔付款。
-- 数据库兜底从「凭证必须绑定当前应付款」放宽为「同一操作人上传的已归档付款截图」，
-- 具体批次范围由 payBatch 事务内的 payable 归属校验保证；单笔付款仍由应用层要求阶段独占。
CREATE OR REPLACE FUNCTION enforce_purchase_payment_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.recipient_snapshot IS NULL OR NOT EXISTS (
    SELECT 1 FROM purchase_order_documents d JOIN media_assets m ON m.id = d.media_asset_id
    WHERE d.payment_id = NEW.id AND d.purchase_order_id = NEW.purchase_order_id
      AND d.document_type = 'PAYMENT_VOUCHER' AND d.detached_at IS NULL
      AND m.media_type = 'IMAGE' AND m.status = 'READY' AND m.deleted_at IS NULL
      AND m.upload_purpose = 'PURCHASE_PAYMENT_VOUCHER' AND m.created_by_user_id = NEW.created_by_user_id
  ) OR (SELECT count(*) FROM purchase_order_documents WHERE payment_id = NEW.id AND document_type = 'PAYMENT_VOUCHER' AND detached_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Purchase payment requires exactly one archived screenshot'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_payment_voucher_required_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 自检：函数必须已去掉「绑定当前应付款」的条件，并改为校验上传人一致。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_purchase_payment_voucher'
      AND prosrc LIKE '%purchase_payable_upload_id = NEW.payable_id%'
  ) THEN
    RAISE EXCEPTION 'purchase payment voucher trigger still pins the payable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'enforce_purchase_payment_voucher'
      AND prosrc LIKE '%created_by_user_id = NEW.created_by_user_id%'
  ) THEN
    RAISE EXCEPTION 'purchase payment voucher trigger is missing the uploader check';
  END IF;
END;
$$;

COMMIT;
