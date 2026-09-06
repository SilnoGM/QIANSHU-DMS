-- 配置审计独立于采购/派发日志；本迁移不读取、修改或创建任何编号流水。
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPPING_MARK_BINDING_CREATED';
ALTER TYPE "audit_event_type" ADD VALUE 'SHIPPING_MARK_BINDING_UPDATED';

BEGIN;

-- CreateTable
CREATE TABLE "supplier_shipping_mark_rule_bindings" (
    "supplier_value" VARCHAR(64) NOT NULL,
    "rule_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_shipping_mark_rule_bindings_pkey" PRIMARY KEY ("supplier_value")
);

-- CreateIndex
CREATE INDEX "supplier_shipping_mark_bindings_rule_idx" ON "supplier_shipping_mark_rule_bindings"("rule_id");

-- AddForeignKey
ALTER TABLE "supplier_shipping_mark_rule_bindings" ADD CONSTRAINT "supplier_shipping_mark_rule_bindings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "numbering_rules"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "supplier_shipping_mark_rule_bindings" ADD CONSTRAINT "supplier_shipping_mark_rule_bindings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "supplier_shipping_mark_rule_bindings" ADD CONSTRAINT "supplier_shipping_mark_rule_bindings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "supplier_shipping_mark_rule_bindings"
  ADD CONSTRAINT "shipping_mark_binding_version_positive_check" CHECK ("version" > 0);

-- 字典值不能通过单列 FK 表达固定类型，使用具名守卫验证身份；历史停用仍允许保留配置。
CREATE FUNCTION "enforce_shipping_mark_binding_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.supplier_value IS DISTINCT FROM OLD.supplier_value
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Shipping mark binding identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'shipping_mark_binding_identity_check';
  END IF;
  PERFORM 1 FROM dictionary_items i JOIN dictionary_types t ON t.id = i.dictionary_type_id
    WHERE t.code = 'service_provider.supplier' AND i.value = NEW.supplier_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipping mark binding requires a supplier dictionary value'
      USING ERRCODE = '23514', CONSTRAINT = 'shipping_mark_binding_supplier_check';
  END IF;
  PERFORM 1 FROM numbering_rules WHERE id = NEW.rule_id AND purpose = 'SHIPPING_MARK';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shipping mark binding requires a shipping mark rule'
      USING ERRCODE = '23514', CONSTRAINT = 'shipping_mark_binding_purpose_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "shipping_mark_binding_identity_trigger"
  BEFORE INSERT OR UPDATE ON "supplier_shipping_mark_rule_bindings"
  FOR EACH ROW EXECUTE FUNCTION "enforce_shipping_mark_binding_identity"();

-- 仅系统管理员默认获权；其他角色可单独授权，不借编号查看权限开放配置写入。
INSERT INTO "permissions" ("id", "code", "name", "description", "system_only") VALUES
  (gen_random_uuid(), 'purchase-shipping-marks:read', '查看唛头规则绑定', '查询供应商绑定和固定自定义产品规则', false),
  (gen_random_uuid(), 'purchase-shipping-marks:update', '修改唛头规则绑定', '设置或更换供应商的唛头编号规则', false);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'system_admin' AND p.code IN ('purchase-shipping-marks:read', 'purchase-shipping-marks:update');

COMMIT;
