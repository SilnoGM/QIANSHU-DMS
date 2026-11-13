BEGIN;

-- 误建采购链纠正：把同一销售单下的错误采购链退回待采购。
-- 采购单、货件、付款、归属事件和审计全部保留为历史事实；只清空可撤销的物流事实。
ALTER TYPE "packaging_cost_status" ADD VALUE 'CANCELLED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_ORDER_CORRECTION_APPLIED';
ALTER TYPE "audit_event_type" ADD VALUE 'PACKAGING_COST_CANCELLED';

CREATE TABLE "purchase_chain_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sales_order_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "request_key" UUID NOT NULL,
  "payload_hash" BYTEA NOT NULL,
  "result_snapshot" JSONB,
  "applied_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "purchase_chain_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_chain_corrections_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "purchase_chain_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE "purchase_chain_correction_orders" (
  "correction_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  CONSTRAINT "purchase_chain_correction_orders_pkey" PRIMARY KEY ("correction_id", "purchase_order_id"),
  CONSTRAINT "purchase_chain_correction_orders_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "purchase_chain_corrections"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "purchase_chain_correction_orders_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "purchase_chain_corrections_actor_request_key" ON "purchase_chain_corrections"("actor_user_id", "request_key");
CREATE UNIQUE INDEX "purchase_chain_corrections_sales_order_active_key" ON "purchase_chain_corrections"("sales_order_id") WHERE "applied_at" IS NULL;
CREATE INDEX "purchase_chain_corrections_sales_order_created_idx" ON "purchase_chain_corrections"("sales_order_id", "created_at" DESC);
CREATE INDEX "purchase_chain_correction_orders_purchase_idx" ON "purchase_chain_correction_orders"("purchase_order_id");

