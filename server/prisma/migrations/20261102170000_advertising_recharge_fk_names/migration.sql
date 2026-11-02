-- 20261102160000 的两个媒体外键沿用了列名缩写（qr/proof），与 Prisma 按字段名
-- （paymentQrMediaAssetId / paymentProofMediaAssetId）推导的约束名不一致，
-- `prisma migrate diff` 会把它们报成重命名漂移。这里只改约束名，不改列、不改数据。
ALTER TABLE "advertising_recharge_requests"
  RENAME CONSTRAINT "advertising_recharge_requests_qr_media_asset_id_fkey"
  TO "advertising_recharge_requests_payment_qr_media_asset_id_fkey";

ALTER TABLE "advertising_recharge_requests"
  RENAME CONSTRAINT "advertising_recharge_requests_proof_media_asset_id_fkey"
  TO "advertising_recharge_requests_payment_proof_media_asset_id_fkey";

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
      WHERE conname IN (
        'advertising_recharge_requests_payment_qr_media_asset_id_fkey',
        'advertising_recharge_requests_payment_proof_media_asset_id_fkey'
      )) <> 2
    OR EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname IN (
        'advertising_recharge_requests_qr_media_asset_id_fkey',
        'advertising_recharge_requests_proof_media_asset_id_fkey'
      )
    )
  THEN
    RAISE EXCEPTION 'advertising recharge foreign key rename failed';
  END IF;
END;
$$;
