BEGIN;

-- 原状态形状约束只列了 5 个状态；新增「补充付款码」后插入会被 CHECK 拒绝。
-- 这里重写同一约束：保留原 5 个分支不变，追加 PENDING_PAYMENT_CODE 分支。
--
-- 补充付款码阶段的字段形状与 PENDING 一致（未付款、未审核、未撤回、未作废），
-- 且 payer 侧字段必须全空；二维码此时必须为空——补码与状态流转在同一次 UPDATE 完成。
ALTER TABLE "advertising_recharge_requests"
  DROP CONSTRAINT "advertising_recharge_requests_status_shape_check";

ALTER TABLE "advertising_recharge_requests"
  ADD CONSTRAINT "advertising_recharge_requests_status_shape_check"
  CHECK (
    (
      "status" = 'PENDING'
      AND "payment_amount_cny" IS NULL
      AND "payment_proof_media_asset_id" IS NULL
      AND "paid_at" IS NULL
      AND "paid_by_user_id" IS NULL
      AND "fund_posting_batch_id" IS NULL
      AND "reviewed_at" IS NULL
      AND "reviewed_by_user_id" IS NULL
      AND "reject_reason" IS NULL
      AND "withdrawn_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by_user_id" IS NULL
      AND "void_reason" IS NULL
      AND "fund_reversal_batch_id" IS NULL
    )
    OR (
      "status" = 'PENDING_PAYMENT_CODE'
      AND "payment_qr_media_asset_id" IS NULL
      AND "payment_amount_cny" IS NULL
      AND "payment_proof_media_asset_id" IS NULL
      AND "paid_at" IS NULL
      AND "paid_by_user_id" IS NULL
      AND "fund_posting_batch_id" IS NULL
      AND "reviewed_at" IS NULL
      AND "reviewed_by_user_id" IS NULL
      AND "reject_reason" IS NULL
      AND "withdrawn_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by_user_id" IS NULL
      AND "void_reason" IS NULL
      AND "fund_reversal_batch_id" IS NULL
    )
    OR (
      "status" = 'PAID'
      AND "payment_amount_cny" IS NOT NULL
      AND "payment_proof_media_asset_id" IS NOT NULL
      AND "paid_at" IS NOT NULL
      AND "paid_by_user_id" IS NOT NULL
      AND "fund_posting_batch_id" IS NOT NULL
      AND "reviewed_at" IS NULL
      AND "reviewed_by_user_id" IS NULL
      AND "reject_reason" IS NULL
      AND "withdrawn_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by_user_id" IS NULL
      AND "void_reason" IS NULL
      AND "fund_reversal_batch_id" IS NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "payment_amount_cny" IS NULL
      AND "payment_proof_media_asset_id" IS NULL
      AND "paid_at" IS NULL
      AND "paid_by_user_id" IS NULL
      AND "fund_posting_batch_id" IS NULL
      AND "reviewed_at" IS NOT NULL
      AND "reviewed_by_user_id" IS NOT NULL
      AND "reject_reason" IS NOT NULL
      AND "withdrawn_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by_user_id" IS NULL
      AND "void_reason" IS NULL
      AND "fund_reversal_batch_id" IS NULL
    )
    OR (
      "status" = 'WITHDRAWN'
      AND "payment_amount_cny" IS NULL
      AND "payment_proof_media_asset_id" IS NULL
      AND "paid_at" IS NULL
      AND "paid_by_user_id" IS NULL
      AND "fund_posting_batch_id" IS NULL
      AND "reviewed_at" IS NULL
      AND "reviewed_by_user_id" IS NULL
      AND "reject_reason" IS NULL
      AND "withdrawn_at" IS NOT NULL
      AND "voided_at" IS NULL
      AND "voided_by_user_id" IS NULL
      AND "void_reason" IS NULL
      AND "fund_reversal_batch_id" IS NULL
    )
    OR (
      "status" = 'VOIDED'
      AND "payment_amount_cny" IS NOT NULL
      AND "payment_proof_media_asset_id" IS NOT NULL
      AND "paid_at" IS NOT NULL
      AND "paid_by_user_id" IS NOT NULL
      AND "fund_posting_batch_id" IS NOT NULL
      AND "reviewed_at" IS NULL
      AND "reviewed_by_user_id" IS NULL
      AND "reject_reason" IS NULL
      AND "withdrawn_at" IS NULL
      AND "voided_at" IS NOT NULL
      AND "voided_by_user_id" IS NOT NULL
      AND "void_reason" IS NOT NULL
      AND "fund_reversal_batch_id" IS NOT NULL
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
  WHERE conname = 'advertising_recharge_requests_status_shape_check'
    AND conrelid = 'advertising_recharge_requests'::regclass;

  IF definition IS NULL THEN
    RAISE EXCEPTION 'advertising recharge status shape migration invariant mismatch: constraint missing';
  END IF;

  IF definition NOT LIKE '%PENDING_PAYMENT_CODE%' THEN
    RAISE EXCEPTION 'advertising recharge status shape migration invariant mismatch: payment code branch missing';
  END IF;

  IF definition NOT LIKE '%VOIDED%' OR definition NOT LIKE '%WITHDRAWN%' OR definition NOT LIKE '%PAID%' THEN
    RAISE EXCEPTION 'advertising recharge status shape migration invariant mismatch: legacy branches lost';
  END IF;
END;
$$;

COMMIT;