-- 货件事实不可变的唯一例外：纠正记录存在时，允许一次性清空发货与到仓事实。
-- 装柜事实必须先走既有解绑路径清空；签收事实在 V1（未签收）不存在，因此本分支
-- 要求 loaded_at / delivered_at 均为空，避免借纠正绕过装柜和签收保护。
CREATE OR REPLACE FUNCTION "reject_purchase_order_part_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_mark TEXT; has_multiple_parts BOOLEAN; parent_status TEXT;
BEGIN
  -- 保留一次补码及不可变配置保护，只开放与父采购单一致的货件生命周期。
  IF TG_TABLE_NAME = 'purchase_order_parts' AND TG_OP = 'UPDATE' THEN
    -- 入仓事实只允许已发有效货件一次写入；不能借此变更发货、编号、唛头或分配。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE' AND OLD.shipped_at IS NOT NULL
      AND OLD.warehouse_received_at IS NULL AND OLD.warehouse_received_by_id IS NULL
      AND OLD.warehouse_recorded_at IS NULL AND OLD.warehouse_remark IS NULL
      AND NEW.warehouse_received_at IS NOT NULL AND NEW.warehouse_received_by_id IS NOT NULL
      AND NEW.warehouse_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
        = (to_jsonb(OLD) - ARRAY['warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
      AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id
        AND order_status = 'CONFIRMED' AND fulfillment_status IN ('PARTIALLY_SHIPPED', 'SHIPPED'))
    THEN RETURN NEW; END IF;
    -- 装柜事实只允许一次写入：由装柜明细的服务端事务在关联前写入，之后不可改写。
    IF OLD.loaded_at IS NULL AND OLD.loaded_by_id IS NULL AND OLD.loaded_recorded_at IS NULL
      AND NEW.loaded_at IS NOT NULL AND NEW.loaded_by_id IS NOT NULL AND NEW.loaded_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
        = (to_jsonb(OLD) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
    THEN RETURN NEW; END IF;
    -- 撤销装柜事实只允许一次受控清空：解绑最后一条明细后货件退回已到仓。
    -- 未签收是硬条件（签收 CHECK 要求 loaded_at 非空），且必须已无任何装柜明细；
    -- 其余列保持不变，避免借撤销事实改写发货、入仓或分配信息。
    IF OLD.loaded_at IS NOT NULL AND OLD.loaded_by_id IS NOT NULL AND OLD.loaded_recorded_at IS NOT NULL
      AND OLD.delivered_at IS NULL AND OLD.delivered_by_id IS NULL
      AND OLD.delivered_recorded_at IS NULL AND OLD.delivery_remark IS NULL
      AND NEW.loaded_at IS NULL AND NEW.loaded_by_id IS NULL AND NEW.loaded_recorded_at IS NULL
      AND (to_jsonb(NEW) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
        = (to_jsonb(OLD) - ARRAY['loaded_at', 'loaded_by_id', 'loaded_recorded_at'])
      AND NOT EXISTS (SELECT 1 FROM container_loading_items WHERE shipment_id = OLD.id)
    THEN RETURN NEW; END IF;
    -- 误建采购链纠正：只允许在纠正记录存在时一次性清空发货与到仓事实。
    -- 装柜事实必须已经通过解绑清空，签收事实必须不存在；其余列保持不变。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.loaded_at IS NULL AND OLD.loaded_by_id IS NULL AND OLD.loaded_recorded_at IS NULL
      AND OLD.delivered_at IS NULL AND OLD.delivered_by_id IS NULL
      AND OLD.delivered_recorded_at IS NULL AND OLD.delivery_remark IS NULL
      AND NEW.loaded_at IS NULL AND NEW.loaded_by_id IS NULL AND NEW.loaded_recorded_at IS NULL
      AND NEW.delivered_at IS NULL AND NEW.delivered_by_id IS NULL
      AND NEW.delivered_recorded_at IS NULL AND NEW.delivery_remark IS NULL
      AND (OLD.shipped_at IS NOT NULL OR OLD.shipped_by_id IS NOT NULL
        OR OLD.shipment_recorded_at IS NOT NULL OR OLD.shipment_remark IS NOT NULL
        OR OLD.warehouse_received_at IS NOT NULL OR OLD.warehouse_received_by_id IS NOT NULL
        OR OLD.warehouse_recorded_at IS NOT NULL OR OLD.warehouse_remark IS NOT NULL)
      AND NEW.shipped_at IS NULL AND NEW.shipped_by_id IS NULL
      AND NEW.shipment_recorded_at IS NULL AND NEW.shipment_remark IS NULL
      AND NEW.warehouse_received_at IS NULL AND NEW.warehouse_received_by_id IS NULL
      AND NEW.warehouse_recorded_at IS NULL AND NEW.warehouse_remark IS NULL
      AND (to_jsonb(NEW) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
        = (to_jsonb(OLD) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'warehouse_received_at', 'warehouse_received_by_id', 'warehouse_recorded_at', 'warehouse_remark'])
      AND EXISTS (
        SELECT 1
        FROM "purchase_chain_correction_orders" link
        JOIN "purchase_chain_corrections" correction ON correction.id = link.correction_id
        WHERE link.purchase_order_id = NEW.purchase_order_id
          AND correction.applied_at IS NULL
      )
    THEN RETURN NEW; END IF;
    -- 客户签收事实只允许一次写入；签收后不可改写、不可清空。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.delivered_at IS NULL AND OLD.delivered_by_id IS NULL
      AND OLD.delivered_recorded_at IS NULL AND OLD.delivery_remark IS NULL
      AND NEW.delivered_at IS NOT NULL AND NEW.delivered_by_id IS NOT NULL
      AND NEW.delivered_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['delivered_at', 'delivered_by_id', 'delivered_recorded_at', 'delivery_remark'])
        = (to_jsonb(OLD) - ARRAY['delivered_at', 'delivered_by_id', 'delivered_recorded_at', 'delivery_remark'])
    THEN RETURN NEW; END IF;
    -- 补号只允许双空字段一次合法赋值；状态、唛头、分配身份、创建和发货事实必须完全不变。
    IF OLD.shipment_no IS NULL AND OLD.numbering_issuance_id IS NULL
      AND NEW.shipment_no IS NOT NULL AND NEW.numbering_issuance_id IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipment_no', 'numbering_issuance_id'])
        = (to_jsonb(OLD) - ARRAY['shipment_no', 'numbering_issuance_id'])
      AND purchase_shipment_number_matches(NEW.id, NEW.purchase_order_id, NEW.key, NEW.shipment_no, NEW.numbering_issuance_id)
    THEN RETURN NEW; END IF;
    -- 目的地仓库与物流单号随发货事实一次冻结；新发货必须记录仓库，重放、入仓与补号均不能改写。
    IF OLD.status = 'ACTIVE' AND NEW.status = 'ACTIVE'
      AND OLD.shipped_at IS NULL AND NEW.shipped_at IS NOT NULL
      AND NEW.destination_warehouse_value IS NOT NULL
      AND NEW.shipped_by_id IS NOT NULL AND NEW.shipment_recorded_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no', 'destination_warehouse_value'])
        = (to_jsonb(OLD) - ARRAY['shipped_at', 'shipped_by_id', 'shipment_recorded_at', 'shipment_remark', 'tracking_no', 'destination_warehouse_value'])
      AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = NEW.purchase_order_id
        AND order_status::text IN ('CONFIRMED', 'COMPLETED')
        AND fulfillment_status::text IN ('PREPARING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED'))
    THEN RETURN NEW; END IF;
    IF OLD.shipped_at IS NULL AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      SELECT order_status::text INTO parent_status FROM "purchase_orders" WHERE id = NEW.purchase_order_id;
      IF FOUND AND (
        -- NULL 仅存在于本事务内的历史回填阶段；迁移完成后列的非空约束封闭此入口。
        (OLD.status IS NULL AND NEW.status::text = CASE parent_status
          WHEN 'PENDING_REVIEW' THEN 'PENDING_REVIEW'
          WHEN 'CANCELLED' THEN 'CANCELLED'
          ELSE 'ACTIVE' END)
        OR (OLD.status = 'PENDING_REVIEW' AND NEW.status = 'ACTIVE' AND parent_status = 'CONFIRMED')
        OR (OLD.status IN ('PENDING_REVIEW', 'ACTIVE') AND NEW.status = 'CANCELLED' AND parent_status = 'CANCELLED')
      ) THEN RETURN NEW; END IF;
    END IF;
    IF OLD.shipping_mark_text IS NULL AND NEW.shipping_mark_text IS NOT NULL
      AND (to_jsonb(NEW) - 'shipping_mark_text') = (to_jsonb(OLD) - 'shipping_mark_text') THEN
      SELECT orders.shipping_mark_text,
        EXISTS (SELECT 1 FROM "purchase_order_parts" part
          WHERE part.purchase_order_id = orders.id AND part.part_number = 2)
        INTO base_mark, has_multiple_parts
        FROM "purchase_orders" orders
        WHERE orders.id = NEW.purchase_order_id AND orders.part_configuration_sealed
          AND orders.create_request_fingerprint_version IN ('purchase-order.create.v5', 'purchase-order.create.v6', 'purchase-order.create.v7')
          AND orders.order_status = 'PENDING_REVIEW' AND orders.fulfillment_status = 'ORDERED';
      IF FOUND AND base_mark IS NOT NULL AND NEW.shipping_mark_text = (CASE WHEN has_multiple_parts
        THEN base_mark || '/货件-' || lpad(NEW.part_number::text, greatest(2, length(NEW.part_number::text)), '0')
        ELSE base_mark END) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Purchase part configuration is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'purchase_order_parts_immutable_check';
END;
$$;

-- 提交时自校验：纠正必须把销售单、采购单、货件、装柜、付款和包装费都收敛到最终状态。
-- 任何服务端遗漏都会让整个纠正事务回滚，而不是留下半纠正数据。
CREATE FUNCTION "enforce_purchase_chain_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status TEXT;
  fulfillment_status TEXT;
BEGIN
  IF NEW.applied_at IS NULL THEN RETURN NULL; END IF;

  SELECT sales_order.order_status::text, sales_order.fulfillment_status::text
  INTO order_status, fulfillment_status
  FROM "sales_orders" sales_order
  WHERE sales_order.id = NEW.sales_order_id;

  IF NOT FOUND OR order_status <> 'CONFIRMED' OR fulfillment_status <> 'PENDING' THEN
    RAISE EXCEPTION 'Purchase chain correction must return the sales order to pending purchase'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_sales_order_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "purchase_chain_correction_orders" link
    WHERE link.correction_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must include at least one purchase order'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_orders_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_chain_correction_orders" link
    JOIN "purchase_orders" purchase ON purchase.id = link.purchase_order_id
    WHERE link.correction_id = NEW.id AND purchase.order_status <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must cancel every included purchase order'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_purchase_status_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_chain_correction_orders" link
    JOIN "purchase_order_parts" part ON part.purchase_order_id = link.purchase_order_id
    WHERE link.correction_id = NEW.id
      AND (
        part.status <> 'CANCELLED'
        OR part.shipped_at IS NOT NULL OR part.shipped_by_id IS NOT NULL
        OR part.shipment_recorded_at IS NOT NULL OR part.shipment_remark IS NOT NULL
        OR part.warehouse_received_at IS NOT NULL OR part.warehouse_received_by_id IS NOT NULL
        OR part.warehouse_recorded_at IS NOT NULL OR part.warehouse_remark IS NOT NULL
        OR part.loaded_at IS NOT NULL OR part.loaded_by_id IS NOT NULL OR part.loaded_recorded_at IS NOT NULL
        OR part.delivered_at IS NOT NULL OR part.delivered_by_id IS NOT NULL
        OR part.delivered_recorded_at IS NOT NULL OR part.delivery_remark IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must clear shipment facts and cancel parts'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_parts_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "container_loading_items" item
    JOIN "purchase_order_parts" part ON part.id = item.shipment_id
    JOIN "purchase_chain_correction_orders" link ON link.purchase_order_id = part.purchase_order_id
    WHERE link.correction_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must detach every container loading item'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_container_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "purchase_order_payments" payment
    JOIN "purchase_chain_correction_orders" link ON link.purchase_order_id = payment.purchase_order_id
    WHERE link.correction_id = NEW.id AND payment.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must void every active purchase payment'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_payments_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "packaging_cost_requests" cost
    JOIN "purchase_chain_correction_orders" link ON link.purchase_order_id = cost.purchase_order_id
    WHERE link.correction_id = NEW.id AND cost.status IN ('PENDING_PAYMENT', 'PAID')
  ) THEN
    RAISE EXCEPTION 'Purchase chain correction must cancel pending packaging costs'
      USING ERRCODE = '23514', CONSTRAINT = 'purchase_chain_correction_packaging_check';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "purchase_chain_corrections_applied_trigger"
AFTER UPDATE ON "purchase_chain_corrections"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "enforce_purchase_chain_correction"();

-- 权限：只允许内置系统管理员执行，普通角色不能通过角色管理获得。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only")
VALUES (
  '00000000-0000-4000-8000-000000002433',
  'purchase-orders:correction',
  '纠正误建采购链',
  '把未签收销售单下的错误采购链退回待采购；会作废采购付款、取消待付款包装费并清空物流事实',
  true
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" AS role
CROSS JOIN "permissions" AS permission
WHERE role."id" = '00000000-0000-4000-8000-000000000001'
  AND role."code" = 'system_admin'
  AND permission."id" = '00000000-0000-4000-8000-000000002433'
  AND permission."code" = 'purchase-orders:correction';

-- 迁移自校验：结构、触发器、权限目录与管理员授权缺一不可。
DO $$
DECLARE actual_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'purchase_chain_corrections') THEN
    RAISE EXCEPTION 'purchase chain correction table missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'purchase_chain_correction_orders') THEN
    RAISE EXCEPTION 'purchase chain correction order table missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'reject_purchase_order_part_mutation'
      AND pg_get_functiondef(p.oid) LIKE '%purchase_chain_correction_orders%') THEN
    RAISE EXCEPTION 'purchase chain correction fact guard missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'purchase_chain_corrections_applied_trigger') THEN
    RAISE EXCEPTION 'purchase chain correction deferred guard missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'packaging_cost_status' AND e.enumlabel = 'CANCELLED') THEN
    RAISE EXCEPTION 'packaging cost cancelled status missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'PURCHASE_ORDER_CORRECTION_APPLIED') THEN
    RAISE EXCEPTION 'purchase chain correction audit event missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'PACKAGING_COST_CANCELLED') THEN
    RAISE EXCEPTION 'packaging cost cancelled audit event missing' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO actual_count
  FROM "permissions" AS permission
  WHERE permission."id" = '00000000-0000-4000-8000-000000002433'
    AND permission."code" = 'purchase-orders:correction'
    AND permission."system_only" = true;
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase chain correction permission catalog mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer INTO actual_count
  FROM "permissions" AS permission
  JOIN "role_permissions" AS grant_entry ON grant_entry."permission_id" = permission."id"
  JOIN "roles" AS role ON role."id" = grant_entry."role_id"
  WHERE permission."id" = '00000000-0000-4000-8000-000000002433'
    AND permission."code" = 'purchase-orders:correction'
    AND role."id" = '00000000-0000-4000-8000-000000000001'
    AND role."code" = 'system_admin';
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'purchase chain correction system admin grant mismatch' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
