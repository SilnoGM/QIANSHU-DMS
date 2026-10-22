-- 已签收是终态：任何新增或换绑装柜关联都必须被拒绝。
-- 本迁移只收紧现有「货件不可跨柜」触发器，不修改存量数据；已有关联的普通字段编辑
-- 仍由触发器开头的「同一货件、同一柜次直接放行」分支保持可编辑。
CREATE OR REPLACE FUNCTION enforce_container_loading_shipment_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipment_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.shipment_id IS NOT DISTINCT FROM OLD.shipment_id
      AND NEW.container_batch_id = OLD.container_batch_id THEN RETURN NEW; END IF;
  -- REPEATABLE READ 的旧快照在等待锁后仍看不到其他柜次已提交的分配；此命令不得使用该隔离级别。
  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'Shipment allocation requires read committed or serializable isolation'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_isolation_check';
  END IF;
  PERFORM id FROM purchase_order_parts WHERE id = NEW.shipment_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM purchase_order_parts WHERE id = NEW.shipment_id AND delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Delivered shipment cannot be loaded'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_delivered_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_order_parts WHERE id = NEW.shipment_id AND loaded_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Shipment must record the container loading fact before allocation'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_loaded_check';
  END IF;
  IF EXISTS (SELECT 1 FROM container_loading_items WHERE shipment_id = NEW.shipment_id
      AND container_batch_id <> NEW.container_batch_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'Shipment cannot be split across container batches'
      USING ERRCODE = '23514', CONSTRAINT = 'container_loading_items_shipment_same_batch_check';
  END IF;
  RETURN NEW;
END;
$$;

-- 结构自校验：签收列不存在或覆盖函数没有落库时整单回滚。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'purchase_order_parts' AND column_name = 'delivered_at') THEN
    RAISE EXCEPTION 'Shipment delivery column missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_container_loading_shipment_batch'
      AND pg_get_functiondef(p.oid) LIKE '%container_loading_items_shipment_delivered_check%') THEN
    RAISE EXCEPTION 'Delivered shipment guard is missing' USING ERRCODE = '23514';
  END IF;
END $$;
