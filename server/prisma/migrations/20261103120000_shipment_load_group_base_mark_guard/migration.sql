-- 修复 v1.4.0 提前应用旧草稿造成的函数漂移。
-- 旧版触发器比较完整货件唛头，导致同一基础唛头下的 /货件-01 与 /货件-02 被判为不同；
-- 当前口径必须比较去掉 /货件-NN 后的基础唛头。本次只替换两个函数，
-- 不改表、索引、约束或业务数据；全新库与已修复库重复执行为幂等操作。
BEGIN;

CREATE OR REPLACE FUNCTION "assert_shipment_load_group_valid"(target_group_id UUID) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  grp RECORD;
  active_count INTEGER;
BEGIN
  SELECT * INTO grp FROM shipment_load_groups WHERE id = target_group_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT grp.sealed THEN
    RAISE EXCEPTION 'Shipment load group must be sealed before commit'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_seal_check';
  END IF;

  SELECT count(*) INTO active_count
    FROM shipment_load_group_members
   WHERE group_id = grp.id AND active;

  IF grp.status = 'ACTIVE' THEN
    IF active_count < 2 THEN
      RAISE EXCEPTION 'Shipment load group requires at least two active members'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_count_check';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM shipment_load_group_members
       WHERE group_id = grp.id AND active AND is_primary AND shipment_id = grp.primary_shipment_id
    ) THEN
      RAISE EXCEPTION 'Shipment load group primary member is missing'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_primary_check';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM shipment_load_group_members member
        JOIN purchase_order_parts part ON part.id = member.shipment_id
        JOIN shipment_ownership_current ownership ON ownership.shipment_id = part.id
       WHERE member.group_id = grp.id
         AND member.active
         AND (part.status <> 'ACTIVE'
           OR part.loaded_at IS NOT NULL
           OR part.delivered_at IS NOT NULL
           OR part.destination_warehouse_value IS NULL
           OR part.shipping_mark_text IS NULL
           OR ownership.owner_type <> 'SALES_ORDER'
           OR ownership.state <> 'ACTIVE'
           OR ownership.owner_sales_order_id <> grp.owner_sales_order_id)
    ) THEN
      RAISE EXCEPTION 'Shipment load group contains an ineligible member'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_eligible_check';
    END IF;
    IF (
      SELECT count(DISTINCT part.destination_warehouse_value)
        FROM shipment_load_group_members member
        JOIN purchase_order_parts part ON part.id = member.shipment_id
       WHERE member.group_id = grp.id AND member.active
    ) <> 1 THEN
      RAISE EXCEPTION 'Shipment load group members must share destination warehouse'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_facts_check';
    END IF;
    IF (
      SELECT count(DISTINCT regexp_replace(part.shipping_mark_text, '/货件-[0-9]+$', ''))
        FROM shipment_load_group_members member
        JOIN purchase_order_parts part ON part.id = member.shipment_id
       WHERE member.group_id = grp.id AND member.active
    ) <> 1 THEN
      RAISE EXCEPTION 'Shipment load group members must share base shipping mark'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_facts_check';
    END IF;
    IF (
      SELECT count(DISTINCT ownership.owner_sales_order_id)
        FROM shipment_load_group_members member
        JOIN purchase_order_parts part ON part.id = member.shipment_id
        JOIN shipment_ownership_current ownership ON ownership.shipment_id = part.id
       WHERE member.group_id = grp.id AND member.active
    ) <> 1 THEN
      RAISE EXCEPTION 'Shipment load group members must share the current sales order'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_owner_check';
    END IF;
  ELSE
    IF active_count <> 0 THEN
      RAISE EXCEPTION 'Released shipment load group must deactivate all members'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_release_check';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_shipment_load_group_member"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  grp RECORD;
  shipment RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shipment load group members are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_immutable_check';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.group_id IS DISTINCT FROM OLD.group_id
      OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
      OR NEW.is_primary IS DISTINCT FROM OLD.is_primary THEN
      RAISE EXCEPTION 'Shipment load group member identity is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_immutable_check';
    END IF;
    IF OLD.active AND NOT NEW.active THEN
      SELECT * INTO grp FROM shipment_load_groups WHERE id = NEW.group_id;
      IF NOT FOUND OR NOT grp.sealed OR grp.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Release the group before deactivating members'
          USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_release_check';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.active IS DISTINCT FROM OLD.active THEN
      RAISE EXCEPTION 'Shipment load group members cannot be reactivated'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_immutable_check';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO grp FROM shipment_load_groups WHERE id = NEW.group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment load group does not exist'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_group_check';
  END IF;
  IF grp.status <> 'ACTIVE' OR grp.sealed THEN
    RAISE EXCEPTION 'Shipment load group is already sealed or released'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_sealed_check';
  END IF;

  SELECT part.*, ownership.owner_type, ownership.owner_sales_order_id, ownership.state
    INTO shipment
    FROM purchase_order_parts part
    LEFT JOIN shipment_ownership_current ownership ON ownership.shipment_id = part.id
   WHERE part.id = NEW.shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipment does not exist'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_shipment_check';
  END IF;
  IF shipment.purchase_order_id <> grp.purchase_order_id THEN
    RAISE EXCEPTION 'Shipment load group members must belong to the same purchase order'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_order_check';
  END IF;
  IF shipment.owner_type IS DISTINCT FROM 'SALES_ORDER'
    OR shipment.state IS DISTINCT FROM 'ACTIVE'
    OR shipment.owner_sales_order_id IS DISTINCT FROM grp.owner_sales_order_id THEN
    RAISE EXCEPTION 'Shipment load group members must share the current sales order'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_owner_check';
  END IF;
  IF shipment.status <> 'ACTIVE'
    OR shipment.loaded_at IS NOT NULL
    OR shipment.delivered_at IS NOT NULL THEN
    RAISE EXCEPTION 'Shipment is not eligible for a load group'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_eligible_check';
  END IF;
  IF shipment.destination_warehouse_value IS NULL OR shipment.shipping_mark_text IS NULL THEN
    RAISE EXCEPTION 'Shipment must record destination warehouse and shipping mark before grouping'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_facts_check';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM shipment_load_group_members member
      JOIN purchase_order_parts part ON part.id = member.shipment_id
     WHERE member.group_id = NEW.group_id
       AND member.active
       AND (part.destination_warehouse_value IS DISTINCT FROM shipment.destination_warehouse_value
         OR regexp_replace(part.shipping_mark_text, '/货件-[0-9]+$', '')
           IS DISTINCT FROM regexp_replace(shipment.shipping_mark_text, '/货件-[0-9]+$', ''))
  ) THEN
    RAISE EXCEPTION 'Shipment load group members must share warehouse and base shipping mark'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_facts_check';
  END IF;

  IF NEW.is_primary AND NEW.shipment_id <> grp.primary_shipment_id THEN
    RAISE EXCEPTION 'Primary member must match the group primary shipment'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_primary_check';
  END IF;
  IF NOT NEW.is_primary AND NEW.shipment_id = grp.primary_shipment_id THEN
    RAISE EXCEPTION 'Group primary shipment must be marked as primary'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_members_primary_check';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema()
      AND p.proname IN ('enforce_shipment_load_group_member', 'assert_shipment_load_group_valid')
      AND p.prosrc LIKE '%regexp_replace%'
      AND p.prosrc LIKE '%base shipping mark%'
  ) <> 2 THEN
    RAISE EXCEPTION 'shipment load group base mark repair failed'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_base_mark_repair_check';
  END IF;
END;
$$;

COMMIT;
