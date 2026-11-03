BEGIN;

-- 装柜合并组只承载「同一销售单的多个货件在装柜时视为一票」，
-- 不改变货件身份、采购配置或装柜行外键。组创建后在事务内封存成员集合，
-- 之后只能整组释放，不能增删成员。
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_LOAD_GROUP_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'PURCHASE_SHIPMENT_LOAD_GROUP_RELEASED';

CREATE TYPE "shipment_load_group_status" AS ENUM ('ACTIVE', 'RELEASED', 'ARCHIVED');

CREATE TABLE "shipment_load_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_order_id" UUID NOT NULL,
    "owner_sales_order_id" UUID NOT NULL,
    "primary_shipment_id" UUID NOT NULL,
    "status" "shipment_load_group_status" NOT NULL DEFAULT 'ACTIVE',
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "request_key" VARCHAR(128) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" UUID,
    "released_at" TIMESTAMPTZ(6),
    "release_reason" VARCHAR(500),

    CONSTRAINT "shipment_load_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_load_groups_actor_request_key" UNIQUE ("created_by_id", "request_key"),
    CONSTRAINT "shipment_load_groups_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shipment_load_groups_owner_sales_order_id_fkey" FOREIGN KEY ("owner_sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shipment_load_groups_primary_shipment_id_fkey" FOREIGN KEY ("primary_shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shipment_load_groups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shipment_load_groups_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "shipment_load_groups_order_idx" ON "shipment_load_groups"("purchase_order_id");
CREATE INDEX "shipment_load_groups_sales_order_idx" ON "shipment_load_groups"("owner_sales_order_id");
CREATE INDEX "shipment_load_groups_primary_idx" ON "shipment_load_groups"("primary_shipment_id");

CREATE TABLE "shipment_load_group_members" (
    "group_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_load_group_members_pkey" PRIMARY KEY ("group_id", "shipment_id"),
    CONSTRAINT "shipment_load_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "shipment_load_groups"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "shipment_load_group_members_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "purchase_order_parts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "shipment_load_group_members_shipment_idx" ON "shipment_load_group_members"("shipment_id");
CREATE INDEX "shipment_load_group_members_group_active_idx" ON "shipment_load_group_members"("group_id", "active");
-- 一个货件最多属于一个活跃组；释放后保留成员历史但不阻塞重新合并。
CREATE UNIQUE INDEX "shipment_load_group_members_active_shipment_key"
    ON "shipment_load_group_members"("shipment_id") WHERE "active";
-- 每个组恰好一个主货件；释放后主成员行保留为历史。
CREATE UNIQUE INDEX "shipment_load_group_members_primary_group_key"
    ON "shipment_load_group_members"("group_id") WHERE "is_primary";

CREATE FUNCTION "enforce_shipment_load_group_member"() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER "shipment_load_group_members_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_load_group_members"
  FOR EACH ROW EXECUTE FUNCTION "enforce_shipment_load_group_member"();

CREATE FUNCTION "enforce_shipment_load_group_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shipment load groups are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_immutable_check';
  END IF;

  IF NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
    OR NEW.owner_sales_order_id IS DISTINCT FROM OLD.owner_sales_order_id
    OR NEW.primary_shipment_id IS DISTINCT FROM OLD.primary_shipment_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Shipment load group identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_immutable_check';
  END IF;

  IF NOT OLD.sealed AND NEW.sealed THEN
    IF NEW.status <> 'ACTIVE'
      OR NEW.released_by_id IS NOT NULL
      OR NEW.released_at IS NOT NULL
      OR NEW.release_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Shipment load group must be sealed as active without release facts'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_seal_check';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.sealed AND NEW.sealed AND OLD.status = 'ACTIVE' AND NEW.status IN ('RELEASED', 'ARCHIVED') THEN
    IF NEW.released_by_id IS NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'Released shipment load group requires actor and time'
        USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_release_check';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Shipment load group transition is not allowed'
    USING ERRCODE = '23514', CONSTRAINT = 'shipment_load_group_transition_check';
END;
$$;

CREATE TRIGGER "shipment_load_group_mutation_guard"
  BEFORE UPDATE OR DELETE ON "shipment_load_groups"
  FOR EACH ROW EXECUTE FUNCTION "enforce_shipment_load_group_mutation"();

CREATE FUNCTION "assert_shipment_load_group_valid"(target_group_id UUID) RETURNS void LANGUAGE plpgsql AS $$
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

CREATE FUNCTION "validate_shipment_load_group"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "assert_shipment_load_group_valid"(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION "validate_shipment_load_group_member"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "assert_shipment_load_group_valid"(NEW.group_id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "shipment_load_group_validate"
  AFTER INSERT OR UPDATE ON "shipment_load_groups"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_shipment_load_group"();

CREATE CONSTRAINT TRIGGER "shipment_load_group_members_validate"
  AFTER INSERT OR UPDATE ON "shipment_load_group_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_shipment_load_group_member"();

-- 结构自校验：表、索引、审计取值与触发器必须全部落库。
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_type' AND e.enumlabel = 'PURCHASE_SHIPMENT_LOAD_GROUP_CREATED') THEN
    RAISE EXCEPTION 'Shipment load group audit event missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'shipment_load_group_members_active_shipment_key') THEN
    RAISE EXCEPTION 'Shipment load group active membership index missing' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = 'enforce_shipment_load_group_member') THEN
    RAISE EXCEPTION 'Shipment load group member guard missing' USING ERRCODE = '23514';
  END IF;
END $$;

COMMIT;
