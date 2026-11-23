BEGIN;

-- 非个人户补码流程要求放开两条历史约束：
-- 1) 状态机新增 PENDING_PAYMENT_CODE → PENDING 一条边；
-- 2) 承担「一次性回填收款二维码」——仅限这条边、仅限 NULL → 有值。
-- 其余字段的可变性与既有流转保持不变。
CREATE OR REPLACE FUNCTION "enforce_advertising_recharge_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'advertising recharge requests are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_immutable_check';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."recharge_no" IS DISTINCT FROM OLD."recharge_no"
    OR NEW."numbering_issuance_id" IS DISTINCT FROM OLD."numbering_issuance_id"
    OR NEW."applicant_user_id" IS DISTINCT FROM OLD."applicant_user_id"
    OR NEW."account_type" IS DISTINCT FROM OLD."account_type"
    OR NEW."ad_account_name" IS DISTINCT FROM OLD."ad_account_name"
    OR NEW."ad_account_no" IS DISTINCT FROM OLD."ad_account_no"
    OR NEW."recharge_amount" IS DISTINCT FROM OLD."recharge_amount"
    OR NEW."recharge_currency" IS DISTINCT FROM OLD."recharge_currency"
    OR (
      NEW."payment_qr_media_asset_id" IS DISTINCT FROM OLD."payment_qr_media_asset_id"
      AND NOT (
        OLD."status" = 'PENDING_PAYMENT_CODE'
        AND NEW."status" = 'PENDING'
        AND OLD."payment_qr_media_asset_id" IS NULL
        AND NEW."payment_qr_media_asset_id" IS NOT NULL
      )
    )
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
    OR NEW."request_key_hash" IS DISTINCT FROM OLD."request_key_hash"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'advertising recharge request identity is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_identity_immutable_check';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'advertising recharge request version must advance by one'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_version_step_check';
  END IF;

  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('PAID', 'REJECTED', 'WITHDRAWN'))
    OR (OLD."status" = 'PENDING_PAYMENT_CODE' AND NEW."status" = 'PENDING')
    OR (OLD."status" = 'PAID' AND NEW."status" = 'VOIDED')
  ) THEN
    RAISE EXCEPTION 'advertising recharge request transition is not allowed'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_transition_check';
  END IF;

  -- 补码完成才能进入待付款：不允许空着二维码直接流转。
  IF OLD."status" = 'PENDING_PAYMENT_CODE'
    AND NEW."status" = 'PENDING'
    AND NEW."payment_qr_media_asset_id" IS NULL
  THEN
    RAISE EXCEPTION 'advertising recharge payment code is required'
      USING ERRCODE = '23514',
            CONSTRAINT = 'advertising_recharge_requests_payment_code_check';
  END IF;

  -- 已付款后的唯一变更就是作废；不允许在 VOIDED 上再改金额或冲正批次。
  IF OLD."status" = 'PAID' AND NEW."status" = 'VOIDED' THEN
    IF NEW."payment_amount_cny" IS DISTINCT FROM OLD."payment_amount_cny"
      OR NEW."payment_proof_media_asset_id" IS DISTINCT FROM OLD."payment_proof_media_asset_id"
      OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
      OR NEW."paid_by_user_id" IS DISTINCT FROM OLD."paid_by_user_id"
      OR NEW."fund_posting_batch_id" IS DISTINCT FROM OLD."fund_posting_batch_id"
    THEN
      RAISE EXCEPTION 'voiding must not change recorded payment facts'
        USING ERRCODE = '23514',
              CONSTRAINT = 'advertising_recharge_requests_void_identity_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- MigrationSelfCheck
DO $$
DECLARE
  function_body text;
BEGIN
  SELECT pg_get_functiondef('enforce_advertising_recharge_transition'::regproc)
  INTO function_body;

  IF function_body NOT LIKE '%PENDING_PAYMENT_CODE%' THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: transition edge missing';
  END IF;

  IF function_body NOT LIKE '%advertising_recharge_requests_payment_code_check%' THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: payment code guard missing';
  END IF;

  IF function_body NOT LIKE '%OLD."status" = ''PENDING'' AND NEW."status" IN (''PAID'', ''REJECTED'', ''WITHDRAWN'')%' THEN
    RAISE EXCEPTION 'advertising recharge payment code migration invariant mismatch: legacy edges lost';
  END IF;
END;
$$;

COMMIT;
