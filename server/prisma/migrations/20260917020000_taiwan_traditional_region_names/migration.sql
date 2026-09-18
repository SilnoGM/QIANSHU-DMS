BEGIN;

-- 由固定 ListCounty 快照生成；只调整中国台湾的三级县市，不修改历史地址快照。
-- 先锁定地区表，防止校验后被并发修改层级或制造同名冲突。
LOCK TABLE "regions" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "taiwan_traditional_names" (
  "code" text PRIMARY KEY,
  "name" text NOT NULL
) ON COMMIT DROP;

INSERT INTO "taiwan_traditional_names" ("code", "name") VALUES
  ('TW-09007', '連江縣'),
  ('TW-09020', '金門縣'),
  ('TW-10002', '宜蘭縣'),
  ('TW-10004', '新竹縣'),
  ('TW-10005', '苗栗縣'),
  ('TW-10007', '彰化縣'),
  ('TW-10008', '南投縣'),
  ('TW-10009', '雲林縣'),
  ('TW-10010', '嘉義縣'),
  ('TW-10013', '屏東縣'),
  ('TW-10014', '臺東縣'),
  ('TW-10015', '花蓮縣'),
  ('TW-10016', '澎湖縣'),
  ('TW-10017', '基隆市'),
  ('TW-10018', '新竹市'),
  ('TW-10020', '嘉義市'),
  ('TW-63000', '臺北市'),
  ('TW-64000', '高雄市'),
  ('TW-65000', '新北市'),
  ('TW-66000', '臺中市'),
  ('TW-67000', '臺南市'),
  ('TW-68000', '桃園市');

DO $taiwan_names$
BEGIN
  IF (
    SELECT count(*)
    FROM "regions" city
    JOIN "regions" province ON province."id" = city."parent_id"
    JOIN "regions" country ON country."id" = province."parent_id"
    JOIN "taiwan_traditional_names" names ON names."code" = city."code"
    WHERE city."level" = 'CITY'
      AND province."code" = 'TW-TAIWAN' AND province."level" = 'PROVINCE_STATE'
      AND country."code" = 'TW' AND country."level" = 'COUNTRY_REGION'
  ) <> 22 THEN
    RAISE EXCEPTION 'Taiwan county hierarchy does not match the expected 22 cities';
  END IF;
END;
$taiwan_names$;

UPDATE "regions" city
SET "name" = names."name",
    "normalized_name" = names."name",
    "updated_at" = CURRENT_TIMESTAMP
FROM "taiwan_traditional_names" names
WHERE city."code" = names."code"
  AND (city."name" IS DISTINCT FROM names."name"
    OR city."normalized_name" IS DISTINCT FROM names."name");

COMMIT;
