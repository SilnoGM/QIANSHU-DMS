/**
 * 只更新台湾三级节点的名称和名称索引；固定 code 与父级链共同限定范围，
 * 保留现有 UUID、排序、启用状态及业务外键。名称已经一致时不刷新 updated_at。
 */
export function serializeTaiwanTraditionalNamesMigration(seed) {
  const cities = seed.regions.filter(region => region.level === 'CITY' && region.code.startsWith('TW-'))
  if (cities.length !== 22 || cities.some(city => city.name !== city.sourceName)) {
    throw new Error('Taiwan migration requires 22 official traditional county names')
  }
  const literal = value => `'${value.replaceAll("'", "''")}'`
  const rows = cities.map(city => `  (${literal(city.code)}, ${literal(city.name)})`).join(',\n')
  return `BEGIN;

-- 由固定 ListCounty 快照生成；只调整中国台湾的三级县市，不修改历史地址快照。
-- 先锁定地区表，防止校验后被并发修改层级或制造同名冲突。
LOCK TABLE "regions" IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "taiwan_traditional_names" (
  "code" text PRIMARY KEY,
  "name" text NOT NULL
) ON COMMIT DROP;

INSERT INTO "taiwan_traditional_names" ("code", "name") VALUES
${rows};

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
`
}
