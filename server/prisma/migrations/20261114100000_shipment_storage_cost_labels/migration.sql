-- 寄仓两跳成本流水（退还 / 转入）的历史来源投影按承担客户重写。
--
-- 背景：写入侧此前两个方向都取寄仓记录冻结的原客户名，且动作叫「寄仓成本转出 / 调货成本转入」，
-- 导致一笔入账配「转出」、调入方被收成本却仍显示原客户。新写入已改为
-- 「原客户 · 寄仓货物成本退还」与「调入客户 · 调寄仓货物成本转入」，本迁移把历史行对齐。
--
-- 只更新派生投影 fund_posting_batch_sources；fund_posting_batches 不可变，summary 与
-- posting_type_name_snapshot 保持历史原值（关键词检索仍能按旧词命中）。
-- 语句可重复执行：动作词已是新值、detail 已含「调入销售单」的行不会被重复改写。

UPDATE "fund_posting_batch_sources" AS s
SET
  "headline" = CASE
    WHEN s."headline" LIKE '%寄仓成本转出'
      THEN left(s."headline", char_length(s."headline") - char_length('寄仓成本转出')) || '寄仓货物成本退还'
    WHEN s."headline" LIKE '%调货成本转入'
      THEN left(s."headline", char_length(s."headline") - char_length('调货成本转入')) || '调寄仓货物成本转入'
    ELSE s."headline"
  END,
  "action_label" = CASE b."posting_type_code_snapshot"
    WHEN 'SHIPMENT_STORAGE_RELEASE' THEN '寄仓货物成本退还'
    ELSE '调寄仓货物成本转入'
  END,
  -- 退还主体是原客户；转入主体是认领后的销售单客户，记录未被认领时才回退原客户。
  "subject_name" = CASE b."posting_type_code_snapshot"
    WHEN 'SHIPMENT_STORAGE_RELEASE' THEN r."origin_customer_name_snapshot"
    ELSE COALESCE(co."customer_name", r."origin_customer_name_snapshot")
  END,
  "customer_name" = CASE b."posting_type_code_snapshot"
    WHEN 'SHIPMENT_STORAGE_RELEASE' THEN r."origin_customer_name_snapshot"
    ELSE COALESCE(co."customer_name", r."origin_customer_name_snapshot")
  END,
  "detail" = CASE
    WHEN jsonb_typeof(s."detail") <> 'array' OR jsonb_array_length(s."detail") = 0
      THEN s."detail"
    ELSE COALESCE((
      SELECT jsonb_agg(x.item ORDER BY x.ord, x.sub)
      FROM (
        SELECT
          t.ord,
          0 AS sub,
          CASE
            WHEN jsonb_typeof(t.e) = 'object' AND t.e ->> 'label' = '成本方向'
              THEN jsonb_set(t.e, '{value}', to_jsonb(
                CASE b."posting_type_code_snapshot"
                  WHEN 'SHIPMENT_STORAGE_RELEASE' THEN '退还（入账）'
                  ELSE '转入（出账）'
                END
              ))
            ELSE t.e
          END AS item
        FROM jsonb_array_elements(s."detail") WITH ORDINALITY AS t(e, ord)
        UNION ALL
        -- 认领行补「调入销售单」，插在原销售单之后；已存在时不重复插入。
        SELECT
          t.ord,
          1,
          jsonb_build_object('label', '调入销售单', 'value', co."order_no")
        FROM jsonb_array_elements(s."detail") WITH ORDINALITY AS t(e, ord)
        WHERE t.e ->> 'label' = '原销售单'
          AND b."posting_type_code_snapshot" <> 'SHIPMENT_STORAGE_RELEASE'
          AND co."order_no" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(s."detail") AS existing
            WHERE existing ->> 'label' = '调入销售单'
          )
      ) AS x
    ), s."detail")
  END
FROM "fund_posting_batches" AS b
JOIN "shipment_storage_records" AS r ON r."id"::text = b."business_id"
LEFT JOIN "sales_orders" AS co ON co."id" = r."claimed_sales_order_id"
WHERE s."batch_id" = b."id"
  AND s."source_kind" = 'SHIPMENT_STORAGE'
  AND b."business_source_code_snapshot" = 'SHIPMENT_STORAGE';

-- 失败关闭：任一寄仓成本行仍是旧动作词或缺少主体，说明更新条件与投影形状不一致。
DO $$
DECLARE
  stale_labels integer;
  missing_subjects integer;
BEGIN
  SELECT count(*) INTO stale_labels
  FROM "fund_posting_batch_sources" AS s
  WHERE s."source_kind" = 'SHIPMENT_STORAGE'
    AND s."action_label" IN ('寄仓成本转出', '调货成本转入');

  IF stale_labels > 0 THEN
    RAISE EXCEPTION 'shipment storage cost labels remain stale: %', stale_labels;
  END IF;

  SELECT count(*) INTO missing_subjects
  FROM "fund_posting_batch_sources" AS s
  WHERE s."source_kind" = 'SHIPMENT_STORAGE'
    AND s."subject_name" IS NULL;

  IF missing_subjects > 0 THEN
    RAISE EXCEPTION 'shipment storage cost subjects remain empty: %', missing_subjects;
  END IF;
END;
$$;
