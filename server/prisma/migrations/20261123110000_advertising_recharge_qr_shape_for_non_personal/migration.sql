BEGIN;

-- 原约束写死「个人户必须有码、非个人户必须无码」；新流程允许非个人户在补码后带码。
-- 放宽后仍然保留两条硬约束：
--   1) 个人户创建即必须带收款二维码（原规则不变）；
--   2) 非个人户在「补充付款码」阶段二维码必须为空——补码与状态流转同一次 UPDATE 完成。
ALTER TABLE "advertising_recharge_requests"
  DROP CONSTRAINT "advertising_recharge_requests_qr_shape_check";

ALTER TABLE "advertising_recharge_requests"
  ADD CONSTRAINT "advertising_recharge_requests_qr_shape_check"
  CHECK (
    ("account_type" = 'PERSONAL' AND "payment_qr_media_asset_id" IS NOT NULL)
    OR (
      "account_type" = 'NON_PERSONAL'
      AND (
        "status" <> 'PENDING_PAYMENT_CODE'
        OR "payment_qr_media_asset_id" IS NULL
      )
    )
  );

-- MigrationSelfCheck
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO definition
  FROM pg_constraint
  WHERE conname = 'advertising_recharge_requests_qr_shape_check'
    AND conrelid = 'advertising_recharge_requests'::regclass;

  IF definition IS NULL THEN
    RAISE EXCEPTION 'advertising recharge qr shape migration invariant mismatch: constraint missing';
  END IF;

  IF definition NOT LIKE '%PENDING_PAYMENT_CODE%' THEN
    RAISE EXCEPTION 'advertising recharge qr shape migration invariant mismatch: payment code guard missing';
  END IF;

  IF definition NOT LIKE '%PERSONAL%' OR definition NOT LIKE '%NON_PERSONAL%' THEN
    RAISE EXCEPTION 'advertising recharge qr shape migration invariant mismatch: account type branches lost';
  END IF;
END;
$$;

COMMIT;
