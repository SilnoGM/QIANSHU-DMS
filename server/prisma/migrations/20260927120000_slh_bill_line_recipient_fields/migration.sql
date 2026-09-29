-- 收货人信息解析结果三列。原文继续留在 recipient_info_raw（本迁移只加列，不改写历史数据；
-- 存量行的回填走 slh-bills:backfill-recipients 命令）。
ALTER TABLE "slh_bill_lines" ADD COLUMN     "recipient_address" VARCHAR(1000),
ADD COLUMN     "recipient_name" VARCHAR(200),
ADD COLUMN     "recipient_phones" VARCHAR(500);
