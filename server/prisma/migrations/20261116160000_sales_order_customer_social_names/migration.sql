BEGIN;

-- 销售单客户快照新增两个选填社交账号名称；只新增可空列，不回填、不改触发器。
ALTER TABLE "sales_orders"
  ADD COLUMN "customer_fb_name" VARCHAR(128),
  ADD COLUMN "customer_line_name" VARCHAR(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_orders' AND column_name = 'customer_fb_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales_orders' AND column_name = 'customer_line_name'
  ) THEN
    RAISE EXCEPTION 'sales order customer social name columns missing' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
