BEGIN;

-- 产品备注：可选长文本，空值表示没有备注；非空时不允许纯空白。
ALTER TABLE "products"
  ADD COLUMN "remark" VARCHAR(512);

ALTER TABLE "products"
  ADD CONSTRAINT "products_remark_nonblank_check"
  CHECK ("remark" IS NULL OR btrim("remark") <> '');

COMMIT;
