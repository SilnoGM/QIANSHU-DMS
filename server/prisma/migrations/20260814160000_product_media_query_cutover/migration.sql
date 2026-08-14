BEGIN;

-- 锁住 Product 表后再计数，避免预检通过与 DROP 之间出现并发旧 URL 写入。
LOCK TABLE "products" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  main_image_count bigint;
  images_count bigint;
  videos_count bigint;
  sample_product_ids text;
BEGIN
  SELECT
    count(*) FILTER (WHERE "main_image" IS NOT NULL),
    count(*) FILTER (WHERE COALESCE(cardinality("images"), 0) > 0),
    count(*) FILTER (WHERE COALESCE(cardinality("videos"), 0) > 0)
  INTO main_image_count, images_count, videos_count
  FROM "products";

  SELECT COALESCE(string_agg(sample."id"::text, ',' ORDER BY sample."id"), 'none')
  INTO sample_product_ids
  FROM (
    SELECT "id"
    FROM "products"
    WHERE "main_image" IS NOT NULL
      OR COALESCE(cardinality("images"), 0) > 0
      OR COALESCE(cardinality("videos"), 0) > 0
    ORDER BY "id"
    LIMIT 10
  ) AS sample;

  IF main_image_count <> 0 OR images_count <> 0 OR videos_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'product media cutover blocked: main_image_count=%s images_count=%s videos_count=%s sample_product_ids=%s',
        main_image_count,
        images_count,
        videos_count,
        sample_product_ids
      );
  END IF;
END;
$$;

ALTER TABLE "products"
DROP COLUMN "main_image",
DROP COLUMN "images",
DROP COLUMN "videos";

COMMIT;
