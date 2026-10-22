BEGIN;

-- 出单人前缀只用于采购单复制信息和采购单图片展示，不参与编号、派发或唛头派生。
ALTER TABLE "user_profiles"
  ADD COLUMN "issuer_prefix" VARCHAR(3);

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_issuer_prefix_check" CHECK (
    "issuer_prefix" IS NULL
    OR ("issuer_prefix" = btrim("issuer_prefix") AND char_length("issuer_prefix") BETWEEN 1 AND 3)
  );

COMMIT;
