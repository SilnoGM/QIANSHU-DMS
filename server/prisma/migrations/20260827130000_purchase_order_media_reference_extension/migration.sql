BEGIN;

-- 采购凭证加入通用媒体引用闭包后，READY 资产的持有关系必须由三个已实现领域共同判定。
-- 这里采用向前修复，不回写已经提交的采购订单主 migration。
CREATE OR REPLACE FUNCTION "enforce_ready_media_asset_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_asset_id UUID;
  current_status "media_asset_status";
BEGIN
  IF TG_TABLE_NAME = 'media_assets' THEN
    reference_asset_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    reference_asset_id := OLD."media_asset_id";
  ELSE
    reference_asset_id := NEW."media_asset_id";
  END IF;

  SELECT asset."status"
  INTO current_status
  FROM "media_assets" AS asset
  WHERE asset."id" = reference_asset_id;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF current_status = 'READY'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_media" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "purchase_order_documents" AS reference
      WHERE reference."media_asset_id" = reference_asset_id
        AND reference."detached_at" IS NULL
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'READY media asset requires an active domain reference',
      CONSTRAINT = 'media_assets_ready_reference_check';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 主 migration 的专用 Trigger 先保证资产 READY；本次向前修复将同名 Trigger
-- 切换到通用引用闭包，避免采购凭证解除后留下无领域持有者的 READY 资产。
DROP TRIGGER "purchase_order_documents_ready_reference_trigger"
  ON "purchase_order_documents";
DROP FUNCTION "enforce_purchase_order_document_ready_reference"();

CREATE CONSTRAINT TRIGGER "purchase_order_documents_ready_reference_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "purchase_order_documents"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_ready_media_asset_reference"();

COMMIT;
